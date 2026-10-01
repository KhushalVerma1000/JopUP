import { NavLink, Link } from 'react-router-dom';
import {
  LayoutDashboard, Users, Building2, Settings, Briefcase, Gauge, ShieldCheck, LogOut, ClipboardList,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { primaryRoleLabel } from '../lib/roles';
import { Avatar } from '@/components/common';
import { cn } from '@/lib/utils';

// Each role gets its own short nav (max 5 so it fits a phone tab bar).
// visibleTo is the single source of truth for who sees what.
const NAV_ITEMS = [
  // Platform staff
  { to: '/platform', label: 'Overview', icon: Gauge, end: true, visibleTo: (a) => a.isPlatform },
  { to: '/platform/organizations', label: 'Orgs', icon: Building2, visibleTo: (a) => a.isPlatform },
  { to: '/platform/team', label: 'Team', icon: ShieldCheck, visibleTo: (a) => a.isPlatformOwner },
  // Org admin
  { to: '/dashboard', label: 'Home', icon: LayoutDashboard, visibleTo: (a) => !a.isPlatform && a.isOrgAdmin },
  // Manager
  { to: '/manager', label: 'Team', icon: ClipboardList, visibleTo: (a) => !a.isPlatform && (a.isManager || a.isOrgAdmin) },
  // HR / pipeline
  { to: '/hr', label: 'Pipeline', icon: Briefcase, visibleTo: (a) => !a.isPlatform && (a.isHr || a.isManager || a.isOrgAdmin) },
  { to: '/clients', label: 'Clients', icon: Building2, visibleTo: (a) => !a.isPlatform },
  { to: '/employees', label: 'People', icon: Users, visibleTo: (a) => !a.isPlatform && (a.isManager || a.isOrgAdmin) },
  { to: '/managerial', label: 'Settings', icon: Settings, visibleTo: (a) => !a.isPlatform && a.isOrgAdmin },
];

export function AppLayout({ children, wide = false }) {
  const auth = useAuth();
  const { user, logout } = auth;
  const items = NAV_ITEMS.filter((i) => i.visibleTo(auth));
  const name = `${user.firstName} ${user.lastName}`;

  return (
    <div className="min-h-svh bg-muted/40">
      <header className="pt-safe sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className={cn('mx-auto flex h-14 items-center justify-between gap-3 px-4', wide ? 'max-w-7xl' : 'max-w-5xl')}>
          <div className="flex items-center gap-6">
            <Link to={auth.homePath} className="text-lg font-bold tracking-tight text-primary">JopUP</Link>
            <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
              {items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                      isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                    )
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right leading-tight sm:block">
              <div className="text-sm font-medium">{name}</div>
              <div className="text-xs text-muted-foreground">{primaryRoleLabel(auth)}</div>
            </div>
            <Avatar name={name} className="size-9" />
            <button
              type="button"
              onClick={logout}
              aria-label="Sign out"
              className="flex size-10 items-center justify-center rounded-md text-muted-foreground hover:bg-accent md:size-9"
            >
              <LogOut className="size-5" />
            </button>
          </div>
        </div>
      </header>

      <main className={cn('mx-auto px-4 pb-28 pt-5 md:pb-10 md:pt-8', wide ? 'max-w-7xl' : 'max-w-5xl')}>{children}</main>

      {/* Phone tab bar — thumb reach, safe-area aware. Hidden on md+ where the header nav shows. */}
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 backdrop-blur md:hidden" aria-label="Primary">
        <ul className="mx-auto flex max-w-lg">
          {items.slice(0, 5).map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.to} className="flex-1">
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      'flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors',
                      isActive ? 'text-primary' : 'text-muted-foreground'
                    )
                  }
                >
                  <Icon className="size-5" aria-hidden />
                  {item.label}
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
