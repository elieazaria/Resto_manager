-- Prix d'achat de référence saisi à l'inventaire (par unité d'achat) : sert au calcul de rentabilité
-- tant qu'aucun achat n'est enregistré, ou s'il est plus récent que le dernier achat.
alter table stock_items add column if not exists cost_ref numeric(14,4) check (cost_ref is null or cost_ref >= 0);
alter table stock_items add column if not exists cost_ref_date date;

-- Quantité (en unité de stock) retirée du stock à chaque vente d'un article « revendu » :
-- ex. bouteille de jus 1,5 L = 1500 ml, verre de jus = recette de 250 ml.
alter table menu_items add column if not exists stock_qty numeric(14,3) not null default 1 check (stock_qty > 0);
