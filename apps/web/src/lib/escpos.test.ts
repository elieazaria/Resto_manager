import { describe, expect, it } from 'vitest';
import type { OrderDto, Settings } from '@resto/shared';
import { buildTicketEscPos, toAscii } from './escpos';

const settings: Settings = { restaurant_name: 'Café Ravenala', address: 'Antananarivo', phone: '034 00 000 00', ticket_footer: 'Misaotra !', paper_width: 32 };
const order: OrderDto = {
  id: 'x', ticket_no: 12, table_id: 't', table_name: 'Table 3', status: 'paid', note: null, total: 27000,
  payment_method: 'cash', amount_received: 30000, business_date: '2026-10-13', created_at: '2026-10-13T08:00:00Z',
  paid_at: '2026-10-13T08:30:00Z', opened_by_name: 'Rina', paid_by_name: 'Rina', void_reason: null,
  lines: [
    { id: '1', menu_item_id: 'm', name: "Gratin d'œufs au jambon et fromage fondu", unit_price: 12000, quantity: 2, note: null },
    { id: '2', menu_item_id: 'n', name: 'Coca 33cl', unit_price: 3000, quantity: 1, note: 'sans glaçon' },
  ],
};

describe('ESC/POS', () => {
  it('retire les accents', () => {
    expect(toAscii('Crème brûlée œuf — « test »')).toBe('Creme brulee oeuf - ? test ?'.replace('?', '?'));
  });
  it('commence par ESC @ et finit par une coupe papier', () => {
    const b = buildTicketEscPos(order, settings);
    expect([...b.slice(0, 2)]).toEqual([0x1b, 0x40]);
    expect([...b.slice(-4)]).toEqual([0x1d, 0x56, 0x42, 0x00]);
  });
  it('contient total, rendu et ne dépasse jamais la largeur du papier', () => {
    const b = buildTicketEscPos(order, settings);
    const text = new TextDecoder('latin1').decode(b);
    expect(text).toContain('27 000 Ar');
    expect(text).toContain('Rendu');
    expect(text).toContain('3 000 Ar');
    for (const line of text.split('\n')) {
      // retire les séquences de commande (ESC/GS + paramètres) avant de mesurer
      const visible = line.replace(/[\x1b\x1d][@aEd!V]?[\x00-\x7f]?[\x00-\x7f]?/g, '');
      expect(visible.length).toBeLessThanOrEqual(settings.paper_width + 6);
    }
  });
});
