/**
 * Check-in at a work site: the phone's GPS position must be inside a site's radius (the server says which sites) and a
 * selfie is taken with the front camera at that moment. A mock-location app is refused (Android reports it). The server
 * checks everything again. When the administrator turned "only at a work site" off, it is a plain check-in.
 */
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { api } from './api';

interface Site { id: number; name: string; lat: number; lng: number; radius: number }
interface Info { required: boolean; maxAccuracy: number; sites: Site[] }

/** Metres between two GPS positions (same formula as the server). */
function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const r = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(a));
}
const distanceText = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

/** A reading exact enough: tries a few times, as the first GPS fix is often rough. */
async function position(maxAccuracy: number) {
  let best: Location.LocationObject | null = null;
  for (let i = 0; i < 3; i++) {
    const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
    if (!best || (p.coords.accuracy ?? 9999) < (best.coords.accuracy ?? 9999)) best = p;
    if ((best.coords.accuracy ?? 9999) <= maxAccuracy) break;
  }
  return best!;
}

/** Runs the whole check-in; returns the server's message, or null when the employee cancelled the selfie. */
export async function siteCheckIn(checkOut: boolean): Promise<string | null> {
  const info: Info = await api.get('/checkin');
  if (!info.required) return (await api.post('/checkin', { checkOut, source: 'app' })).message;
  if (!info.sites.length) throw new Error('No work site is set up for you. Please ask HR.');

  const perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) throw new Error('Allow the location permission for Housys Attendance (phone Settings → Apps), then try again.');
  if (!(await Location.hasServicesEnabledAsync())) throw new Error('Turn on Location / GPS on the phone, then try again.');
  const p = await position(info.maxAccuracy);
  if (p.mocked) throw new Error('A fake / mock location app is on. Turn it off to check in.');
  const accuracy = p.coords.accuracy ?? 9999;
  if (accuracy > info.maxAccuracy) throw new Error(`The GPS signal is weak (±${Math.round(accuracy)} m). Step outside or wait a moment, then try again.`);
  const nearest = info.sites.map((s) => ({ s, d: distanceMeters(p.coords.latitude, p.coords.longitude, s.lat, s.lng) })).sort((a, b) => a.d - b.d)[0];
  if (nearest.d > nearest.s.radius)
    throw new Error(`You are ${distanceText(nearest.d)} from ${nearest.s.name}. Check-in works only within ${nearest.s.radius} m of the site.`);

  const cam = await ImagePicker.requestCameraPermissionsAsync();
  if (!cam.granted) throw new Error('Allow the camera permission for Housys Attendance to take the selfie.');
  const shot = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], cameraType: ImagePicker.CameraType.front, base64: true, quality: 0.4, exif: false });
  if (shot.canceled || !shot.assets[0]?.base64) return null;

  const r = await api.post('/checkin', {
    checkOut, source: 'app', lat: p.coords.latitude, lng: p.coords.longitude, accuracy, mocked: !!p.mocked, photo: shot.assets[0].base64,
  });
  return r.message;
}
