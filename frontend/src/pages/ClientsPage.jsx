import { useState, useEffect, useCallback, Fragment } from 'react';
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

const STATUS_VARIANT = {
  active: 'success',
  prospect: 'secondary',
  on_hold: 'secondary',
  inactive: 'destructive',
};

const EMPTY_FORM = {
  companyName: '',
  ownerTeamId: '',
  industry: '',
  website: '',
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  sharedOrgWide: false,
};

export function ClientsPage() {
  const { isOrgAdmin, isManager } = useAuth();
  const canWrite = isOrgAdmin || isManager; // matches backend: org_admin + manager hold clients:write/delete, hr is read-only
  const canShare = isOrgAdmin; // only org_admin holds clients:share

  const [teams, setTeams] = useState([]);
  const [teamFilter, setTeamFilter] = useState('');
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  const [shareRowId, setShareRowId] = useState(null);
  const [shareTeamId, setShareTeamId] = useState('');
  const [shareCanWrite, setShareCanWrite] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const loadTeams = useCallback(async () => {
    const res = await apiFetch('/api/v1/teams');
    setTeams(res.data.teams);
  }, []);

  const loadClients = useCallback(async (teamId) => {
    const qs = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
    const res = await apiFetch(`/api/v1/clients${qs}`);
    setClients(res.data.clients);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([loadTeams(), loadClients(teamFilter)])
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Failed to load clients.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamFilter]);

  function updateForm(field) {
    return (e) => {
      const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      setForm((f) => ({ ...f, [field]: value }));
    };
  }

  async function handleCreate(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch('/api/v1/clients', { method: 'POST', body: form });
      setForm(EMPTY_FORM);
      setShowCreate(false);
      await loadClients(teamFilter);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create client.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStatusChange(client, status) {
    setBusyId(client.id);
    setError(null);
    try {
      await apiFetch(`/api/v1/clients/${client.id}`, { method: 'PATCH', body: { status } });
      await loadClients(teamFilter);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update status.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(client) {
    if (!window.confirm(`Delete ${client.companyName}? This can't be undone.`)) return;
    setBusyId(client.id);
    setError(null);
    try {
      await apiFetch(`/api/v1/clients/${client.id}`, { method: 'DELETE' });
      await loadClients(teamFilter);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete client.');
    } finally {
      setBusyId(null);
    }
  }

  function startShare(client) {
    setShareRowId(client.id);
    setShareTeamId('');
    setShareCanWrite(false);
  }

  async function handleShare(clientId) {
    if (!shareTeamId) return;
    setBusyId(clientId);
    setError(null);
    try {
      await apiFetch(`/api/v1/clients/${clientId}/share`, {
        method: 'POST',
        body: { teamId: shareTeamId, canWrite: shareCanWrite },
      });
      setShareRowId(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not share this client.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AppLayout>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Clients</h1>
          <p className="mt-1 text-sm text-muted-foreground">Client accounts and team access.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-56">
            <NativeSelect value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
              <option value="">All teams</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          {canWrite && (
            <Button onClick={() => setShowCreate((s) => !s)}>{showCreate ? 'Cancel' : 'New Client'}</Button>
          )}
        </div>
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
              <CardTitle>New client</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="companyName">Company name</Label>
                <Input id="companyName" value={form.companyName} onChange={updateForm('companyName')} required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ownerTeamId">Owning team</Label>
                <NativeSelect id="ownerTeamId" value={form.ownerTeamId} onChange={updateForm('ownerTeamId')} required>
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
              <div className="grid gap-2">
                <Label htmlFor="industry">Industry</Label>
                <Input id="industry" value={form.industry} onChange={updateForm('industry')} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="website">Website</Label>
                <Input id="website" value={form.website} onChange={updateForm('website')} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="contactName">Contact name</Label>
                <Input id="contactName" value={form.contactName} onChange={updateForm('contactName')} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="contactEmail">Contact email</Label>
                <Input id="contactEmail" type="email" value={form.contactEmail} onChange={updateForm('contactEmail')} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="contactPhone">Contact phone</Label>
                <Input id="contactPhone" value={form.contactPhone} onChange={updateForm('contactPhone')} />
              </div>
              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <input type="checkbox" checked={form.sharedOrgWide} onChange={updateForm('sharedOrgWide')} />
                Shared org-wide
              </label>
            </CardContent>
            <CardFooter>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Creating…' : 'Create client'}
              </Button>
            </CardFooter>
          </form>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Directory</CardTitle>
          <CardDescription>{clients.length} client(s){teamFilter ? ' for this team' : ''}.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Shared</TableHead>
                  <TableHead>Status</TableHead>
                  {(canWrite || canShare) && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {clients.map((c) => (
                  <Fragment key={c.id}>
                    <TableRow key={c.id}>
                      <TableCell>
                        <div className="font-medium">{c.companyName}</div>
                        {c.industry && <div className="text-xs text-muted-foreground">{c.industry}</div>}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {c.contactName || c.contactEmail || '—'}
                      </TableCell>
                      <TableCell>{c.sharedOrgWide ? <Badge variant="secondary">Org-wide</Badge> : '—'}</TableCell>
                      <TableCell>
                        {canWrite ? (
                          <NativeSelect
                            className="h-8 w-32"
                            value={c.status}
                            disabled={busyId === c.id}
                            onChange={(e) => handleStatusChange(c, e.target.value)}
                          >
                            <option value="prospect">Prospect</option>
                            <option value="active">Active</option>
                            <option value="on_hold">On hold</option>
                            <option value="inactive">Inactive</option>
                          </NativeSelect>
                        ) : (
                          <Badge variant={STATUS_VARIANT[c.status] || 'outline'}>{c.status.replace('_', ' ')}</Badge>
                        )}
                      </TableCell>
                      {(canWrite || canShare) && (
                        <TableCell className="flex justify-end gap-2">
                          {canShare && (
                            <Button size="sm" variant="outline" onClick={() => startShare(c)}>
                              Share
                            </Button>
                          )}
                          {canWrite && (
                            <Button size="sm" variant="outline" disabled={busyId === c.id} onClick={() => handleDelete(c)}>
                              Delete
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                    {shareRowId === c.id && (
                      <TableRow key={`${c.id}-share`}>
                        <TableCell colSpan={5}>
                          <div className="flex items-center gap-3 rounded-md bg-muted/50 p-3">
                            <span className="text-sm font-medium">Share with:</span>
                            <div className="w-48">
                              <NativeSelect value={shareTeamId} onChange={(e) => setShareTeamId(e.target.value)}>
                                <option value="" disabled>
                                  Select a team
                                </option>
                                {teams.filter((t) => t.id !== c.ownerTeamId).map((t) => (
                                  <option key={t.id} value={t.id}>
                                    {t.name}
                                  </option>
                                ))}
                              </NativeSelect>
                            </div>
                            <label className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={shareCanWrite}
                                onChange={(e) => setShareCanWrite(e.target.checked)}
                              />
                              Can edit
                            </label>
                            <Button size="sm" disabled={!shareTeamId || busyId === c.id} onClick={() => handleShare(c.id)}>
                              Confirm
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setShareRowId(null)}>
                              Cancel
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </AppLayout>
  );
}
