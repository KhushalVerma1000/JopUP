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
// `sideLabel` is the roomier name used in the desktop sidebar.
const NAV_ITEMS = [
  // Platform staff
  { to: '/platform', label: 'Overview', icon: Gauge, end: true, visibleTo: (a) => a.isPlatform },
  { to: '/platform/organizations', label: 'Orgs', sideLabel: 'Organisations', icon: Building2, visibleTo: (a) => a.isPlatform },
  { to: '/platform/team', label: 'Team', sideLabel: 'Platform team', icon: ShieldCheck, visibleTo: (a) => a.isPlatformOwner },
  // Org admin
  { to: '/dashboard', label: 'Home', sideLabel: 'Dashboard', icon: LayoutDashboard, visibleTo: (a) => !a.isPlatform && a.isOrgAdmin },
  // Manager
  { to: '/manager', label: 'Team', icon: ClipboardList, visibleTo: (a) => !a.isPlatform && (a.isManager || a.isOrgAdmin) },
  // HR / pipeline
  { to: '/hr', label: 'Pipeline', sideLabel: 'HR workbench', icon: Briefcase, visibleTo: (a) => !a.isPlatform && (a.isHr || a.isManager || a.isOrgAdmin) },
  { to: '/clients', label: 'Clients', icon: Building2, visibleTo: (a) => !a.isPlatform },
  { to: '/employees', label: 'People', sideLabel: 'Employees', icon: Users, visibleTo: (a) => !a.isPlatform && (a.isManager || a.isOrgAdmin) },
  { to: '/managerial', label: 'Settings', icon: Settings, visibleTo: (a) => !a.isPlatform && a.isOrgAdmin },
];

export function AppLayout({ children, wide = false }) {
  const auth = useAuth();
  const { user, logout } = auth;
  const items = NAV_ITEMS.filter((i) => i.visibleTo(auth));
  const name = `${user.firstName} ${user.lastName}`;

  return (
    <div className="min-h-svh bg-muted/40">
      {/* Desktop sidebar — fixed to the left edge on md+. Phones use the tab bar below. */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r bg-background md:flex">
        <div className="flex h-14 shrink-0 items-center border-b px-5">
          <Link to={auth.homePath} className="text-lg font-bold tracking-tight text-primary">JopUP</Link>
        </div>

        <nav className="flex-1 overflow-y-auto p-3" aria-label="Primary">
          <ul className="flex flex-col gap-1">
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      cn(
                        'flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors',
                        isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground'
                      )
                    }
                  >
                    <Icon className="size-4 shrink-0" aria-hidden />
                    <span className="truncate">{item.sideLabel || item.label}</span>
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="shrink-0 border-t p-3">
          <div className="flex items-center gap-3 px-2 py-1">
            <Avatar name={name} className="size-9" />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-sm font-medium">{name}</div>
              <div className="truncate text-xs text-muted-foreground">{primaryRoleLabel(auth)}</div>
            </div>
            <button
              type="button"
              onClick={logout}
              aria-label="Sign out"
              className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </aside>

      <div className="md:pl-60">
        {/* Phone header — brand + sign out. Hidden on md+ where the sidebar takes over. */}
        <header className="pt-safe sticky top-0 z-30 border-b bg-background/95 backdrop-blur md:hidden">
          <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4">
            <Link to={auth.homePath} className="text-lg font-bold tracking-tight text-primary">JopUP</Link>
            <div className="flex items-center gap-3">
              <Avatar name={name} className="size-9" />
              <button
                type="button"
                onClick={logout}
                aria-label="Sign out"
                className="flex size-10 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
              >
                <LogOut className="size-5" />
              </button>
            </div>
          </div>
        </header>

        <main className={cn('mx-auto px-4 pb-28 pt-5 md:px-8 md:pb-10 md:pt-8', wide ? 'max-w-7xl' : 'max-w-5xl')}>{children}</main>
      </div>

      {/* Phone tab bar — thumb reach, safe-area aware. Hidden on md+ where the sidebar shows. */}
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
