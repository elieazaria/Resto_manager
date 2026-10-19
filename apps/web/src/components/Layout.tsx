import { useMemo, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { CloudOff, KeyRound, LogOut, Menu, Printer, Wifi } from 'lucide-react';
import { can, ROLE_LABELS } from '@resto/shared';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { useAuth } from '@/lib/auth';
import { NAV } from '@/lib/nav';
import { outbox, useOutbox } from '@/lib/outbox';
import { useRealtime } from '@/lib/realtime';
import { cn } from '@/lib/utils';
import { ChangePasswordDialog } from './ChangePasswordDialog';
import { DeviceDialog } from './DeviceDialog';
import { OutboxDialog } from './OutboxDialog';
import { PrintHost } from './PrintHost';

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth();
  const groups = useMemo(() => {
    const items = NAV.filter((n) => can(user?.role, n.perm));
    const out: { name?: string; items: typeof items }[] = [];
    for (const it of items) {
      const last = out[out.length - 1];
      if (last && last.name === it.group) last.items.push(it);
      else out.push({ name: it.group, items: [it] });
    }
    return out;
  }, [user?.role]);
  return (
    <nav className="space-y-4" aria-label="Navigation principale">
      {groups.map((g, i) => (
        <div key={i}>
          {g.name && <p className="mb-1 px-3 text-xs font-medium text-ink-foreground/55">{g.name}</p>}
          <ul className="space-y-0.5">
            {g.items.map((n) => (
              <li key={n.to}>
                <NavLink
                  to={n.to}
                  end={n.to === '/pos'}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn('flex items-center gap-3 rounded-md border-l-[3px] px-3 py-2.5 text-[15px] transition-colors',
                      isActive ? 'border-accent bg-white/10 font-medium text-white' : 'border-transparent text-ink-foreground/80 hover:bg-white/5')
                  }
                >
                  <n.icon className="size-[18px]" /> {n.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function Layout() {
  const { user, logout } = useAuth();
  const link = useRealtime(!!user);
  const pending = useOutbox();
  const [drawer, setDrawer] = useState(false);
  const [device, setDevice] = useState(false);
  const [pwd, setPwd] = useState(false);
  const [box, setBox] = useState(false);
  const stuck = pending.filter((p) => p.error).length;

  const doLogout = () => {
    if (outbox.all().length && !window.confirm('Des opérations hors-ligne ne sont pas encore envoyées. Se déconnecter quand même ?')) return;
    logout();
  };

  const Account = (
    <div className="space-y-1 border-t border-white/10 pt-3 text-ink-foreground/85">
      <div className="px-3 pb-2">
        <p className="truncate font-medium text-white">{user?.full_name}</p>
        <Badge tone="warn" className="mt-1">{user && ROLE_LABELS[user.role]}</Badge>
      </div>
      {[{ i: Printer, l: 'Impression', f: () => setDevice(true) }, { i: KeyRound, l: 'Mot de passe', f: () => setPwd(true) }, { i: LogOut, l: 'Se déconnecter', f: doLogout }].map(({ i: I, l, f }) => (
        <button key={l} onClick={() => { setDrawer(false); f(); }} className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-[15px] hover:bg-white/5">
          <I className="size-[18px]" /> {l}
        </button>
      ))}
    </div>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[17rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col justify-between overflow-y-auto bg-ink p-4 lg:flex">
        <div className="space-y-6">
          <p className="px-3 pt-1 font-display text-xl font-semibold text-white">Resto <span className="text-accent">Manager</span></p>
          <NavList />
        </div>
        {Account}
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/95 px-3 pt-[env(safe-area-inset-top)] backdrop-blur sm:px-5">
          <button className="rounded-md p-2 hover:bg-muted lg:hidden" onClick={() => setDrawer(true)} aria-label="Ouvrir le menu"><Menu className="size-5" /></button>
          <p className="font-display text-lg font-semibold lg:hidden">Resto <span className="text-primary">Manager</span></p>
          <div className="ml-auto flex items-center gap-2">
            {pending.length > 0 && (
              <button onClick={() => setBox(true)} className={cn('rounded-full px-3 py-1 text-xs font-medium', stuck ? 'bg-destructive/12 text-destructive' : 'bg-accent/40 text-[#5c3d00]')}>
                {stuck ? `${stuck} refusée(s)` : `${pending.length} en attente d'envoi`}
              </button>
            )}
            <span className={cn('flex items-center gap-1.5 text-xs', link === 'live' ? 'text-primary' : 'text-muted-foreground')} role="status">
              {link === 'live' ? <Wifi className="size-4" /> : <CloudOff className="size-4" />}
              <span className="hidden sm:inline">{link === 'live' ? 'En ligne' : link === 'connecting' ? 'Connexion…' : 'Hors-ligne'}</span>
            </span>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-3 py-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-6">
          <Outlet />
        </main>
      </div>

      <Dialog open={drawer} onOpenChange={setDrawer}>
        <DialogContent side="left" className="bg-ink p-4 text-ink-foreground">
          <DialogHeader title="Menu" />
          <div className="flex-1 space-y-6 overflow-y-auto pt-4"><NavList onNavigate={() => setDrawer(false)} /></div>
          {Account}
        </DialogContent>
      </Dialog>
      <DeviceDialog open={device} onOpenChange={setDevice} />
      <ChangePasswordDialog open={pwd} onOpenChange={setPwd} />
      <OutboxDialog open={box} onOpenChange={setBox} />
      <PrintHost />
    </div>
  );
}
