import { useState } from 'react';
import { useNavigate, useLocation, useParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useOrgLookup } from '../hooks/useOrgLookup';
import { ApiError } from '../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';

/**
 * Sign in with email + password. No workspace ID needed:
 *  - /login              -> email + password; if the same credentials exist
 *                           in several workspaces, ask which one afterwards.
 *  - /login/:orgSlug     -> same form, pre-scoped to that workspace (links
 *                           from an admin/invite still work and show its name).
 */
export function LoginPage() {
  const { orgSlug } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted p-6">
      <LoginForm orgSlug={orgSlug} navigate={navigate} location={location} login={login} />
    </div>
  );
}

function LoginForm({ orgSlug, navigate, location, login }) {
  // With no slug this resolves immediately to { organization: null, loading: false }.
  const { organization, loading, error: lookupError } = useOrgLookup(orgSlug);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  // Set when the backend says this email + password exists in 2+ workspaces.
  const [choices, setChoices] = useState(null);

  async function attempt(slug) {
    setError(null);
    setSubmitting(true);
    try {
      const result = await login(slug, email.trim(), password);
      if (result.orgSelectionRequired) {
        setChoices(result.organisations);
        return;
      }
      const redirectTo = location.state?.from?.pathname || '/dashboard';
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setChoices(null);
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    attempt(orgSlug);
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

  // A stale/wrong /login/:slug link — fall back to the plain form instead of a dead end.
  if (orgSlug && lookupError) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Sign in</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-destructive">{lookupError}</p>
          <Link to="/login" className="text-sm underline underline-offset-4">
            Sign in with just your email instead
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (choices) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Choose a workspace</CardTitle>
          <CardDescription>
            Your account exists in more than one workspace. Which one do you want to open?
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {choices.map((org) => (
            <Button
              key={org.slug}
              type="button"
              variant="outline"
              className="w-full justify-start"
              disabled={submitting}
              onClick={() => attempt(org.slug)}
            >
              {org.name}
            </Button>
          ))}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
        <CardFooter>
          <button
            type="button"
            className="text-sm underline underline-offset-4"
            onClick={() => {
              setChoices(null);
              setPassword('');
            }}
          >
            Back
          </button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <form onSubmit={handleSubmit}>
        <CardHeader>
          <CardTitle className="text-xl">Sign in</CardTitle>
          {organization && (
            <CardDescription>
              Workspace: <span className="font-medium text-foreground">{organization.name}</span>{' '}
              · <Link to="/login" className="underline underline-offset-4">not you?</Link>
            </CardDescription>
          )}
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
            <Link
              to={orgSlug ? `/register/${encodeURIComponent(orgSlug)}` : '/register'}
              className="underline underline-offset-4"
            >
              Request access
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
