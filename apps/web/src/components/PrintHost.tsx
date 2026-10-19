import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { layoutTicket } from '@/lib/ticket';
import { printStore, usePrintJob } from '@/lib/print';

/** Rend le ticket dans #print-root puis déclenche l'impression du navigateur (CSS @media print dans index.css). */
export function PrintHost() {
  const job = usePrintJob();
  const root = document.getElementById('print-root');

  useEffect(() => {
    if (!job) return;
    const done = () => printStore.set(null);
    window.addEventListener('afterprint', done, { once: true });
    const t = window.setTimeout(() => window.print(), 80); // laisse React peindre le ticket
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('afterprint', done);
    };
  }, [job]);

  if (!job || !root) return null;
  return createPortal(<Ticket order={job.order} settings={job.settings} />, root);
}

export function Ticket({ order, settings }: { order: Parameters<typeof layoutTicket>[0]; settings: Parameters<typeof layoutTicket>[1] }) {
  const cols = settings.paper_width;
  const mm = cols <= 32 ? 48 : 72; // zone imprimable : 58 mm -> ~48 mm ; 80 mm -> ~72 mm
  const fontMm = mm / cols / 0.6; // police à chasse fixe : largeur d'un caractère ≈ 0,6 em
  return (
    <div className="ticket" style={{ ['--ticket-width' as string]: `${mm}mm`, fontSize: `${fontMm}mm` }}>
      {layoutTicket(order, settings).map((l, i) => (
        <div key={i} className={`${l.big ? 'big' : ''} ${l.bold ? 'bold' : ''}`} style={{ textAlign: l.align ?? 'left' }}>
          {l.text || ' '}
        </div>
      ))}
    </div>
  );
}
