import { useState, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useOrgLookup } from '../hooks/useOrgLookup';
import { WorkspaceStep } from '../components/WorkspaceStep';
import { ApiError } from '../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';

export function RegisterPage() {
  const { orgSlug } = useParams();
  const navigate = useNavigate();

  if (!orgSlug) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-muted p-6">
        <WorkspaceStep
          title="Request access"
          onSubmit={(slug) => navigate(`/register/${encodeURIComponent(slug)}`, { replace: true })}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted p-6">
      <RegisterForm orgSlug={orgSlug} />
    </div>
  );
}

function RegisterForm({ orgSlug }) {
  const { register } = useAuth();
  const navigate = useNavigate();
  const { organization, teams, loading, error: lookupError } = useOrgLookup(orgSlug, { withTeams: true });

  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    teamId: '',
    requestedRoleName: 'hr',
  });
  const [error, setError] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Default the team dropdown to the first team once teams load, so the
  // field isn't left on a blank option if there's only one team anyway.
  useEffect(() => {
    if (teams.length > 0 && !form.teamId) {
      setForm((f) => ({ ...f, teamId: teams[0].id }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teams]);

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // organisationId and teamId are UUIDs resolved from the URL slug and
      // the dropdown selection above — the person never sees or types
      // either one directly.
      await register({ ...form, organisationId: organization.id });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <Card className="w-full max-w-sm">
        <CardContent className="pt-6 text-sm text-muted-foreground">
          Looking up workspace…
        </CardContent>
      </Card>
    );
  }

  if (lookupError) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Request access</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-destructive">{lookupError}</p>
          <Link to="/register" className="text-sm underline underline-offset-4">
            Try a different workspace
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (submitted) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Request sent</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Your account is pending approval from a manager or org admin at{' '}
            <span className="font-medium text-foreground">{organization.name}</span>. You'll be
            able to sign in once it's approved.
          </p>
          <Button type="button" onClick={() => navigate(`/login/${encodeURIComponent(orgSlug)}`)}>
            Back to sign in
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <form onSubmit={handleSubmit}>
        <CardHeader>
          <CardTitle className="text-xl">Request access</CardTitle>
          <CardDescription>
            Workspace: <span className="font-medium text-foreground">{organization.name}</span>{' '}
            · <Link to="/register" className="underline underline-offset-4">not you?</Link>
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="firstName">First name</Label>
              <Input id="firstName" type="text" value={form.firstName} onChange={update('firstName')} required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="lastName">Last name</Label>
              <Input id="lastName" type="text" value={form.lastName} onChange={update('lastName')} required />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="reg-email">Email</Label>
            <Input id="reg-email" type="email" value={form.email} onChange={update('email')} required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="reg-password">Password</Label>
            <Input
              id="reg-password"
              type="password"
              value={form.password}
              onChange={update('password')}
              required
              minLength={8}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="team">Team</Label>
            {teams.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                This workspace has no teams set up yet — ask your admin to create one first.
              </p>
            ) : (
              <NativeSelect id="team" value={form.teamId} onChange={update('teamId')} required>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="role">Role</Label>
            <NativeSelect id="role" value={form.requestedRoleName} onChange={update('requestedRoleName')}>
              <option value="hr">HR</option>
              <option value="manager">Manager</option>
            </NativeSelect>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
        <CardFooter className="flex flex-col gap-4">
          <Button type="submit" className="w-full" disabled={submitting || teams.length === 0}>
            {submitting ? 'Submitting…' : 'Request access'}
          </Button>
          <p className="text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link to={`/login/${encodeURIComponent(orgSlug)}`} className="underline underline-offset-4">
              Sign in
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
