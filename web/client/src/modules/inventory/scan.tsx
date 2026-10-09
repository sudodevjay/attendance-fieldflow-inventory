/**
 * Scanning and labels. A USB / Bluetooth QR or barcode scanner and a desk RFID reader type the code followed by Enter,
 * so ScanBox is an input that reports the code on Enter; on a phone the camera button reads QR codes (jsQR). Labels:
 * QR codes (item, unit, bin) printed from the browser on any label / A4 sticker sheet.
 */
import jsQR from 'jsqr';
import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { Button, Icon, Input, Modal } from '../../ui';

export function ScanBox({ onScan, placeholder = 'Scan QR / RFID / barcode, or type and press Enter', autoFocus, className = '', busy }: {
  onScan: (code: string) => void; placeholder?: string; autoFocus?: boolean; className?: string; busy?: boolean;
}) {
  const [v, setV] = useState('');
  const [cam, setCam] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);
  const fire = (code: string) => {
    const c = code.trim();
    if (c) onScan(c);
    setV('');
    setTimeout(() => ref.current?.focus(), 0);
  };
  return (
    <div className={`flex min-w-0 items-center gap-1 ${className}`}>
      <div className="relative min-w-0 flex-1">
        <Icon name="scan" className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-slate-400" />
        <Input ref={ref} value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} aria-label="Scan code" className="pl-8" disabled={busy}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); fire(v); } }} />
      </div>
      {typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && (
        <Button icon="camera" onClick={() => setCam(true)} title="Scan a QR code with the camera" aria-label="Camera" />
      )}
      {cam && <CameraScan onClose={() => setCam(false)} onCode={(c) => { setCam(false); fire(c); }} />}
    </div>
  );
}

/** Reads one QR code from the camera (back camera on phones). */
function CameraScan({ onCode, onClose }: { onCode: (c: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let stream: MediaStream | null = null, raf = 0, done = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const tick = () => {
      const v = video.current;
      if (done || !v || !ctx) return;
      if (v.readyState === v.HAVE_ENOUGH_DATA && v.videoWidth) {
        const w = Math.min(640, v.videoWidth), h = Math.round((v.videoHeight * w) / v.videoWidth);
        canvas.width = w; canvas.height = h;
        ctx.drawImage(v, 0, 0, w, h);
        const r = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
        if (r?.data) { done = true; onCode(r.data); return; }
      }
      raf = requestAnimationFrame(tick);
    };
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then((s) => {
      stream = s;
      if (video.current) { video.current.srcObject = s; video.current.play().catch(() => {}); }
      raf = requestAnimationFrame(tick);
    }).catch(() => setErr('The camera could not be opened. Allow camera access for this site (https needed on phones).'));
    return () => { done = true; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal title="Scan QR code" onClose={onClose} width="max-w-md">
      {err ? <p className="text-sm text-red-700">{err}</p> : (
        <div className="relative overflow-hidden rounded-md bg-black">
          <video ref={video} playsInline muted className="block aspect-[4/3] w-full object-cover" />
          <div className="pointer-events-none absolute inset-8 rounded-lg border-2 border-white/80" />
        </div>
      )}
      <p className="mt-2 text-xs text-slate-500">Hold the QR code inside the frame. RFID tags are read with the RFID reader (it types into the scan box).</p>
    </Modal>
  );
}

export interface Label { code: string; title: string; sub?: string }

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Prints QR labels (50 × 25 mm each, as many per page as fit) in a new window. */
export async function printLabels(labels: Label[], heading = 'Labels') {
  if (!labels.length) return;
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) throw new Error('Allow pop-ups for this site to print labels.');
  const cells = await Promise.all(labels.map(async (l) => {
    const svg = await QRCode.toString(l.code, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
    return `<div class="l"><div class="q">${svg}</div><div class="t"><b>${esc(l.title)}</b>${l.sub ? `<span>${esc(l.sub)}</span>` : ''}<code>${esc(l.code)}</code></div></div>`;
  }));
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(heading)}</title><style>
    @page { margin: 8mm } body { font: 11px system-ui, sans-serif; margin: 0 }
    .g { display: flex; flex-wrap: wrap; gap: 3mm }
    .l { width: 50mm; height: 25mm; box-sizing: border-box; border: 1px dashed #bbb; padding: 1.5mm; display: flex; gap: 2mm; align-items: center; break-inside: avoid; overflow: hidden }
    .q { width: 21mm; height: 21mm; flex: none } .q svg { width: 100%; height: 100% }
    .t { display: flex; flex-direction: column; gap: .6mm; min-width: 0; line-height: 1.15 } .t b { font-size: 10px }
    .t span { font-size: 9px; color: #444 } .t code { font-size: 8.5px; word-break: break-all }
    @media print { .l { border-color: #eee } }
  </style></head><body><div class="g">${cells.join('')}</div><script>setTimeout(() => print(), 300)<\/script></body></html>`);
  w.document.close();
}
