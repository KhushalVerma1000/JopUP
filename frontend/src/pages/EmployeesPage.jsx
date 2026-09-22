import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiFetch, ApiError } from '../lib/api';
import { AppLayout } from '../components/AppLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { NativeSelect } from '@/components/ui/native-select';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

const STATUS_VARIANT = {
  active: 'success',
  invited: 'secondary',
  pending_approval: 'secondary',
  rejected: 'destructive',
  suspended: 'destructive',
  inactive: 'outline',
};

function StatusBadge({ status }) {
  return <Badge variant={STATUS_VARIANT[status] || 'outline'}>{status.replace('_', ' ')}</Badge>;
}

export function EmployeesPage() {
  const { user, isOrgAdmin } = useAuth();

  const [teams, setTeams] = useState([]);
  const [teamFilter, setTeamFilter] = useState('');
  const [employees, setEmployees] = useState([]);
  const [pending, setPending] = useState([]);
  // null = haven't checked yet, false = checked and not permitted (hide
  // the section silently — a 403 here just means "you're not a manager or
  // org_admin", not an error worth surfacing).
  const [pendingVisible, setPendingVisible] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const loadTeams = useCallback(async () => {
    const res = await apiFetch('/api/v1/teams');
    setTeams(res.data.teams);
  }, []);

  const loadEmployees = useCallback(async (teamId) => {
    const qs = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
    const res = await apiFetch(`/api/v1/users${qs}`);
    setEmployees(res.data.users);
  }, []);

  const loadPending = useCallback(async () => {
    try {
      const res = await apiFetch('/api/v1/auth/pending-approvals');
      setPending(res.data.pendingUsers);
      setPendingVisible(true);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        setPendingVisible(false);
      } else {
        throw err;
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([loadTeams(), loadEmployees(teamFilter), loadPending()])
      .catch((err) => {
        if (!cancelled) setActionError(err instanceof ApiError ? err.message : 'Failed to load employees.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamFilter]);

  async function handleApprove(id) {
    setBusyId(id);
    setActionError(null);
    try {
      await apiFetch(`/api/v1/auth/pending-approvals/${id}/approve`, { method: 'POST' });
      await Promise.all([loadPending(), loadEmployees(teamFilter)]);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not approve this request.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(id) {
    setBusyId(id);
    setActionError(null);
    try {
      await apiFetch(`/api/v1/auth/pending-approvals/${id}/reject`, { method: 'POST' });
      await loadPending();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not reject this request.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggleStatus(employee) {
    const nextStatus = employee.status === 'active' ? 'suspended' : 'active';
    setBusyId(employee.id);
    setActionError(null);
    try {
      await apiFetch(`/api/v1/users/${employee.id}/status`, {
        method: 'PATCH',
        body: { status: nextStatus },
      });
      await loadEmployees(teamFilter);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not update status.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AppLayout>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Employees</h1>
          <p className="mt-1 text-sm text-muted-foreground">Staff directory and pending access requests.</p>
        </div>
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
      </div>

      {actionError && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {actionError}
        </p>
      )}

      {pendingVisible && pending.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Pending approvals</CardTitle>
            <CardDescription>{pending.length} request(s) waiting for a decision.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Requested role</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      {p.firstName} {p.lastName}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{p.email}</TableCell>
                    <TableCell className="capitalize">{p.requestedRoleName || '—'}</TableCell>
                    <TableCell>{p.requestedTeamName || '—'}</TableCell>
                    <TableCell className="flex justify-end gap-2">
                      <Button size="sm" disabled={busyId === p.id} onClick={() => handleApprove(p.id)}>
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === p.id}
                        onClick={() => handleReject(p.id)}
                      >
                        Reject
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Directory</CardTitle>
          <CardDescription>{employees.length} employee(s){teamFilter ? ' in this team' : ''}.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Roles</TableHead>
                  <TableHead>Status</TableHead>
                  {isOrgAdmin && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {employees.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>
                      {e.firstName} {e.lastName}
                      {e.id === user.id && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{e.email}</TableCell>
                    <TableCell className="capitalize">
                      {(e.roles || []).map((r) => r.roleName).join(', ') || '—'}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={e.status} />
                    </TableCell>
                    {isOrgAdmin && (
                      <TableCell className="text-right">
                        {e.id !== user.id && (e.status === 'active' || e.status === 'suspended') && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyId === e.id}
                            onClick={() => handleToggleStatus(e)}
                          >
                            {e.status === 'active' ? 'Suspend' : 'Reactivate'}
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </AppLayout>
  );
}
