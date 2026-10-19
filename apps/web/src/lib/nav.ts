import { BarChart3, BookOpen, Boxes, ClipboardList, Receipt, Settings, ShoppingBasket, Store, Tags, Truck, Users, UtensilsCrossed, Wallet, Grid2x2, ShoppingCart, type LucideIcon } from 'lucide-react';
import type { Permission } from '@resto/shared';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  perm: Permission;
  group?: string;
}

export const NAV: NavItem[] = [
  { to: '/dashboard', label: 'Tableau de bord', icon: BarChart3, perm: 'admin' },
  { to: '/pos', label: 'Caisse', icon: Store, perm: 'pos' },
  { to: '/pos/vente', label: 'Nouvelle vente', icon: ShoppingCart, perm: 'pos' },
  { to: '/orders', label: 'Commandes du jour', icon: ClipboardList, perm: 'orders:read' },
  { to: '/sales', label: 'Ventes', icon: Receipt, perm: 'admin', group: 'Gestion' },
  { to: '/menu', label: 'Menu et recettes', icon: UtensilsCrossed, perm: 'admin', group: 'Gestion' },
  { to: '/categories', label: 'Catégories', icon: Tags, perm: 'admin', group: 'Gestion' },
  { to: '/stock', label: 'Niveaux de stock', icon: Boxes, perm: 'admin', group: 'Stock' },
  { to: '/stock-items', label: 'Ingrédients et produits', icon: BookOpen, perm: 'admin', group: 'Stock' },
  { to: '/purchases', label: 'Achats', icon: ShoppingBasket, perm: 'admin', group: 'Stock' },
  { to: '/suppliers', label: 'Fournisseurs', icon: Truck, perm: 'admin', group: 'Stock' },
  { to: '/expenses', label: 'Dépenses et charges', icon: Wallet, perm: 'admin', group: 'Finances' },
  { to: '/tables', label: 'Tables de la salle', icon: Grid2x2, perm: 'admin', group: 'Réglages' },
  { to: '/users', label: 'Utilisateurs', icon: Users, perm: 'admin', group: 'Réglages' },
  { to: '/settings', label: 'Restaurant et ticket', icon: Settings, perm: 'admin', group: 'Réglages' },
];
