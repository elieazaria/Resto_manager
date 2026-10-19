import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { can, type Permission } from '@resto/shared';
import { Layout } from '@/components/Layout';
import { useAuth } from '@/lib/auth';
import Login from '@/pages/Login';
import OrdersPage from '@/pages/OrdersPage';
import OrderPage from '@/pages/pos/OrderPage';
import PosTablesPage from '@/pages/pos/TablesPage';
import QuickSalePage from '@/pages/pos/QuickSalePage';

// Pages réservées au gérant : chargées à la demande (le caissier ne télécharge ni Recharts ni les écrans de gestion)
const Dashboard = lazy(() => import('@/pages/admin/DashboardPage'));
const StockPage = lazy(() => import('@/pages/admin/StockPage'));
const SettingsPage = lazy(() => import('@/pages/admin/SettingsPage'));
const lazyNamed = <K extends string>(k: K) => lazy(() => import('@/pages/admin/crudPages').then((m) => ({ default: (m as any)[k] as () => ReactNode })));
const Categories = lazyNamed('CategoriesPage');
const Menu = lazyNamed('MenuPage');
const StockItems = lazyNamed('StockItemsPage');
const Suppliers = lazyNamed('SuppliersPage');
const Purchases = lazyNamed('PurchasesPage');
const Expenses = lazyNamed('ExpensesPage');
const Tables = lazyNamed('TablesPage');
const Users = lazyNamed('UsersPage');

function Guard({ perm, children }: { perm: Permission; children: ReactNode }) {
  const { user, ready } = useAuth();
  const loc = useLocation();
  if (!ready) return <p className="p-10 text-center text-muted-foreground">Chargement…</p>;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (!can(user.role, perm)) return <Navigate to="/" replace />;
  return <Suspense fallback={<p className="p-10 text-center text-muted-foreground">Chargement…</p>}>{children}</Suspense>;
}

function Home() {
  const { user, ready } = useAuth();
  if (!ready) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={can(user.role, 'admin') ? '/dashboard' : '/pos'} replace />;
}

function Shell() {
  const { user, ready } = useAuth();
  if (!ready) return <p className="p-10 text-center text-muted-foreground">Chargement…</p>;
  if (!user) return <Navigate to="/login" replace />;
  return <Layout />;
}

export default function App() {
  const admin = (el: ReactNode) => <Guard perm="admin">{el}</Guard>;
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<Shell />}>
          <Route index element={<Home />} />
          <Route path="/pos" element={<Guard perm="pos"><PosTablesPage /></Guard>} />
          <Route path="/pos/vente" element={<Guard perm="pos"><QuickSalePage /></Guard>} />
          <Route path="/pos/table/:tableId" element={<Guard perm="pos"><OrderPage /></Guard>} />
          <Route path="/orders" element={<Guard perm="orders:read"><OrdersPage mode="today" /></Guard>} />
          <Route path="/dashboard" element={admin(<Dashboard />)} />
          <Route path="/sales" element={admin(<OrdersPage mode="sales" />)} />
          <Route path="/menu" element={admin(<Menu />)} />
          <Route path="/categories" element={admin(<Categories />)} />
          <Route path="/stock" element={admin(<StockPage />)} />
          <Route path="/stock-items" element={admin(<StockItems />)} />
          <Route path="/purchases" element={admin(<Purchases />)} />
          <Route path="/suppliers" element={admin(<Suppliers />)} />
          <Route path="/expenses" element={admin(<Expenses />)} />
          <Route path="/tables" element={admin(<Tables />)} />
          <Route path="/users" element={admin(<Users />)} />
          <Route path="/settings" element={admin(<SettingsPage />)} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
