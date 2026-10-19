import type { FastifyInstance } from 'fastify';
import {
  categorySchema,
  menuItemSchema,
  menuItemUpdateSchema,
  recipeSchema,
  tableSchema,
  type PosMenuDto,
  type PosTableDto,
} from '@resto/shared';
import { audit } from '../auth.js';
import type { Ctx } from '../context.js';
import { idParam, registerCrud } from '../crud.js';
import { badRequest, notFound } from '../errors.js';

export function catalogRoutes(app: FastifyInstance, ctx: Ctx) {
  registerCrud(app, ctx, {
    path: '/categories',
    table: 'categories',
    entity: 'category',
    createSchema: categorySchema,
    updateSchema: categorySchema.partial(),
    select: 't.*, (select count(*)::int from menu_items m where m.category_id = t.id) as item_count',
    orderBy: 't.sort_order, lower(t.name)',
  });

  registerCrud(app, ctx, {
    path: '/menu-items',
    table: 'menu_items',
    entity: 'menu_item',
    createSchema: menuItemSchema,
    updateSchema: menuItemUpdateSchema,
    select: `t.*, c.name as category_name, s.name as stock_item_name,
             (select count(*)::int from recipes r where r.menu_item_id = t.id) as recipe_lines`,
    joins: 'join categories c on c.id = t.category_id left join stock_items s on s.id = t.stock_item_id',
    orderBy: 'c.sort_order, lower(c.name), lower(t.name)',
  });

  registerCrud(app, ctx, {
    path: '/tables',
    table: 'restaurant_tables',
    entity: 'table',
    createSchema: tableSchema,
    updateSchema: tableSchema.partial(),
    orderBy: 't.sort_order, lower(t.name)',
  });

  /* ── Recette d'un plat (composition en ingrédients) ── */
  const admin = { preHandler: ctx.auth.require('admin') };

  app.get('/menu-items/:id/recipe', admin, async (req) => {
    const id = idParam(req);
    const { rows } = await ctx.db.query(
      `select r.stock_item_id, s.name as stock_item_name, s.unit, r.qty_per_portion
       from recipes r join stock_items s on s.id = r.stock_item_id
       where r.menu_item_id = $1 order by lower(s.name)`,
      [id],
    );
    return { lines: rows };
  });

  app.put('/menu-items/:id/recipe', admin, async (req) => {
    const id = idParam(req);
    const { lines } = recipeSchema.parse(req.body);
    if (new Set(lines.map((l) => l.stock_item_id)).size !== lines.length) throw badRequest('Ingrédient en double dans la recette');
    await ctx.db.tx(async (q) => {
      const item = (await q.query<{ kind: string }>('select kind from menu_items where id = $1', [id])).rows[0];
      if (!item) throw notFound();
      if (item.kind === 'resale' && lines.length) throw badRequest("Un article « revendu tel quel » n'a pas de recette");
      await q.query('delete from recipes where menu_item_id = $1', [id]);
      for (const l of lines) {
        await q.query('insert into recipes (menu_item_id, stock_item_id, qty_per_portion) values ($1,$2,$3)', [
          id,
          l.stock_item_id,
          l.qty_per_portion,
        ]);
      }
      await audit(q, req.user, 'recipe.replace', 'menu_item', id, { lines: lines.length });
    });
    return { lines };
  });

  /* ── Lecture pour la caisse (caissier + gérant) ── */
  const pos = { preHandler: ctx.auth.require('pos') };

  app.get('/pos/menu', pos, async (): Promise<PosMenuDto> => {
    const items = (
      await ctx.db.query<PosMenuDto['items'][number]>(
        `select m.id, m.name, m.price, m.category_id, m.kind
         from menu_items m join categories c on c.id = m.category_id
         where m.is_active order by c.sort_order, lower(m.name)`,
      )
    ).rows;
    const categories = (
      await ctx.db.query<PosMenuDto['categories'][number]>(
        `select id, name from categories c
         where exists (select 1 from menu_items m where m.category_id = c.id and m.is_active)
         order by sort_order, lower(name)`,
      )
    ).rows;
    return { categories, items };
  });

  app.get('/pos/tables', pos, async (): Promise<PosTableDto[]> =>
    (
      await ctx.db.query<PosTableDto>(
        `select t.id, t.name, o.id as open_order_id, o.total as open_total, o.created_at as open_since
         from restaurant_tables t
         left join orders o on o.table_id = t.id and o.status = 'open'
         where t.is_active order by t.sort_order, lower(t.name)`,
      )
    ).rows,
  );
}
