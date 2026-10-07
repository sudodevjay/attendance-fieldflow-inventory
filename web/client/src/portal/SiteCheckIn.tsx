/**
 * Check-in at a work site (portal in the phone's browser): the GPS position must be inside a site's radius and a selfie
 * is taken with the front camera at that moment (live camera, not a photo from the gallery). The server checks both again.
 */
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../app';
import { Button, Modal, Note } from '../ui';
import { papi } from './papi';

interface SiteInfo { id: number; name: string; address: string | null; lat: number; lng: number; radius: number }
interface Info { required: boolean; maxAccuracy: number; sites: SiteInfo[] }
interface Pos { lat: number; lng: number; accuracy: number }

/** Metres between two GPS positions (same formula as the server). */
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const r = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(a));
}
export const distanceText = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

const GEO_ERRORS: Record<number, string> = {
  1: 'Location permission is blocked. Allow location for this site in the browser settings (lock icon next to the address), then try again.',
  2: 'Your location is not available. Turn on GPS / Location on the phone.',
  3: 'Finding your location took too long. Step outside and try again.',
};

export function SiteCheckIn({ checkOut, onDone, onClose }: { checkOut: boolean; onDone: (message: string) => void; onClose: () => void }) {
  const app = useApp();
  const [info, setInfo] = useState<Info | null>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const [geoError, setGeoError] = useState('');
  const [camError, setCamError] = useState('');
  const [photo, setPhoto] = useState('');
  const [busy, setBusy] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);

  useEffect(() => { app.run(() => papi.get<Info>('/checkin')).then((i) => i && setInfo(i)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // GPS: follows the position while the dialog is open (the reading gets more exact after a few seconds).
  useEffect(() => {
    if (!window.isSecureContext || !navigator.geolocation) { setGeoError('This browser cannot give the location (the portal must be opened over https).'); return; }
    const id = navigator.geolocation.watchPosition(
      (p) => { setGeoError(''); setPos({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }); },
      (e) => setGeoError(GEO_ERRORS[e.code] ?? e.message),
      { enableHighAccuracy: true, timeout: 30_000, maximumAge: 0 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  const startCamera = async () => {
    setCamError('');
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 720 } }, audio: false });
      if (video.current) { video.current.srcObject = stream.current; await video.current.play(); }
    } catch (e: any) {
      setCamError(e?.name === 'NotAllowedError' ? 'Camera permission is blocked. Allow the camera for this site in the browser settings, then try again.'
        : 'The camera could not be opened.');
    }
  };
  const stopCamera = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; };
  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) { setCamError('This browser cannot use the camera (the portal must be opened over https).'); return; }
    startCamera();
    return stopCamera;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const snap = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const s = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(v.videoWidth * s);
    c.height = Math.round(v.videoHeight * s);
    c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
    setPhoto(c.toDataURL('image/jpeg', 0.75).split(',')[1]);
    stopCamera();
  };
  const retake = () => { setPhoto(''); startCamera(); };

  const nearest = info && pos
    ? info.sites.map((s) => ({ s, d: distanceMeters(pos.lat, pos.lng, s.lat, s.lng) })).sort((a, b) => a.d - b.d)[0]
    : undefined;
  const inside = !!nearest && nearest.d <= nearest.s.radius;
  const weak = !!pos && !!info && pos.accuracy > info.maxAccuracy;

  const submit = async () => {
    if (!pos) return;
    setBusy(true);
    const r = await app.run(() => papi.post('/checkin', { checkOut, source: 'web', lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy, photo }));
    setBusy(false);
    if (r) onDone(r.message);
  };

  return (
    <Modal title={checkOut ? 'Check-out at site' : 'Check-in at site'} onClose={onClose} width="max-w-md"
      footer={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon="check" busy={busy} disabled={!pos || !photo || !inside || weak} onClick={submit}>{checkOut ? 'Check-out' : 'Check-in'}</Button>
      </>}>
      <div className="space-y-3 text-sm">
        <div className="rounded-lg border border-slate-200 p-3">
          <div className="mb-1 font-semibold text-slate-800">1. Location</div>
          {geoError ? <Note tone="warn">{geoError}</Note>
            : !pos ? <div className="text-slate-500">Finding your location…</div>
              : <>
                <div className="text-slate-600">GPS accuracy ±{Math.round(pos.accuracy)} m{weak && <span className="text-amber-700"> — weak signal, wait a moment or step outside</span>}</div>
                {info && !info.sites.length && <Note tone="warn">No work site is set up for you. Please ask HR.</Note>}
                {nearest && (
                  <div className={`mt-1 font-medium ${inside ? 'text-green-700' : 'text-red-700'}`}>
                    {inside ? `✓ At ${nearest.s.name} (${distanceText(nearest.d)})` : `✗ ${distanceText(nearest.d)} from ${nearest.s.name} — go within ${nearest.s.radius} m of the site`}
                  </div>
                )}
              </>}
        </div>
        <div className="rounded-lg border border-slate-200 p-3">
          <div className="mb-2 font-semibold text-slate-800">2. Selfie</div>
          {camError ? <Note tone="warn">{camError}</Note> : photo ? (
            <>
              <img src={`data:image/jpeg;base64,${photo}`} alt="Your selfie" className="mx-auto max-h-72 rounded" />
              <Button className="mt-2" icon="refresh" onClick={retake}>Retake</Button>
            </>
          ) : (
            <>
              <video ref={video} playsInline muted className="mx-auto max-h-72 w-full rounded bg-slate-900 object-contain [transform:scaleX(-1)]" />
              <Button className="mt-2 w-full justify-center" variant="primary" icon="photo" onClick={snap}>Take selfie</Button>
            </>
          )}
          <div className="mt-1 text-xs text-slate-500">Keep your face and the site visible in the photo.</div>
        </div>
      </div>
    </Modal>
  );
}
