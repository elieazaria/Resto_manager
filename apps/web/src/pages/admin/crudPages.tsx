import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LockOpen, ListChecks } from 'lucide-react';
import { toast } from 'sonner';
import {
  EXPENSE_CATEGORIES, MENU_KIND_LABELS, MENU_KINDS, ROLE_LABELS, ROLES, STOCK_KIND_LABELS, STOCK_KINDS,
  categorySchema, expenseSchema, menuItemSchema, purchaseSchema, stockItemSchema, supplierSchema, tableSchema, userCreateSchema, userUpdateSchema,
} from '@resto/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CrudPage, type CrudConfig } from '@/components/CrudPage';
import { RecipeDialog } from '@/components/RecipeDialog';
import { api } from '@/lib/api';
import { activeCol, dateCol, moneyCol, qtyCol, textCol } from '@/lib/columns';
import { fmtQty, todayStr } from '@/lib/format';
import { errorMessage } from '@/lib/utils';

const opt = <T extends string>(values: readonly T[], labels?: Record<T, string>) => values.map((v) => ({ value: v, label: labels?.[v] ?? v }));

/* ── Catégories ── */
export function CategoriesPage() {
  const cfg: CrudConfig<any> = {
    title: 'Catégories du menu', singular: 'Catégorie', endpoint: '/categories', queryKey: 'categories',
    description: "Plat, Boisson, Dessert… L'ordre définit l'affichage en caisse.",
    invalidates: ['pos-menu', 'menu-items'],
    columns: [textCol('name', 'Nom'), textCol('sort_order', 'Ordre'), textCol('item_count', 'Articles')],
    fields: [{ name: 'name', label: 'Nom', type: 'text' }, { name: 'sort_order', label: 'Ordre d’affichage', type: 'number', step: '1', inputMode: 'numeric' }],
    schema: categorySchema, defaults: { name: '', sort_order: 0 },
  };
  return <CrudPage cfg={cfg} />;
}

/* ── Menu + recettes ── */
export function MenuPage() {
  const [recipeFor, setRecipeFor] = useState<any | null>(null);
  const cfg = useMemo<CrudConfig<any>>(() => ({
    title: 'Menu et recettes', singular: 'Article', endpoint: '/menu-items', queryKey: 'menu-items',
    description: 'Les plats cuisinés ont une recette (consommation d’ingrédients à chaque vente) ; les produits revendus décomptent directement le stock.',
    invalidates: ['pos-menu'],
    searchPlaceholder: 'Rechercher un plat…',
    columns: [
      textCol('name', 'Nom'),
      textCol('category_name', 'Catégorie'),
      { accessorKey: 'kind', header: 'Type', cell: ({ getValue }) => <Badge>{MENU_KIND_LABELS[getValue<'cooked' | 'resale'>()]}</Badge> },
      moneyCol('price', 'Prix'),
      {
        id: 'recipe', header: 'Recette', enableSorting: false,
        cell: ({ row: { original: r } }) => r.kind === 'resale'
          ? <span className="text-muted-foreground">{r.stock_item_name}</span>
          : r.recipe_lines ? <span className="num">{r.recipe_lines} ingrédient(s)</span> : <Badge tone="warn">Sans recette</Badge>,
      },
      activeCol(),
    ],
    fields: [
      { name: 'name', label: 'Nom du plat / produit', type: 'text', span: 2 },
      { name: 'category_id', label: 'Catégorie', type: 'select', optionsFrom: { endpoint: '/categories', label: (r) => r.name } },
      { name: 'kind', label: 'Type', type: 'select', options: opt(MENU_KINDS, MENU_KIND_LABELS) },
      { name: 'price', label: 'Prix de vente (Ar)', type: 'number', step: '1', inputMode: 'numeric' },
      {
        name: 'stock_item_id', label: 'Produit en stock', type: 'select', nullable: true, hideWhen: (v) => v.kind !== 'resale',
        optionsFrom: { endpoint: '/stock-items', label: (r) => r.name, filter: (r) => r.kind === 'product' },
        help: 'Le stock de ce produit baisse de 1 à chaque vente.',
      },
      { name: 'is_active', label: 'Proposé en caisse', type: 'checkbox' },
    ],
    schema: menuItemSchema,
    defaults: { name: '', category_id: '', kind: 'cooked', price: 0, stock_item_id: '', is_active: true },
    transform: (v) => ({ ...v, stock_item_id: v.kind === 'resale' ? v.stock_item_id : null }),
    rowActions: (row) => row.kind === 'cooked' ? (
      <Button variant="outline" size="sm" onClick={() => setRecipeFor(row)}><ListChecks /> Recette</Button>
    ) : null,
  }), []);
  return (
    <>
      <CrudPage cfg={cfg} />
      {recipeFor && <RecipeDialog item={recipeFor} onClose={() => setRecipeFor(null)} />}
    </>
  );
}

/* ── Ingrédients et produits ── */
export function StockItemsPage() {
  const cfg: CrudConfig<any> = {
    title: 'Ingrédients et produits', singular: 'Article de stock', endpoint: '/stock-items', queryKey: 'stock-items',
    description: "L'unité d'achat (sachet, kg…) est convertie en unité de stock (g, pièce…) grâce au facteur : 1 kg = 1000 g.",
    invalidates: ['stock', 'menu-items'],
    columns: [
      textCol('name', 'Nom'),
      { accessorKey: 'kind', header: 'Type', cell: ({ getValue }) => <Badge>{STOCK_KIND_LABELS[getValue<'ingredient' | 'product'>()]}</Badge> },
      textCol('unit', 'Unité de stock'),
      qtyCol('min_qty', 'Seuil d’alerte', 'unit'),
      { id: 'conv', header: 'Achat', enableSorting: false, cell: ({ row: { original: r } }) => <span className="num">1 {r.purchase_unit} = {fmtQty(r.purchase_factor)} {r.unit}</span> },
      activeCol(),
    ],
    fields: [
      { name: 'name', label: 'Nom', type: 'text', span: 2 },
      { name: 'kind', label: 'Type', type: 'select', options: opt(STOCK_KINDS, STOCK_KIND_LABELS) },
      { name: 'unit', label: 'Unité de stock', type: 'text', placeholder: 'g, ml, pièce…' },
      { name: 'min_qty', label: 'Seuil d’alerte (unité de stock)', type: 'number' },
      { name: 'purchase_unit', label: 'Unité d’achat', type: 'text', placeholder: 'sachet, kg, boîte…' },
      { name: 'purchase_factor', label: 'Facteur de conversion', type: 'number', help: '1 unité d’achat = combien d’unités de stock ?' },
      { name: 'is_active', label: 'Actif', type: 'checkbox' },
    ],
    schema: stockItemSchema,
    defaults: { name: '', kind: 'ingredient', unit: 'g', min_qty: 0, purchase_unit: 'kg', purchase_factor: 1000, is_active: true },
  };
  return <CrudPage cfg={cfg} />;
}

/* ── Fournisseurs ── */
export function SuppliersPage() {
  const cfg: CrudConfig<any> = {
    title: 'Fournisseurs', singular: 'Fournisseur', endpoint: '/suppliers', queryKey: 'suppliers',
    invalidates: ['purchases'],
    columns: [textCol('name', 'Nom'), textCol('phone', 'Téléphone')],
    fields: [{ name: 'name', label: 'Nom', type: 'text' }, { name: 'phone', label: 'Téléphone', type: 'text', nullable: true, inputMode: 'tel' }],
    schema: supplierSchema, defaults: { name: '', phone: '' },
  };
  return <CrudPage cfg={cfg} />;
}

/* ── Achats ── */
export function PurchasesPage() {
  const cfg: CrudConfig<any> = {
    title: 'Achats', singular: 'Achat', endpoint: '/purchases', queryKey: 'purchases',
    description: "Chaque achat augmente automatiquement le stock de l'article concerné.",
    invalidates: ['stock'],
    searchPlaceholder: 'Rechercher un achat…',
    columns: [
      dateCol('date'),
      textCol('stock_item_name', 'Article'),
      { id: 'qty', header: 'Quantité', accessorFn: (r) => r.quantity, cell: ({ row: { original: r } }) => <span className="num">{fmtQty(r.quantity)} {r.purchase_unit}</span> },
      moneyCol('unit_price', 'Prix unitaire'),
      moneyCol('amount', 'Montant'),
      textCol('supplier_name', 'Fournisseur'),
    ],
    fields: [
      { name: 'date', label: 'Date', type: 'date' },
      { name: 'stock_item_id', label: 'Article', type: 'select', optionsFrom: { endpoint: '/stock-items', label: (r) => r.name, filter: (r) => r.is_active } },
      { name: 'quantity', label: 'Quantité (unité d’achat)', type: 'number' },
      { name: 'unit_price', label: 'Prix unitaire (Ar)', type: 'number', step: '1', inputMode: 'numeric' },
      { name: 'supplier_id', label: 'Fournisseur', type: 'select', nullable: true, optionsFrom: { endpoint: '/suppliers', label: (r) => r.name } },
      { name: 'note', label: 'Note', type: 'text', nullable: true },
    ],
    schema: purchaseSchema,
    defaults: { date: todayStr(), stock_item_id: '', quantity: 1, unit_price: 0, supplier_id: '', note: '' },
  };
  return <CrudPage cfg={cfg} />;
}

/* ── Dépenses et charges ── */
export function ExpensesPage() {
  const cfg: CrudConfig<any> = {
    title: 'Dépenses et charges', singular: 'Dépense', endpoint: '/expenses', queryKey: 'expenses',
    description: 'Électricité, gaz, personnel, entretien… (hors achats d’ingrédients).',
    columns: [dateCol('date'), textCol('label', 'Libellé'), textCol('category', 'Catégorie'), moneyCol('amount', 'Montant')],
    fields: [
      { name: 'date', label: 'Date', type: 'date' },
      { name: 'category', label: 'Catégorie', type: 'select', options: opt(EXPENSE_CATEGORIES) },
      { name: 'label', label: 'Libellé', type: 'text', span: 2, placeholder: 'Facture JIRAMA' },
      { name: 'amount', label: 'Montant (Ar)', type: 'number', step: '1', inputMode: 'numeric' },
    ],
    schema: expenseSchema, defaults: { date: todayStr(), category: 'Autre', label: '', amount: 0 },
  };
  return <CrudPage cfg={cfg} />;
}

/* ── Tables ── */
export function TablesPage() {
  const cfg: CrudConfig<any> = {
    title: 'Tables de la salle', singular: 'Table', endpoint: '/tables', queryKey: 'tables',
    invalidates: ['pos-tables'],
    columns: [textCol('name', 'Nom'), textCol('sort_order', 'Ordre'), activeCol()],
    fields: [
      { name: 'name', label: 'Nom', type: 'text', placeholder: 'Table 1' },
      { name: 'sort_order', label: 'Ordre d’affichage', type: 'number', step: '1', inputMode: 'numeric' },
      { name: 'is_active', label: 'Active', type: 'checkbox' },
    ],
    schema: tableSchema, defaults: { name: '', sort_order: 0, is_active: true },
  };
  return <CrudPage cfg={cfg} />;
}

/* ── Utilisateurs ── */
export function UsersPage() {
  const qc = useQueryClient();
  const unlock = useMutation({
    mutationFn: (id: string) => api(`/users/${id}/unlock`, { method: 'POST' }),
    onSuccess: () => { toast.success('Compte déverrouillé'); void qc.invalidateQueries({ queryKey: ['users'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const cfg = useMemo<CrudConfig<any>>(() => ({
    title: 'Utilisateurs', singular: 'Utilisateur', endpoint: '/users', queryKey: 'users',
    description: 'Le gérant voit tout. Le caissier ne voit que la prise de commande par table, l’encaissement et l’impression.',
    columns: [
      textCol('username', 'Identifiant'),
      textCol('full_name', 'Nom'),
      { accessorKey: 'role', header: 'Rôle', cell: ({ getValue }) => <Badge tone={getValue() === 'manager' ? 'ink' : 'neutral'}>{ROLE_LABELS[getValue<'manager' | 'cashier'>()]}</Badge> },
      { accessorKey: 'has_pin', header: 'PIN', cell: ({ getValue }) => (getValue() ? 'Défini' : '—') },
      { accessorKey: 'is_active', header: 'Statut', cell: ({ row: { original: r } }) => r.is_locked ? <Badge tone="danger">Verrouillé</Badge> : r.is_active ? <Badge tone="ok">Actif</Badge> : <Badge>Désactivé</Badge> },
    ],
    fields: [
      { name: 'username', label: 'Identifiant', type: 'text', autoComplete: 'off' },
      { name: 'full_name', label: 'Nom complet', type: 'text' },
      { name: 'role', label: 'Rôle', type: 'select', options: opt(ROLES, ROLE_LABELS) },
      { name: 'is_active', label: 'Compte actif', type: 'checkbox' },
      { name: 'password', label: 'Mot de passe', type: 'password', help: 'Laisser vide pour ne pas le changer.' },
      { name: 'pin', label: 'Code PIN (4 à 6 chiffres)', type: 'password', inputMode: 'numeric', hideWhen: (v) => v.role === 'manager', help: 'Connexion rapide du caissier. Laisser vide pour ne pas le changer.' },
    ],
    schema: userCreateSchema, editSchema: userUpdateSchema,
    defaults: { username: '', full_name: '', role: 'cashier', is_active: true, password: '', pin: '' },
    toForm: (r) => ({ username: r.username, full_name: r.full_name, role: r.role, is_active: r.is_active, password: '', pin: '' }),
    transform: (v) => ({ ...v, pin: v.role === 'manager' ? undefined : v.pin }),
    rowActions: (r) => r.is_locked ? (
      <Button variant="outline" size="sm" onClick={() => unlock.mutate(r.id)}><LockOpen /> Déverrouiller</Button>
    ) : null,
  }), [unlock]);
  return <CrudPage cfg={cfg} />;
}
