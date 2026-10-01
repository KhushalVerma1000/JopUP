import { useState } from 'react';
import { UserPlus, Trash2 } from 'lucide-react';
import { AppLayout } from '../../components/AppLayout';
import { useAuth } from '../../context/AuthContext';
import { useFetch, errorMessage } from '../../hooks/useFetch';
import { apiFetch } from '../../lib/api';
import { PageHeader, ErrorNote, Loading, Sheet, Avatar, StatusPill } from '@/components/common';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { relativeTime, fullName } from '../../lib/format';

const EMPTY = { firstName: '', lastName: '', email: '', password: '' };

/** Owner-only: manage platform_admin sub-admins (GET/POST/DELETE /platform-admins). */
export function PlatformTeam() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useFetch('/api/v1/platform-admins');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState(null);
  const [actionError, setActionError] = useState(null);

  const update = (f) => (e) => setForm((s) => ({ ...s, [f]: e.target.value }));

  async function handleCreate(e) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await apiFetch('/api/v1/platform-admins', { method: 'POST', body: form });
      setOpen(false);
      setForm(EMPTY);
      await reload();
    } catch (err) {
      setFormError(errorMessage(err, 'Could not create the admin.'));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(a) {
    if (!window.confirm(`Remove ${fullName(a)} as a platform admin?`)) return;
    setActionError(null);
    try {
      await apiFetch(`/api/v1/platform-admins/${a.id}`, { method: 'DELETE' });
      await reload();
    } catch (err) {
      setActionError(errorMessage(err, 'Could not remove the admin.'));
    }
  }

  return (
    <AppLayout wide>
      <PageHeader
        title="Platform team"
        subtitle="Owner and admins who can manage every organisation."
        action={<Button onClick={() => setOpen(true)}><UserPlus /> Add admin</Button>}
      />
      <ErrorNote onRetry={reload}>{error}</ErrorNote>
      <ErrorNote>{actionError}</ErrorNote>
      {loading && !data && <Loading />}

      <Card className="divide-y p-0">
        {(data?.admins || []).map((a) => (
          <div key={a.id} className="flex items-center gap-3 px-4 py-3">
            <Avatar name={fullName(a)} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{fullName(a)}{a.id === user.id && <span className="text-muted-foreground"> (you)</span>}</div>
              <div className="truncate text-xs text-muted-foreground">{a.email} · seen {relativeTime(a.lastLoginAt)}</div>
            </div>
            <StatusPill status={a.role === 'platform_owner' ? 'active' : 'draft'}>{a.role === 'platform_owner' ? 'Owner' : 'Admin'}</StatusPill>
            {a.role !== 'platform_owner' && (
              <Button variant="ghost" size="icon" aria-label={`Remove ${fullName(a)}`} onClick={() => handleRemove(a)}><Trash2 /></Button>
            )}
          </div>
        ))}
      </Card>

      <Sheet open={open} onClose={() => setOpen(false)} title="Add platform admin">
        <form onSubmit={handleCreate} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2"><Label htmlFor="pa-first">First name</Label><Input id="pa-first" value={form.firstName} onChange={update('firstName')} required /></div>
            <div className="grid gap-2"><Label htmlFor="pa-last">Last name</Label><Input id="pa-last" value={form.lastName} onChange={update('lastName')} required /></div>
          </div>
          <div className="grid gap-2"><Label htmlFor="pa-email">Email</Label><Input id="pa-email" type="email" inputMode="email" autoCapitalize="none" value={form.email} onChange={update('email')} required /></div>
          <div className="grid gap-2"><Label htmlFor="pa-pass">Temporary password</Label><Input id="pa-pass" type="password" minLength={8} value={form.password} onChange={update('password')} required autoComplete="new-password" /></div>
          <ErrorNote>{formError}</ErrorNote>
          <Button type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add admin'}</Button>
        </form>
      </Sheet>
    </AppLayout>
  );
}
