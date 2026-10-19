import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { PinPad } from '@/components/PinPad';
import { useAuth } from '@/lib/auth';
import { cn, errorMessage } from '@/lib/utils';

const LAST_USER = 'resto.lastUser';
const read = () => {
  try {
    return localStorage.getItem(LAST_USER) ?? '';
  } catch {
    return '';
  }
};

export default function Login() {
  const { user, login, pinLogin } = useAuth();
  const loc = useLocation();
  const [mode, setMode] = useState<'pin' | 'password'>('pin');
  const [username, setUsername] = useState(read);
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={(loc.state as { from?: string } | null)?.from ?? '/'} replace />;

  const submit = async () => {
    if (!username.trim()) return toast.error('Saisissez votre identifiant');
    setBusy(true);
    try {
      if (mode === 'pin') await pinLogin(username.trim(), pin);
      else await login(username.trim(), password);
      try {
        localStorage.setItem(LAST_USER, username.trim());
      } catch {
        /* ignore */
      }
    } catch (e) {
      setPin('');
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <section className="hidden flex-col justify-between bg-ink p-12 text-ink-foreground lg:flex">
        <p className="font-display text-2xl font-semibold text-white">Resto <span className="text-accent">Manager</span></p>
        <div>
          <h1 className="font-display text-5xl font-semibold leading-[1.05] text-white">La salle, la caisse<br />et le stock dans la même main.</h1>
          <p className="mt-5 max-w-md text-lg text-ink-foreground/75">Prise de commande par table, ticket imprimé, stock décompté à chaque vente.</p>
        </div>
        <p className="text-sm text-ink-foreground/55">Fonctionne sur ordinateur, tablette et téléphone, même si le réseau coupe.</p>
      </section>

      <main className="flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-sm space-y-6">
          <div className="lg:hidden"><p className="font-display text-2xl font-semibold">Resto <span className="text-primary">Manager</span></p></div>
          <div>
            <h2 className="font-display text-3xl font-semibold">Connexion</h2>
            <p className="mt-1 text-sm text-muted-foreground">{mode === 'pin' ? 'Caissier : identifiant et code PIN.' : 'Gérant : identifiant et mot de passe.'}</p>
          </div>

          <div className="grid grid-cols-2 rounded-lg bg-muted p-1" role="tablist">
            {([['pin', 'Code PIN'], ['password', 'Mot de passe']] as const).map(([k, l]) => (
              <button key={k} role="tab" aria-selected={mode === k} onClick={() => setMode(k)}
                className={cn('h-10 rounded-md text-sm font-medium', mode === k ? 'bg-card shadow-sm' : 'text-muted-foreground')}>{l}</button>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="username">Identifiant</Label>
            <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" autoCorrect="off" />
          </div>

          {mode === 'pin' ? (
            <PinPad value={pin} onChange={setPin} onSubmit={submit} disabled={busy} />
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="password">Mot de passe</Label>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
              </div>
              <Button type="submit" size="lg" className="w-full" disabled={busy || !password}>Se connecter</Button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
