import { PAYMENT_LABELS, type SalesReportDto, type YearlyRowDto } from '@resto/shared';
import { fmtDate, fmtQty, money } from './format';
import { doc } from './pdf';
import { pct } from './period';

const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
/** Intl produit des espaces fines insécables que la police standard de jsPDF n'affiche pas. */
const ar = (n: number) => money(n).replace(/[  ]/g, ' ');
const sign = (n: number) => (n > 0 ? '+' : '') + ar(n);
const pctTxt = (a: number, b: number) => { const p = pct(a, b); return p == null ? 'nouveau' : `${p > 0 ? '+' : ''}${p.toLocaleString('fr-FR')} %`; };

export interface SalesPdfInput {
  restaurant: string;
  title: string;
  report: SalesReportDto;
  compare?: { label: string; report: SalesReportDto };
  /** Grille mois × années : { year, rows } pour chaque année comparée (la plus ancienne d'abord). */
  grid?: { year: number; rows: YearlyRowDto[] }[];
}

export async function pdfSalesReport(inp: SalesPdfInput) {
  const { d, autoTable } = await doc('p');
  const W = d.internal.pageSize.getWidth();
  const r = inp.report;
  const green: [number, number, number] = [22, 101, 52];
  let y = 16;
  d.setFontSize(16).setFont('helvetica', 'bold').text(inp.restaurant || 'Restaurant', 14, y);
  d.setFontSize(13).text('Statistiques de ventes', W - 14, y, { align: 'right' });
  d.setFontSize(9).setFont('helvetica', 'normal');
  d.text(inp.title, W - 14, y + 5, { align: 'right' });
  d.text(`Édité le ${fmtDate(new Date().toISOString().slice(0, 10))}`, 14, y + 5);
  y += 12;

  // En-têtes et totaux alignés comme leur colonne (à droite pour les montants)
  const tbl = (o: any) => autoTable(d, { ...o, didParseCell: (h: any) => {
    const a = o.columnStyles?.[h.column.index]?.halign;
    if (a && h.section !== 'body') h.cell.styles.halign = a;
    o.didParseCell?.(h);
  } });
  const next = () => ((d as any).lastAutoTable.finalY as number) + 8;
  const h2 = (t: string) => { d.setFontSize(11).setFont('helvetica', 'bold').setTextColor(30).text(t, 14, y); y += 2; };
  const room = (need: number) => { if (y + need > d.internal.pageSize.getHeight() - 20) { d.addPage(); y = 16; } };

  /* 1. Indicateurs */
  h2(`Indicateurs · ${fmtDate(r.from)} au ${fmtDate(r.to)}`);
  const c = inp.compare?.report;
  const kpis: [string, number, number | undefined][] = [
    ['Total des ventes', r.total, c?.total], ['Nombre de tickets', r.orders, c?.orders],
    ['Ticket moyen', r.avg_ticket, c?.avg_ticket], ['Articles vendus', r.items_sold, c?.items_sold],
  ];
  tbl({
    startY: y, styles: { fontSize: 9 }, headStyles: { fillColor: green },
    head: [c ? ['Indicateur', 'Période', inp.compare!.label, 'Écart', '%'] : ['Indicateur', 'Période']],
    body: kpis.map(([l, v, p]) => {
      const money_ = l !== 'Nombre de tickets' && l !== 'Articles vendus';
      const f = (n: number) => (money_ ? ar(n) : fmtQty(n));
      return c ? [l, f(v), f(p ?? 0), (v - (p ?? 0) > 0 ? '+' : '') + f(v - (p ?? 0)), pctTxt(v, p ?? 0)] : [l, f(v)];
    }),
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
  });
  y = next();

  /* 2. Meilleures ventes */
  room(50); h2('Meilleures ventes (produits)');
  tbl({
    startY: y, styles: { fontSize: 8.5 }, headStyles: { fillColor: green },
    head: [['#', 'Produit', 'Catégorie', 'Quantité', 'Chiffre d’affaires', '% du CA']],
    body: r.top_items.map((t, i) => [i + 1, t.name, t.category_name ?? '', fmtQty(t.quantity), ar(t.revenue), r.total ? `${Math.round((t.revenue / r.total) * 1000) / 10} %` : '']),
    columnStyles: { 0: { cellWidth: 8 }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
  });
  y = next();

  /* 3. Catégories et paiements */
  room(40); h2('Par catégorie');
  tbl({ startY: y, styles: { fontSize: 8.5 }, headStyles: { fillColor: green }, head: [['Catégorie', 'Quantité', 'Chiffre d’affaires']], body: r.by_category.map((x) => [x.name, fmtQty(x.quantity), ar(x.revenue)]), columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } } });
  y = next();
  room(40); h2('Par mode de paiement');
  tbl({ startY: y, styles: { fontSize: 8.5 }, headStyles: { fillColor: green }, head: [['Mode', 'Tickets', 'Montant']], body: r.by_method.map((x) => [PAYMENT_LABELS[x.method] ?? x.method, x.count, ar(x.total)]), columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } } });
  y = next();

  /* 4. Évolution (jours, ou mois si la période est longue) */
  room(40);
  if (r.series.length) {
    const monthly = r.series.length > 31;
    h2(monthly ? 'Évolution par mois' : 'Évolution par jour');
    const rows = monthly
      ? [...r.series.reduce((m, s) => { const k = s.date.slice(0, 7); const o = m.get(k) ?? { total: 0, orders: 0 }; o.total += s.total; o.orders += s.orders; return m.set(k, o); }, new Map<string, { total: number; orders: number }>())]
          .map(([k, v]) => [`${MONTHS[Number(k.slice(5)) - 1]} ${k.slice(0, 4)}`, v.orders, ar(v.total), ar(v.orders ? Math.round(v.total / v.orders) : 0)])
      : r.series.map((s) => [fmtDate(s.date), s.orders, ar(s.total), ar(s.orders ? Math.round(s.total / s.orders) : 0)]);
    tbl({ startY: y, styles: { fontSize: 8.5 }, headStyles: { fillColor: green }, head: [[monthly ? 'Mois' : 'Jour', 'Tickets', 'Ventes', 'Ticket moyen']], body: rows, columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } } });
    y = next();
  }

  /* 5. Grille comparative mois × années */
  if (inp.grid && inp.grid.length >= 2) {
    const [a, b] = [inp.grid[0]!, inp.grid[inp.grid.length - 1]!];
    d.addPage(); y = 16;
    h2(`Comparatif mensuel des ventes : ${a.year} / ${b.year}`);
    const sa = (m: number) => a.rows.find((x) => x.month === m)?.sales ?? 0;
    const sb = (m: number) => b.rows.find((x) => x.month === m)?.sales ?? 0;
    const body = MONTHS.map((mn, i) => [mn, ar(sa(i + 1)), ar(sb(i + 1)), sign(sb(i + 1) - sa(i + 1)), pctTxt(sb(i + 1), sa(i + 1)), i === 0 ? '' : pctTxt(sb(i + 1), sb(i))]);
    const ta = a.rows.reduce((s, x) => s + x.sales, 0), tb = b.rows.reduce((s, x) => s + x.sales, 0);
    const oa = a.rows.reduce((s, x) => s + x.orders, 0), ob = b.rows.reduce((s, x) => s + x.orders, 0);
    tbl({
      startY: y, styles: { fontSize: 8.5 }, headStyles: { fillColor: green },
      head: [['Mois', String(a.year), String(b.year), 'Écart', `Écart %`, `${b.year} vs mois précédent`]], body,
      foot: [['Total', ar(ta), ar(tb), sign(tb - ta), pctTxt(tb, ta), ''], ['Tickets', fmtQty(oa), fmtQty(ob), String(ob - oa), pctTxt(ob, oa), ''], ['Ticket moyen', ar(oa ? Math.round(ta / oa) : 0), ar(ob ? Math.round(tb / ob) : 0), '', '', '']],
      footStyles: { fillColor: [240, 240, 240], textColor: 20 },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
      didParseCell: (h: any) => { if (h.section === 'body' && [3, 4].includes(h.column.index)) h.cell.styles.textColor = String(h.cell.raw).startsWith('-') ? [185, 28, 28] : [22, 101, 52]; },
    });
  }

  const n = d.getNumberOfPages();
  for (let i = 1; i <= n; i++) d.setPage(i).setFontSize(8).setTextColor(110).text(`Page ${i}/${n}`, W - 14, d.internal.pageSize.getHeight() - 8, { align: 'right' });
  d.save(`statistiques_ventes_${r.from}_${r.to}.pdf`);
}
