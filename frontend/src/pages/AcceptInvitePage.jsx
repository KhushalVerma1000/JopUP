import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { AuthShell } from '../components/AuthShell';
import { ApiError } from '../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';

/**
 * Landing page for the link in the invitation email:
 *   {APP_URL}/accept-invite?token=...
 *
 * The invitation already fixes the organisation, role and team, so the
 * invitee only sets their name and a password — no workspace ID, no slug.
 * On success the backend returns a session (same as login) and we send
 * them to '/', which routes each role to its own home.
 */
export function AcceptInvitePage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const navigate = useNavigate();
  const { acceptInvite, isAuthenticated, user } = useAuth();

  const [form, setForm] = useState({ firstName: '', lastName: '', phone: '', password: '', confirm: '' });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (form.password !== form.confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      const body = {
        token,
        password: form.password,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
      };
      if (form.phone.trim()) body.phone = form.phone.trim();
      await acceptInvite(body);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  // Link opened without a token (truncated by an email client, or typed by hand).
  if (!token) {
    return (
      <AuthShell>
        <Card className="w-full">
          <CardHeader>
            <CardTitle className="text-xl">Invitation link incomplete</CardTitle>
            <CardDescription>
              This link is missing its invitation token. Open the button in your invitation email again,
              or ask your admin to send a new invitation.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Link to="/login" className="text-sm underline underline-offset-4">
              Already have an account? Sign in
            </Link>
          </CardFooter>
        </Card>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <Card className="w-full">
        <form onSubmit={handleSubmit}>
          <CardHeader>
            <CardTitle className="text-xl">Accept your invitation</CardTitle>
            <CardDescription>
              Set up your account to join your team on JopUP. Use the same email address the invitation was sent to
              when you sign in later.
            </CardDescription>
            {isAuthenticated && (
              <p className="text-sm text-muted-foreground">
                You're currently signed in as <span className="font-medium text-foreground">{user?.email}</span>.
                Accepting this invitation will switch you to the new account.
              </p>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="firstName">First name</Label>
                <Input id="firstName" value={form.firstName} onChange={update('firstName')} autoComplete="given-name" required autoFocus />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="lastName">Last name</Label>
                <Input id="lastName" value={form.lastName} onChange={update('lastName')} autoComplete="family-name" required />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="phone">Phone (optional)</Label>
              <Input id="phone" type="tel" inputMode="tel" value={form.phone} onChange={update('phone')} autoComplete="tel" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={form.password} onChange={update('password')} autoComplete="new-password" minLength={8} required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="confirm">Confirm password</Label>
              <Input id="confirm" type="password" value={form.confirm} onChange={update('confirm')} autoComplete="new-password" minLength={8} required />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? 'Creating your account…' : 'Create account & continue'}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Already set up?{' '}
              <Link to="/login" className="font-medium text-foreground underline underline-offset-4">
                Sign in
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </AuthShell>
  );
}
