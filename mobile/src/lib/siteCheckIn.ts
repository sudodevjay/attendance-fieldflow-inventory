/**
 * Check-in at a work site: the phone's GPS position must be inside a site's radius (the server says which sites) and a
 * selfie is taken with the front camera at that moment. A mock-location app is refused (Android reports it). The server
 * checks everything again. When the administrator turned "only at a work site" off, it is a plain check-in.
 */
import Geolocation, { type GeolocationResponse } from '@react-native-community/geolocation';
import { PermissionsAndroid, Platform } from 'react-native';
import { api } from './api';
import { pickPhoto } from './media';

/** Android reports a mock-location app on the position (`mocked`). */
type Position = GeolocationResponse & { mocked?: boolean };

interface Site { id: number; name: string; lat: number; lng: number; radius: number }
interface Info { required: boolean; maxAccuracy: number; sites: Site[] }

/** Metres between two GPS positions (same formula as the server). */
function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const r = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(a));
}
const distanceText = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

function current(): Promise<Position> {
  return new Promise((resolve, reject) => Geolocation.getCurrentPosition(
    (p) => resolve(p as Position),
    (e) => reject(new Error(e.code === e.PERMISSION_DENIED
      ? 'Allow the location permission for Housys Attendance (phone Settings → Apps), then try again.'
      : e.code === e.POSITION_UNAVAILABLE ? 'Turn on Location / GPS on the phone, then try again.'
        : 'The GPS position could not be read in time. Step outside or wait a moment, then try again.')),
    { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
  ));
}

/** A reading exact enough: tries a few times, as the first GPS fix is often rough. */
async function position(maxAccuracy: number) {
  let best: Position | null = null;
  for (let i = 0; i < 3; i++) {
    const p = await current();
    if (!best || (p.coords.accuracy ?? 9999) < (best.coords.accuracy ?? 9999)) best = p;
    if ((best.coords.accuracy ?? 9999) <= maxAccuracy) break;
  }
  return best!;
}

async function locationAllowed() {
  if (Platform.OS !== 'android') return true;
  const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION, {
    title: 'Location', message: 'Your location is checked when you check in at a work site.', buttonPositive: 'OK',
  });
  return r === PermissionsAndroid.RESULTS.GRANTED;
}

/** Runs the whole check-in; returns the server's message, or null when the employee cancelled the selfie. */
export async function siteCheckIn(checkOut: boolean): Promise<string | null> {
  const info: Info = await api.get('/checkin');
  if (!info.required) return (await api.post('/checkin', { checkOut, source: 'app' })).message;
  if (!info.sites.length) throw new Error('No work site is set up for you. Please ask HR.');

  if (!(await locationAllowed())) throw new Error('Allow the location permission for Housys Attendance (phone Settings → Apps), then try again.');
  const p = await position(info.maxAccuracy);
  if (p.mocked) throw new Error('A fake / mock location app is on. Turn it off to check in.');
  const accuracy = p.coords.accuracy ?? 9999;
  if (accuracy > info.maxAccuracy) throw new Error(`The GPS signal is weak (±${Math.round(accuracy)} m). Step outside or wait a moment, then try again.`);
  const nearest = info.sites.map((s) => ({ s, d: distanceMeters(p.coords.latitude, p.coords.longitude, s.lat, s.lng) })).sort((a, b) => a.d - b.d)[0];
  if (nearest.d > nearest.s.radius)
    throw new Error(`You are ${distanceText(nearest.d)} from ${nearest.s.name}. Check-in works only within ${nearest.s.radius} m of the site.`);

  const shot = await pickPhoto({ camera: true, front: true, base64: true, quality: 0.4 });
  if (!shot?.base64) return null;

  const r = await api.post('/checkin', {
    checkOut, source: 'app', lat: p.coords.latitude, lng: p.coords.longitude, accuracy, mocked: !!p.mocked, photo: shot.base64,
  });
  return r.message;
}
