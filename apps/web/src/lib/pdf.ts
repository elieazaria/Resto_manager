import {
  HOTEL_PAYMENT_LABELS, HOTEL_STATUS_LABELS, type HotelReservationDto, type HotelRoomDto, type HotelSettings,
} from '@resto/shared';
import { fmtDate, money } from './format';
import { PAY_LABEL } from './hotel';

// jsPDF est chargé à la demande (≈ 300 Ko) : il n'alourdit pas le reste de l'application.
async function doc(orientation: 'p' | 'l' = 'p') {
  const [{ jsPDF }, plugin] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  // Le plugin est un module CommonJS/UMD : selon l'outil de build la fonction est sur .default ou .default.default
  const m: any = plugin;
  const autoTable: (d: any, o: any) => void = typeof m.default === 'function' ? m.default : (m.default?.default ?? m.autoTable);
  return { d: new jsPDF({ orientation, unit: 'mm', format: 'a4' }), autoTable };
}
/** jsPDF (police standard) ne gère pas les espaces insécables fines produites par Intl. */
const ar = (n: number) => money(n).replace(/[  ]/g, ' ');
const header = (d: any, s: HotelSettings, title: string, sub?: string) => {
  d.setFontSize(16).setFont('helvetica', 'bold').text(s.name || 'Hôtel', 14, 16);
  d.setFontSize(9).setFont('helvetica', 'normal');
  const info = [s.address, [s.phone, s.email].filter(Boolean).join(' · '), s.tax_id && `NIF / STAT : ${s.tax_id}`].filter(Boolean);
  info.forEach((t, i) => d.text(String(t), 14, 21 + i * 4.2));
  d.setFontSize(14).setFont('helvetica', 'bold').text(title, d.internal.pageSize.getWidth() - 14, 16, { align: 'right' });
  if (sub) d.setFontSize(9).setFont('helvetica', 'normal').text(sub, d.internal.pageSize.getWidth() - 14, 21, { align: 'right' });
  return 21 + info.length * 4.2 + 4;
};
const footer = (d: any, s: HotelSettings) => {
  const n = d.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    d.setPage(i).setFontSize(8).setTextColor(110);
    const h = d.internal.pageSize.getHeight();
    if (s.invoice_footer) d.text(s.invoice_footer, 14, h - 10);
    d.text(`Page ${i}/${n}`, d.internal.pageSize.getWidth() - 14, h - 10, { align: 'right' });
  }
};

export async function pdfReservations(rows: HotelReservationDto[], s: HotelSettings, period: string) {
  const { d, autoTable } = await doc('l');
  const y = header(d, s, 'Liste des réservations', period);
  autoTable(d, {
    startY: y, styles: { fontSize: 8 }, headStyles: { fillColor: [22, 101, 52] },
    head: [['N°', 'Client', 'Chambre', 'Arrivée', 'Départ', 'Nuits', 'Statut', 'Total net', 'Payé', 'Reste']],
    body: rows.map((r) => [r.ref, r.client_name, r.room_number, fmtDate(r.arrival), fmtDate(r.departure), r.nights, HOTEL_STATUS_LABELS[r.status], ar(r.net_amount), ar(r.paid_amount), ar(Math.max(0, r.balance))]),
    foot: [['', '', '', '', '', '', 'Total', ar(rows.reduce((t, r) => t + r.net_amount, 0)), ar(rows.reduce((t, r) => t + r.paid_amount, 0)), ar(rows.reduce((t, r) => t + Math.max(0, r.balance), 0))]],
    footStyles: { fillColor: [240, 240, 240], textColor: 20 },
    columnStyles: { 7: { halign: 'right' }, 8: { halign: 'right' }, 9: { halign: 'right' } },
  });
  footer(d, s);
  d.save(`reservations_${new Date().toISOString().slice(0, 10)}.pdf`);
}

/** Planning : grille chambres × jours, cases colorées selon le statut. */
export async function pdfPlanning(rooms: HotelRoomDto[], rows: HotelReservationDto[], days: string[], s: HotelSettings) {
  const { d, autoTable } = await doc('l');
  const y = header(d, s, 'Planning des réservations', `${fmtDate(days[0]!)} au ${fmtDate(days[days.length - 1]!)}`);
  const colors: Record<string, [number, number, number]> = { option: [245, 158, 11], confirmed: [22, 163, 74], checked_in: [37, 99, 235], checked_out: [156, 163, 175] };
  const cell = (room: string, day: string) => rows.find((r) => r.room_id === room && r.status !== 'cancelled' && r.arrival <= day && r.departure > day);
  autoTable(d, {
    startY: y, styles: { fontSize: 6, cellPadding: 0.8, halign: 'center', minCellHeight: 6 },
    headStyles: { fillColor: [22, 101, 52] },
    columnStyles: { 0: { halign: 'left', cellWidth: 24, fontStyle: 'bold' } },
    head: [['Chambre', ...days.map((x) => x.slice(8) + '/' + x.slice(5, 7))]],
    body: rooms.map((r) => [r.number, ...days.map(() => '')]),
    didParseCell: (h: any) => {
      if (h.section !== 'body' || h.column.index === 0) return;
      const r = cell(rooms[h.row.index]!.id, days[h.column.index - 1]!);
      if (r) {
        h.cell.styles.fillColor = colors[r.status] ?? [200, 200, 200];
        if (r.arrival === days[h.column.index - 1]) h.cell.text = [r.client_name.split(' ').slice(-1)[0]!.slice(0, 6)];
      }
    },
  });
  const ly = (d as any).lastAutoTable.finalY + 5;
  let x = 14;
  d.setFontSize(8);
  for (const [k, c] of Object.entries(colors)) {
    d.setFillColor(...c).rect(x, ly, 4, 4, 'F');
    d.setTextColor(30).text(HOTEL_STATUS_LABELS[k as keyof typeof HOTEL_STATUS_LABELS], x + 6, ly + 3);
    x += 38;
  }
  footer(d, s);
  d.save(`planning_${days[0]}.pdf`);
}

export async function pdfInvoice(r: HotelReservationDto, s: HotelSettings) {
  const { d, autoTable } = await doc('p');
  let y = header(d, s, 'FACTURE', r.ref);
  d.setFontSize(10).setFont('helvetica', 'bold').text('Client', 14, y + 4);
  d.setFont('helvetica', 'normal').text([r.client_name, r.client_phone ?? ''].filter(Boolean), 14, y + 9);
  d.text([`Chambre : ${r.room_number} (${r.room_type_name})`, `Séjour : ${fmtDate(r.arrival)} au ${fmtDate(r.departure)} (${r.nights} nuit${r.nights > 1 ? 's' : ''})`, `Personnes : ${r.adults} adulte(s), ${r.children} enfant(s)`], 110, y + 4);
  y += 24;
  const lines: (string | number)[][] = [[`Hébergement – chambre ${r.room_number}`, r.nights, ar(r.price_per_night), ar(r.lodging_amount)]];
  for (const e of r.extras) lines.push([e.label + (e.multiplier > 1 ? ` (× ${e.multiplier} nuits)` : ''), e.quantity, ar(e.unit_price), ar(e.amount)]);
  if (r.tourist_tax) lines.push(['Taxe de séjour', r.adults * r.nights, '', ar(r.tourist_tax)]);
  autoTable(d, { startY: y, head: [['Désignation', 'Qté', 'Prix unitaire', 'Montant']], body: lines, styles: { fontSize: 9 }, headStyles: { fillColor: [22, 101, 52] }, columnStyles: { 1: { halign: 'center' }, 2: { halign: 'right' }, 3: { halign: 'right' } } });
  y = (d as any).lastAutoTable.finalY + 4;
  const tot: string[][] = [['Total', ar(r.total_amount)]];
  if (r.discount_amount) tot.push([`Remise${r.discount_percent ? ` (${r.discount_percent} %)` : ''}`, '- ' + ar(r.discount_amount)]);
  if (s.vat_percent) tot.push([`dont TVA ${s.vat_percent} %`, ar(Math.round(r.net_amount - r.net_amount / (1 + s.vat_percent / 100)))]);
  tot.push(['NET À PAYER', ar(r.net_amount)], ['Déjà payé', ar(r.paid_amount)], ['RESTE À PAYER', ar(Math.max(0, r.balance))]);
  autoTable(d, { startY: y, body: tot, theme: 'plain', tableWidth: 80, margin: { left: 116 }, styles: { fontSize: 10, halign: 'right' }, columnStyles: { 0: { halign: 'left', fontStyle: 'bold' } } });
  y = (d as any).lastAutoTable.finalY + 6;
  if (r.payments.length) {
    autoTable(d, { startY: y, head: [['Date', 'Type', 'Mode de paiement', 'Montant']], body: r.payments.map((p) => [fmtDate(p.paid_on), p.kind === 'refund' ? 'Remboursement' : p.kind === 'deposit' ? 'Acompte' : 'Paiement', HOTEL_PAYMENT_LABELS[p.method], ar(p.amount)]), styles: { fontSize: 9 }, headStyles: { fillColor: [90, 90, 90] }, columnStyles: { 3: { halign: 'right' } } });
  }
  d.setFontSize(10).setFont('helvetica', 'bold').text(`Statut : ${PAY_LABEL[r.pay_status]}`, 14, (d as any).lastAutoTable?.finalY ? (d as any).lastAutoTable.finalY + 8 : y + 4);
  footer(d, s);
  d.save(`facture_${r.ref.replace(/[^\w.-]+/g, '_')}.pdf`);
}

export async function pdfStatement(clientName: string, rows: HotelReservationDto[], s: HotelSettings) {
  const { d, autoTable } = await doc('p');
  const y = header(d, s, 'RELEVÉ DE COMPTE', clientName);
  const live = rows.filter((r) => r.status !== 'cancelled');
  autoTable(d, {
    startY: y, styles: { fontSize: 8 }, headStyles: { fillColor: [22, 101, 52] },
    head: [['N°', 'Chambre', 'Séjour', 'Net', 'Payé', 'Reste']],
    body: live.map((r) => [r.ref, r.room_number, `${fmtDate(r.arrival)} au ${fmtDate(r.departure)}`, ar(r.net_amount), ar(r.paid_amount), ar(Math.max(0, r.balance))]),
    foot: [['', '', 'Total', ar(live.reduce((t, r) => t + r.net_amount, 0)), ar(live.reduce((t, r) => t + r.paid_amount, 0)), ar(live.reduce((t, r) => t + Math.max(0, r.balance), 0))]],
    footStyles: { fillColor: [240, 240, 240], textColor: 20 }, columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
  });
  footer(d, s);
  d.save(`releve_${clientName.replace(/\W+/g, '_')}.pdf`);
}
