import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { z } from 'zod';
import { changePasswordSchema, type AuthResponse } from '@resto/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Input, Label } from '@/components/ui/input';
import { api, TOKEN_KEY } from '@/lib/api';
import { errorMessage } from '@/lib/utils';

const schema = changePasswordSchema.extend({ confirm: z.string() }).refine((v) => v.new_password === v.confirm, { path: ['confirm'], message: 'Les deux mots de passe diffèrent' });

export function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  const onSubmit = handleSubmit(async ({ current_password, new_password }) => {
    try {
      const res = await api<AuthResponse>('/auth/change-password', { method: 'POST', body: { current_password, new_password } });
      localStorage.setItem(TOKEN_KEY, res.token); // les autres sessions de ce compte sont révoquées
      toast.success('Mot de passe modifié');
      reset();
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader title="Changer mon mot de passe" />
          <DialogBody className="space-y-3">
            {([['current_password', 'Mot de passe actuel', 'current-password'], ['new_password', 'Nouveau mot de passe', 'new-password'], ['confirm', 'Confirmer le nouveau mot de passe', 'new-password']] as const).map(([name, label, ac]) => (
              <div key={name} className="space-y-1.5">
                <Label htmlFor={name}>{label}</Label>
                <Input id={name} type="password" autoComplete={ac} aria-invalid={!!errors[name]} {...register(name)} />
                {errors[name] && <p className="text-xs text-destructive">{errors[name]?.message}</p>}
              </div>
            ))}
          </DialogBody>
          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>Enregistrer</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
