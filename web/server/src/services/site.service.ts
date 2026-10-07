/**
 * Site attendance: employees who work at a site (not at the fingerprint device) check in from the app / portal. The
 * check-in is only accepted with the phone's GPS position inside a work site's radius and a selfie taken at that moment.
 * The punch goes into AttendanceLogs (source Manual, remark "Site check-in: <site>"), so reports count it like any other;
 * FieldPunches keeps the position, distance and selfie for HR to check.
 */
import { exec, one, query, transaction } from '../config/db';
import { UserError } from '../utils/errors';
import { filterScope, scopeIds } from '../utils/scope';
import { addDays, fmt, mustParse, sqlD, sqlDT } from '../utils/time';
import { getSetting, setSetting } from './settings.service';
import { PunchSource } from './sync.service';

/** Largest selfie accepted (base64 characters, about 1.5 MB of JPEG). */
const MAX_PHOTO = 2_000_000;

export interface Site { Id: number; Name: string; Address: string | null; Latitude: number; Longitude: number; RadiusMeters: number; AllEmployees: boolean; IsActive: boolean }

/** Distance in metres between two GPS positions (haversine). */
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const r = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(a));
}

const distanceText = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

// ------------------------------------------------------------------ settings

/** On: a portal / app check-in needs the location at a work site and a selfie. Off: check-in from anywhere (old way). */
export const siteRequired = async () => (await getSetting('Portal.CheckInAtSite', '1')) === '1';
/** GPS readings less exact than this are refused (a weak fix could put somebody far away inside the radius). */
export const maxAccuracy = async () => Number(await getSetting('Portal.MaxGpsAccuracy', '100')) || 100;

export async function saveSiteSettings(required: boolean, accuracy: number) {
  await setSetting('Portal.CheckInAtSite', required ? '1' : '0');
  await setSetting('Portal.MaxGpsAccuracy', String(Math.min(1000, Math.max(10, Math.round(accuracy) || 100))));
}

// ------------------------------------------------------------------ work sites (administrator)

const toSite = (r: any): Site => ({ ...r, Latitude: Number(r.Latitude), Longitude: Number(r.Longitude), AllEmployees: !!r.AllEmployees, IsActive: !!r.IsActive });

export async function list() {
  const sites = (await query('SELECT * FROM WorkSites ORDER BY Name')).map(toSite);
  const links = await query('SELECT SiteId, EmployeeId FROM SiteEmployees');
  return sites.map((s) => ({ ...s, EmployeeIds: links.filter((l) => l.SiteId === s.Id).map((l) => l.EmployeeId as number) }));
}

export interface SiteInput { Name?: unknown; Address?: unknown; Latitude?: unknown; Longitude?: unknown; RadiusMeters?: unknown; AllEmployees?: unknown; IsActive?: unknown; EmployeeIds?: unknown }

function validate(b: SiteInput) {
  const name = String(b.Name ?? '').trim();
  if (!name) throw new UserError('Write the site name.');
  const lat = Number(b.Latitude), lng = Number(b.Longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0))
    throw new UserError('Enter the latitude and longitude of the site (e.g. 28.6139, 77.2090).');
  const radius = Math.round(Number(b.RadiusMeters));
  if (!(radius >= 20 && radius <= 5000)) throw new UserError('The radius must be between 20 and 5000 metres.');
  const ids = Array.isArray(b.EmployeeIds) ? [...new Set(b.EmployeeIds.map(Number).filter(Number.isInteger))] : [];
  const all = b.AllEmployees === undefined ? true : !!b.AllEmployees;
  if (!all && !ids.length) throw new UserError('Choose the employees of this site, or allow all employees.');
  return {
    p: { n: name.slice(0, 100), a: String(b.Address ?? '').trim().slice(0, 300) || null, lat, lng, r: radius, all, act: b.IsActive === undefined ? true : !!b.IsActive },
    ids,
  };
}

export async function save(id: number | null, b: SiteInput) {
  const { p, ids } = validate(b);
  return transaction(async (tx) => {
    let siteId = id;
    if (siteId === null) {
      siteId = (await one(`INSERT INTO WorkSites (Name, Address, Latitude, Longitude, RadiusMeters, AllEmployees, IsActive)
        VALUES (@n, @a, @lat, @lng, @r, @all, @act) RETURNING Id`, p, tx))!.Id as number;
    } else if (!(await exec(`UPDATE WorkSites SET Name = @n, Address = @a, Latitude = @lat, Longitude = @lng, RadiusMeters = @r,
        AllEmployees = @all, IsActive = @act WHERE Id = @id`, { ...p, id: siteId }, tx))) {
      throw new UserError('Site not found.', 404);
    }
    await exec('DELETE FROM SiteEmployees WHERE SiteId = @id', { id: siteId }, tx);
    if (!p.all) await exec('INSERT INTO SiteEmployees (SiteId, EmployeeId) SELECT @id, x FROM unnest(CAST(@ids AS int[])) x', { id: siteId, ids }, tx);
    return siteId;
  });
}

export async function remove(id: number) {
  await exec('DELETE FROM SiteEmployees WHERE SiteId = @id; DELETE FROM WorkSites WHERE Id = @id', { id });
}

// ------------------------------------------------------------------ employee (portal / app)

/** Active sites this employee may check in at. */
export async function sitesOf(employeeId: number): Promise<Site[]> {
  return (await query(`SELECT * FROM WorkSites s WHERE s.IsActive
    AND (s.AllEmployees OR EXISTS (SELECT 1 FROM SiteEmployees x WHERE x.SiteId = s.Id AND x.EmployeeId = @e)) ORDER BY s.Name`, { e: employeeId })).map(toSite);
}

/** What the check-in screen needs before it opens the camera. */
export async function checkInInfo(employeeId: number) {
  return {
    required: await siteRequired(), maxAccuracy: await maxAccuracy(),
    sites: (await sitesOf(employeeId)).map((s) => ({ id: s.Id, name: s.Name, address: s.Address, lat: s.Latitude, lng: s.Longitude, radius: s.RadiusMeters })),
  };
}

export interface SiteCheckIn { lat?: unknown; lng?: unknown; accuracy?: unknown; mocked?: unknown; photo?: unknown }

/** Checks the position and the selfie; returns the site the employee is at (throws with the reason otherwise). */
export async function verify(employeeId: number, b: SiteCheckIn) {
  const lat = Number(b.lat), lng = Number(b.lng);
  const photo = typeof b.photo === 'string' ? b.photo.replace(/^data:image\/\w+;base64,/, '') : '';
  if (b.lat === undefined || !photo)
    throw new UserError('Check-in needs your location and a selfie at the work site. Please update the app / open the portal again.');
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new UserError('Your location could not be read. Turn on GPS and try again.');
  if (b.mocked === true) throw new UserError('A fake / mock location app is on. Turn it off to check in.');
  if (!photo.startsWith('/9j/') || photo.length > MAX_PHOTO) throw new UserError('The selfie could not be read. Please take it again.');
  const accuracy = Number(b.accuracy);
  const limit = await maxAccuracy();
  if (!Number.isFinite(accuracy) || accuracy > limit)
    throw new UserError(`The GPS signal is weak${Number.isFinite(accuracy) ? ` (±${Math.round(accuracy)} m)` : ''}. Step outside or wait a moment, then try again.`);

  const sites = await sitesOf(employeeId);
  if (!sites.length) throw new UserError('No work site is set up for you. Please ask HR.');
  const nearest = sites.map((s) => ({ s, d: distanceMeters(lat, lng, s.Latitude, s.Longitude) })).sort((a, b) => a.d - b.d);
  const at = nearest.find((x) => x.d <= x.s.RadiusMeters);
  if (!at) throw new UserError(`You are ${distanceText(nearest[0].d)} from ${nearest[0].s.Name}. Check-in works only within ${nearest[0].s.RadiusMeters} m of the site.`);
  return { site: at.s, distance: Math.round(at.d), lat, lng, accuracy: Math.round(accuracy), photo };
}

/** Saves the punch and its evidence in one transaction. */
export async function punch(employeeId: number, enrollNo: string, t: number, checkOut: boolean, source: string, v: Awaited<ReturnType<typeof verify>>) {
  await transaction(async (tx) => {
    const log = await one(`INSERT INTO AttendanceLogs (EnrollNo, PunchTime, VerifyMode, InOutMode, WorkCode, Source, Remark)
      VALUES (@e, CAST(@t AS timestamp), -1, @io, 0, @src, @r) RETURNING Id`,
    { e: enrollNo, t: sqlDT(t), io: checkOut ? 1 : 0, src: PunchSource.Manual, r: `Site check-${checkOut ? 'out' : 'in'}: ${v.site.Name} (${source})`.slice(0, 200) }, tx);
    await exec(`INSERT INTO FieldPunches (LogId, EmployeeId, SiteId, SiteName, PunchTime, IsCheckOut, Latitude, Longitude, AccuracyMeters, DistanceMeters, Photo, Source)
      VALUES (@log, @emp, @site, @sn, CAST(@t AS timestamp), @out, @lat, @lng, @acc, @d, @ph, @src)`,
    { log: log!.Id, emp: employeeId, site: v.site.Id, sn: v.site.Name, t: sqlDT(t), out: checkOut, lat: v.lat, lng: v.lng, acc: v.accuracy, d: v.distance, ph: v.photo, src: source }, tx);
  });
  return `${checkOut ? 'Checked out' : 'Checked in'} at ${fmt(t, 'hh:mm tt')} — ${v.site.Name} (${v.distance} m).`;
}

// ------------------------------------------------------------------ site punches (administrator)

/** Site check-ins of [from, to] (yyyy-MM-dd), newest first, without the photos. */
export async function punches(from: string, to: string, siteId: number | null) {
  const f = mustParse(from), t = mustParse(to);
  if (t < f) throw new UserError("The 'To' date cannot be before the 'From' date.");
  const ids = scopeIds();
  const rows = await query(`SELECT p.Id, p.EmployeeId, e.EnrollNo, e.Name, d.Name AS Department, p.SiteId, p.SiteName,
      to_char(p.PunchTime, 'YYYY-MM-DD HH24:MI:SS') AS PunchTime, p.IsCheckOut, p.Latitude, p.Longitude, p.AccuracyMeters, p.DistanceMeters,
      p.Source, (p.Photo IS NOT NULL) AS HasPhoto, (e.PhotoBase64 IS NOT NULL) AS HasEmployeePhoto, (l.Id IS NULL) AS PunchDeleted
    FROM FieldPunches p JOIN Employees e ON e.Id = p.EmployeeId LEFT JOIN Departments d ON d.Id = e.DepartmentId
      LEFT JOIN AttendanceLogs l ON l.Id = p.LogId
    WHERE p.PunchTime >= CAST(@f AS timestamp) AND p.PunchTime < CAST(@t AS timestamp) AND (CAST(@s AS int) IS NULL OR p.SiteId = @s)
      ${ids ? 'AND p.EmployeeId = ANY(@ids)' : ''}
    ORDER BY p.PunchTime DESC LIMIT 5000`, { f: sqlD(f), t: sqlD(addDays(t, 1)), s: siteId, ids: ids ? [...ids] : [] });
  return filterScope(rows, (r) => r.EmployeeId).map((r) => ({ ...r, Latitude: Number(r.Latitude), Longitude: Number(r.Longitude) }));
}

/** Selfie of a site punch, with its employee (for the scope check). */
export const photo = (id: number) => one('SELECT EmployeeId, Photo FROM FieldPunches WHERE Id = @id', { id });

/** The employee's own photo (from the device / Employees screen), to compare with the selfie. */
export const employeePhoto = (id: number) => one('SELECT Id AS EmployeeId, PhotoBase64 AS Photo FROM Employees WHERE Id = @id', { id });
