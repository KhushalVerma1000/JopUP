import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiFetch, ApiError } from '../lib/api';
import { AppLayout } from '../components/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { NativeSelect } from '@/components/ui/native-select';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { cn } from '@/lib/utils';

const TABS = [
  { key: 'settings', label: 'Org settings' },
  { key: 'teams', label: 'Teams' },
  { key: 'invitations', label: 'Invitations' },
];

export function ManagerialPage() {
  const [tab, setTab] = useState('settings');

  return (
    <AppLayout>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Managerial</h1>
        <p className="mt-1 text-sm text-muted-foreground">Org settings, teams, and invitations.</p>
      </div>

      <div className="mb-6 flex gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              'border-b-2 px-4 py-2 text-sm font-medium transition-colors',
              tab === t.key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'settings' && <OrgSettingsTab />}
      {tab === 'teams' && <TeamsTab />}
      {tab === 'invitations' && <InvitationsTab />}
    </AppLayout>
  );
}

// ── Org settings ─────────────────────────────────────────────────────────
function OrgSettingsTab() {
  const { isOrgAdmin } = useAuth();
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiFetch('/api/v1/organizations/me')
      .then((res) => {
        const org = res.data.organization;
        setForm({ name: org.name || '', domain: org.domain || '', logoUrl: org.logoUrl || '', timezone: org.timezone || '' });
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load organisation.'))
      .finally(() => setLoading(false));
  }, []);

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await apiFetch('/api/v1/organizations/me', { method: 'PATCH', body: form });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save changes.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!form) return <p className="text-sm text-destructive">{error}</p>;

  return (
    <Card className="max-w-xl">
      <form onSubmit={handleSave}>
        <CardHeader>
          <CardTitle>Organisation profile</CardTitle>
          {!isOrgAdmin && <CardDescription>Only an org admin can make changes here.</CardDescription>}
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="org-name">Name</Label>
            <Input id="org-name" value={form.name} onChange={update('name')} disabled={!isOrgAdmin} required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="org-domain">Domain</Label>
            <Input id="org-domain" value={form.domain} onChange={update('domain')} disabled={!isOrgAdmin} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="org-logo">Logo URL</Label>
            <Input id="org-logo" value={form.logoUrl} onChange={update('logoUrl')} disabled={!isOrgAdmin} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="org-timezone">Timezone</Label>
            <Input id="org-timezone" value={form.timezone} onChange={update('timezone')} disabled={!isOrgAdmin} placeholder="Asia/Kolkata" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {saved && <p className="text-sm text-success">Saved.</p>}
        </CardContent>
        {isOrgAdmin && (
          <CardFooter>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </CardFooter>
        )}
      </form>
    </Card>
  );
}

// ── Teams ─────────────────────────────────────────────────────────────────
function TeamsTab() {
  const { isOrgAdmin } = useAuth();
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    const res = await apiFetch('/api/v1/teams');
    setTeams(res.data.teams);
  }, []);

  useEffect(() => {
    setLoading(true);
    load()
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load teams.'))
      .finally(() => setLoading(false));
  }, [load]);

  async function handleCreate(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch('/api/v1/teams', { method: 'POST', body: { name, description } });
      setName('');
      setDescription('');
      setShowCreate(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create team.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleArchiveToggle(team) {
    const status = team.status === 'archived' ? 'active' : 'archived';
    setBusyId(team.id);
    setError(null);
    try {
      await apiFetch(`/api/v1/teams/${team.id}`, { method: 'PATCH', body: { status } });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update team.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(team) {
    if (!window.confirm(`Delete ${team.name}? This can't be undone.`)) return;
    setBusyId(team.id);
    setError(null);
    try {
      await apiFetch(`/api/v1/teams/${team.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete team — it may still have members or clients assigned.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="mb-4 flex justify-end">
        {isOrgAdmin && <Button onClick={() => setShowCreate((s) => !s)}>{showCreate ? 'Cancel' : 'New Team'}</Button>}
      </div>

      {error && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {showCreate && (
        <Card className="mb-6">
          <form onSubmit={handleCreate}>
            <CardHeader>
              <CardTitle>New team</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="team-name">Name</Label>
                <Input id="team-name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="team-description">Description</Label>
                <Input id="team-description" value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
            </CardContent>
            <CardFooter>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Creating…' : 'Create team'}
              </Button>
            </CardFooter>
          </form>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Status</TableHead>
                  {isOrgAdmin && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {teams.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell className="text-muted-foreground">{t.description || '—'}</TableCell>
                    <TableCell>
                      <Badge variant={t.status === 'archived' ? 'outline' : 'success'}>{t.status}</Badge>
                    </TableCell>
                    {isOrgAdmin && (
                      <TableCell className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" disabled={busyId === t.id} onClick={() => handleArchiveToggle(t)}>
                          {t.status === 'archived' ? 'Reactivate' : 'Archive'}
                        </Button>
                        <Button size="sm" variant="outline" disabled={busyId === t.id} onClick={() => handleDelete(t)}>
                          Delete
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Invitations ───────────────────────────────────────────────────────────
const INVITABLE_ROLES = ['manager', 'hr', 'org_admin'];

function InvitationsTab() {
  const [teams, setTeams] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState(null);

  const [showCreate, setShowCreate] = useState(false);
  const [email, setEmail] = useState('');
  const [roleName, setRoleName] = useState('hr');
  const [teamId, setTeamId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    const [teamsRes, invitesRes] = await Promise.all([
      apiFetch('/api/v1/teams'),
      apiFetch('/api/v1/invitations'),
    ]);
    setTeams(teamsRes.data.teams);
    setInvitations(invitesRes.data.invitations);
  }, []);

  useEffect(() => {
    setLoading(true);
    load()
      .catch((err) => {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          setForbidden(true);
        } else {
          setError(err instanceof ApiError ? err.message : 'Failed to load invitations.');
        }
      })
      .finally(() => setLoading(false));
  }, [load]);

  async function handleCreate(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch('/api/v1/invitations', {
        method: 'POST',
        body: { email, roleName, teamId: roleName === 'org_admin' ? undefined : teamId },
      });
      setEmail('');
      setTeamId('');
      setShowCreate(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send invitation.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevoke(id) {
    setBusyId(id);
    setError(null);
    try {
      await apiFetch(`/api/v1/invitations/${id}/revoke`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not revoke this invitation.');
    } finally {
      setBusyId(null);
    }
  }

  function copyToken(token) {
    navigator.clipboard?.writeText(token);
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  if (forbidden) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          You don't have permission to view or send invitations — only an org admin can.
        </CardContent>
      </Card>
    );
  }

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setShowCreate((s) => !s)}>{showCreate ? 'Cancel' : 'New Invitation'}</Button>
      </div>

      {error && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {showCreate && (
        <Card className="mb-6">
          <form onSubmit={handleCreate}>
            <CardHeader>
              <CardTitle>New invitation</CardTitle>
              <CardDescription>
                No email provider is wired up yet — after sending, copy the token from the table below and share it
                with the invitee directly.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="invite-email">Email</Label>
                <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="invite-role">Role</Label>
                <NativeSelect id="invite-role" value={roleName} onChange={(e) => setRoleName(e.target.value)}>
                  {INVITABLE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              {roleName !== 'org_admin' && (
                <div className="grid gap-2">
                  <Label htmlFor="invite-team">Team</Label>
                  <NativeSelect id="invite-team" value={teamId} onChange={(e) => setTeamId(e.target.value)} required>
                    <option value="" disabled>
                      Select a team
                    </option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              )}
            </CardContent>
            <CardFooter>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Sending…' : 'Send invitation'}
              </Button>
            </CardFooter>
          </form>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Team</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invitations.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell>{inv.email}</TableCell>
                  <TableCell className="capitalize">{inv.roleName || '—'}</TableCell>
                  <TableCell>{inv.teamName || '—'}</TableCell>
                  <TableCell>
                    <Badge variant={inv.status === 'pending' ? 'secondary' : inv.status === 'accepted' ? 'success' : 'outline'}>
                      {inv.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="flex justify-end gap-2">
                    {inv.status === 'pending' && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => copyToken(inv.token)}>
                          Copy token
                        </Button>
                        <Button size="sm" variant="outline" disabled={busyId === inv.id} onClick={() => handleRevoke(inv.id)}>
                          Revoke
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
