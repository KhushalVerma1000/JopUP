import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { AppLayout } from '../components/AppLayout';
import { Card, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const WORKBENCHES = [
  {
    key: 'employees',
    title: 'Employees',
    description: 'Staff directory, pending approvals, teams.',
    to: '/employees',
    ready: true,
    visibleTo: () => true,
  },
  {
    key: 'hr',
    title: 'HR',
    description: 'Candidates, job postings, and the pipeline tracker.',
    to: '/hr',
    ready: true,
    visibleTo: () => true,
  },
  {
    key: 'clients',
    title: 'Clients',
    description: 'Client accounts and team sharing.',
    to: '/clients',
    ready: true,
    visibleTo: () => true,
  },
  {
    key: 'managerial',
    title: 'Managerial',
    description: 'Org settings, invitations, and teams.',
    to: '/managerial',
    ready: true,
    visibleTo: (ctx) => ctx.isOrgAdmin || ctx.isManager,
  },
];

export function DashboardPage() {
  const auth = useAuth();
  const { user, roles } = auth;

  return (
    <AppLayout>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">
          Welcome, {user.firstName} {user.lastName}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground capitalize">
          {roles.length === 0 ? 'No active role assignments' : roles.map((r) => r.roleName).join(', ')}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {WORKBENCHES.filter((w) => w.visibleTo(auth)).map((w) => (
          <Card key={w.key}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{w.title}</CardTitle>
                {!w.ready && <Badge variant="secondary">Not built yet</Badge>}
              </div>
              <CardDescription>{w.description}</CardDescription>
            </CardHeader>
            <CardFooter>
              <Button asChild variant={w.ready ? 'default' : 'outline'} disabled={!w.ready} className="w-full">
                {w.ready ? <Link to={w.to}>Open</Link> : <span>Open</span>}
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </AppLayout>
  );
}
