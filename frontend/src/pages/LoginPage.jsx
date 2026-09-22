import { useState } from 'react';
import { useNavigate, useLocation, useParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useOrgLookup } from '../hooks/useOrgLookup';
import { WorkspaceStep } from '../components/WorkspaceStep';
import { ApiError } from '../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';

export function LoginPage() {
  const { orgSlug } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();

  // No slug in the URL at all (e.g. someone visited /login directly) — ask
  // once, then move the slug into the URL so it's shareable/bookmarkable
  // from here on, instead of a form field to remember and retype.
  if (!orgSlug) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-muted p-6">
        <WorkspaceStep
          title="Sign in"
          onSubmit={(slug) => navigate(`/login/${encodeURIComponent(slug)}`, { replace: true })}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted p-6">
      <LoginForm orgSlug={orgSlug} navigate={navigate} location={location} login={login} />
    </div>
  );
}

function LoginForm({ orgSlug, navigate, location, login }) {
  const { organization, loading, error: lookupError } = useOrgLookup(orgSlug);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // The backend still needs the slug to disambiguate — email is only
      // unique per-org, not globally — this just passes through the one
      // already resolved from the URL, rather than the user typing it.
      await login(orgSlug, email.trim(), password);
      const redirectTo = location.state?.from?.pathname || '/dashboard';
      navigate(redirectTo, { replace: true });
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
          <CardTitle className="text-xl">Sign in</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-destructive">{lookupError}</p>
          <Link to="/login" className="text-sm underline underline-offset-4">
            Try a different workspace
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <form onSubmit={handleSubmit}>
        <CardHeader>
          <CardTitle className="text-xl">Sign in</CardTitle>
          <CardDescription>
            Workspace: <span className="font-medium text-foreground">{organization.name}</span>{' '}
            · <Link to="/login" className="underline underline-offset-4">not you?</Link>
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              autoFocus
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
        <CardFooter className="flex flex-col gap-4">
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
          <p className="text-sm text-muted-foreground">
            New here?{' '}
            <Link to={`/register/${encodeURIComponent(orgSlug)}`} className="underline underline-offset-4">
              Request access
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
