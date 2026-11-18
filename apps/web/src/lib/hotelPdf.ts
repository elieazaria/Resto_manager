import { HOTEL_PAYMENT_LABELS, type HotelReportDto, type HotelYearlyRowDto } from '@resto/shared';
import { fmtDate, fmtQty, money } from './format';
import { doc } from './pdf';
import { pct } from './period';

const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const ar = (n: number) => money(n).replace(/[  ]/g, ' ');
const sign = (n: number) => (n > 0 ? '+' : '') + ar(n);
const pctTxt = (a: number, b: number) => { const p = pct(a, b); return p == null ? 'nouveau' : `${p > 0 ? '+' : ''}${p.toLocaleString('fr-FR')} %`; };

export interface HotelPdfInput {
  hotel: string;
  title: string;
  report: HotelReportDto;
  compare?: { label: string; report: HotelReportDto };
  grid?: { year: number; rows: HotelYearlyRowDto[] }[];
}

export async function pdfHotelReport(inp: HotelPdfInput) {
  const { d, autoTable } = await doc('p');
  const W = d.internal.pageSize.getWidth();
  const r = inp.report, c = inp.compare?.report;
  const blue: [number, number, number] = [31, 111, 163];
  let y = 16;
  d.setFontSize(16).setFont('helvetica', 'bold').text(inp.hotel || 'Hôtel', 14, y);
  d.setFontSize(13).text('Statistiques de l’hôtel', W - 14, y, { align: 'right' });
  d.setFontSize(9).setFont('helvetica', 'normal');
  d.text(inp.title, W - 14, y + 5, { align: 'right' });
  d.text(`Édité le ${fmtDate(new Date().toISOString().slice(0, 10))}`, 14, y + 5);
  y += 12;
  const tbl = (o: any) => autoTable(d, { ...o, didParseCell: (h: any) => {
    const a = o.columnStyles?.[h.column.index]?.halign;
    if (a && h.section !== 'body') h.cell.styles.halign = a;
    o.didParseCell?.(h);
  } });
  const next = () => ((d as any).lastAutoTable.finalY as number) + 8;
  const h2 = (t: string) => { d.setFontSize(11).setFont('helvetica', 'bold').setTextColor(30).text(t, 14, y); y += 2; };
  const room = (need: number) => { if (y + need > d.internal.pageSize.getHeight() - 20) { d.addPage(); y = 16; } };
  const R = { halign: 'right' };

  h2(`Résultat et indicateurs · ${fmtDate(r.from)} au ${fmtDate(r.to)}`);
  type K = [string, number, number | undefined, 'ar' | 'n' | 'p'];
  const kp: K[] = [
    ['Chiffre d’affaires', r.revenue, c?.revenue, 'ar'], ['Dépenses', r.expenses, c?.expenses, 'ar'], ['Résultat net (CA - dépenses)', r.net, c?.net, 'ar'],
    ['Marge nette', r.margin_percent, c?.margin_percent, 'p'], ['Hébergement', r.lodging, c?.lodging, 'ar'], ['Suppléments', r.extras, c?.extras, 'ar'],
    ['Ventes sur place', r.walkins, c?.walkins, 'ar'], ['Encaissé', r.collected, c?.collected, 'ar'], ['Réservations', r.reservations, c?.reservations, 'n'],
    ['Nuitées vendues', r.nights, c?.nights, 'n'], ['Taux d’occupation', r.occupancy_percent, c?.occupancy_percent, 'p'], ['Prix moyen / nuitée', r.adr, c?.adr, 'ar'], ['RevPAR', r.revpar, c?.revpar, 'ar'],
  ];
  const f = (n: number, t: K[3]) => (t === 'ar' ? ar(n) : t === 'p' ? `${n.toLocaleString('fr-FR')} %` : fmtQty(n));
  tbl({
    startY: y, styles: { fontSize: 9 }, headStyles: { fillColor: blue },
    head: [c ? ['Indicateur', 'Période', inp.compare!.label, 'Écart', '%'] : ['Indicateur', 'Période']],
    body: kp.map(([l, v, p, t]) => c ? [l, f(v, t), f(p ?? 0, t), (v - (p ?? 0) > 0 ? '+' : '') + f(v - (p ?? 0), t), t === 'p' ? '' : pctTxt(v, p ?? 0)] : [l, f(v, t)]),
    columnStyles: { 1: R, 2: R, 3: R, 4: R },
  });
  y = next();

  room(40); h2('Dépenses par catégorie');
  tbl({ startY: y, styles: { fontSize: 8.5 }, headStyles: { fillColor: blue }, head: [['Catégorie', 'Montant']], body: r.expenses_by_category.length ? r.expenses_by_category.map((x) => [x.category, ar(x.total)]) : [['Aucune dépense', '']], columnStyles: { 1: R } });
  y = next();
  room(40); h2('Par type de chambre');
  tbl({ startY: y, styles: { fontSize: 8.5 }, headStyles: { fillColor: blue }, head: [['Type', 'Réservations', 'Nuitées', 'CA']], body: r.by_room_type.map((x) => [x.name, x.reservations, x.nights, ar(x.revenue)]), columnStyles: { 1: R, 2: R, 3: R } });
  y = next();
  room(40); h2('Suppléments les plus vendus');
  tbl({ startY: y, styles: { fontSize: 8.5 }, headStyles: { fillColor: blue }, head: [['Supplément', 'Quantité', 'CA']], body: r.top_extras.map((x) => [x.label, fmtQty(x.quantity), ar(x.revenue)]), columnStyles: { 1: R, 2: R } });
  y = next();
  room(40); h2('Ventes sur place');
  tbl({ startY: y, styles: { fontSize: 8.5 }, headStyles: { fillColor: blue }, head: [['Service', 'Quantité', 'CA']], body: r.walkins_by_service.map((x) => [x.label, fmtQty(x.quantity), ar(x.revenue)]), columnStyles: { 1: R, 2: R } });
  y = next();
  room(40); h2('Encaissements par mode');
  tbl({ startY: y, styles: { fontSize: 8.5 }, headStyles: { fillColor: blue }, head: [['Mode', 'Montant']], body: r.by_method.map((x) => [HOTEL_PAYMENT_LABELS[x.method] ?? x.method, ar(x.total)]), columnStyles: { 1: R } });
  y = next();

  if (inp.grid && inp.grid.length >= 2) {
    const [a, b] = [inp.grid[0]!, inp.grid[inp.grid.length - 1]!];
    d.addPage(); y = 16;
    h2(`Comparatif mensuel : ${a.year} / ${b.year}`);
    const g = (x: typeof a, m: number, k: 'revenue' | 'expenses' | 'net') => x.rows.find((z) => z.month === m)?.[k] ?? 0;
    const sum = (x: typeof a, k: 'revenue' | 'expenses' | 'net') => x.rows.reduce((s, z) => s + z[k], 0);
    tbl({
      startY: y, styles: { fontSize: 8 }, headStyles: { fillColor: blue },
      head: [['Mois', `CA ${a.year}`, `CA ${b.year}`, 'Écart %', `Net ${a.year}`, `Net ${b.year}`]],
      body: MONTHS.map((mn, i) => [mn, ar(g(a, i + 1, 'revenue')), ar(g(b, i + 1, 'revenue')), pctTxt(g(b, i + 1, 'revenue'), g(a, i + 1, 'revenue')), ar(g(a, i + 1, 'net')), ar(g(b, i + 1, 'net'))]),
      foot: [['Total', ar(sum(a, 'revenue')), ar(sum(b, 'revenue')), pctTxt(sum(b, 'revenue'), sum(a, 'revenue')), ar(sum(a, 'net')), ar(sum(b, 'net'))],
             ['Dépenses', ar(sum(a, 'expenses')), ar(sum(b, 'expenses')), pctTxt(sum(b, 'expenses'), sum(a, 'expenses')), '', '']],
      footStyles: { fillColor: [240, 240, 240], textColor: 20 },
      columnStyles: { 1: R, 2: R, 3: R, 4: R, 5: R },
    });
  }
  const n = d.getNumberOfPages();
  for (let i = 1; i <= n; i++) d.setPage(i).setFontSize(8).setTextColor(110).text(`Page ${i}/${n}`, W - 14, d.internal.pageSize.getHeight() - 8, { align: 'right' });
  d.save(`statistiques_hotel_${r.from}_${r.to}.pdf`);
}
