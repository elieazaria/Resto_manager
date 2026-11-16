import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { can } from '@resto/shared';
import { useAuth } from '@/lib/auth';
import { NAV } from '@/lib/nav';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Recherche rapide d'une rubrique (Ctrl/⌘ + K). */
export function GlobalSearch() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const items = NAV.filter((n) => can(user?.role, n.perm));
    const t = norm(q.trim());
    if (!t) return items.slice(0, 8);
    return items.filter((n) => norm(`${n.label} ${n.group ?? ''}`).includes(t)).slice(0, 8);
  }, [q, user?.role]);

  useEffect(() => setIdx(0), [q]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); ref.current?.focus(); setOpen(true); } };
    const click = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('keydown', k); document.addEventListener('mousedown', click);
    return () => { window.removeEventListener('keydown', k); document.removeEventListener('mousedown', click); };
  }, []);

  const go = (to: string) => { nav(to); setQ(''); setOpen(false); ref.current?.blur(); };

  return (
    <div ref={box} className="relative min-w-0 flex-1 sm:max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={ref}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, results.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
          else if (e.key === 'Enter' && results[idx]) go(results[idx]!.to);
          else if (e.key === 'Escape') { setOpen(false); ref.current?.blur(); }
        }}
        placeholder="Rechercher une rubrique…"
        aria-label="Rechercher une rubrique"
        className="h-10 w-full rounded-full border border-border bg-card pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
      />
      {open && (
        <ul className="absolute left-0 right-0 top-12 z-40 max-h-80 overflow-y-auto rounded-xl border border-border bg-card p-1 shadow-lg" role="listbox">
          {results.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">Aucune rubrique trouvée.</li>}
          {results.map((n, i) => (
            <li key={n.to} role="option" aria-selected={i === idx}>
              <button type="button" onMouseEnter={() => setIdx(i)} onClick={() => go(n.to)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${i === idx ? 'bg-muted' : ''}`}>
                <n.icon className="size-4 text-primary" />
                <span className="flex-1">{n.label}</span>
                {n.group && <span className="text-xs text-muted-foreground">{n.group}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
