import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Bell, ChartColumn, ExternalLink, HeartPulse, LayoutDashboard, LifeBuoy, LogOut, Menu, Monitor, Moon, ScrollText, Settings, Smartphone, Sun, Tags, Users, X, type LucideIcon } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { APP_URL } from '../lib/links';
import { useTheme } from '../lib/theme';
import { useApi } from '../lib/useApi';
import { usePendingAccessRequests } from './AccessRequests';
import type { Permission } from '../lib/types';
import { Avatar, cx, IconButton } from './ui';

type NavGroup = 'Monitor' | 'Manage' | 'System';
const GROUPS: NavGroup[] = ['Monitor', 'Manage', 'System'];

export const NAV: { to: string; label: string; icon: LucideIcon; group: NavGroup; permission?: Permission }[] = [
  { to: '/class-pulse', label: 'Class Pulse', icon: HeartPulse, group: 'Monitor', permission: 'class:view' },
  { to: '/', label: 'Overview', icon: LayoutDashboard, group: 'Monitor', permission: 'dashboard:view' },
  { to: '/analytics', label: 'Analytics', icon: ChartColumn, group: 'Monitor', permission: 'analytics:view' },
  { to: '/users', label: 'Users', icon: Users, group: 'Manage', permission: 'users:view' },
  { to: '/categories', label: 'Habit categories', icon: Tags, group: 'Manage', permission: 'categories:view' },
  { to: '/notifications', label: 'Notifications', icon: Bell, group: 'Manage', permission: 'notifications:view' },
  { to: '/support', label: 'Support', icon: LifeBuoy, group: 'Manage', permission: 'support:view' },
  { to: '/audit', label: 'Audit log', icon: ScrollText, group: 'System', permission: 'audit:view' },
  { to: '/settings', label: 'Settings', icon: Settings, group: 'System' },
];

/** New issue reports (status "open"), for the Support badge. Refetches on navigation. */
function useNewIssueReports(enabled: boolean, pathname: string) {
  const { data, reload } = useApi<{ counts: Record<string, number> }>(enabled ? '/support/issues?status=open' : null);
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (enabled) reload();
  }, [enabled, pathname, reload]);
  return enabled ? data?.counts.open ?? 0 : 0;
}

function CountBadge({ count, label }: { count: number; label: string }) {
  if (count <= 0) return null;
  return (
    <span className="tabular ml-auto rounded-full bg-accent px-1.5 text-[11px] font-semibold leading-[18px] text-on-accent" aria-label={label}>
      {count}
    </span>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-on-accent">
        <svg viewBox="0 0 32 32" className="size-5" aria-hidden><path d="M9 16.5l4.5 4.5L23 11.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
      <div className="leading-tight">
        <p className="text-sm font-semibold text-ink">HabitAI</p>
        <p className="text-xs text-muted">Admin Panel</p>
      </div>
    </div>
  );
}

const todayLabel = () => new Date().toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric' });

export function Layout() {
  const { admin, can, logout } = useAuth();
  const { choice, cycle } = useTheme();
  const [open, setOpen] = useState(false);
  const location = useLocation();

  useEffect(() => setOpen(false), [location.pathname]);
  const pendingRequests = usePendingAccessRequests(can('users:manage'), location.pathname);
  const newReports = useNewIssueReports(can('support:view'), location.pathname);

  if (!admin) return null;
  const items = NAV.filter((item) => !item.permission || can(item.permission));
  const current = items.find((item) => (item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to)));
  const ThemeIcon = choice === 'light' ? Sun : choice === 'dark' ? Moon : Monitor;
  const badges: Record<string, { count: number; label: string }> = {
    '/users': { count: pendingRequests, label: `${pendingRequests} access request${pendingRequests === 1 ? '' : 's'} waiting` },
    '/support': { count: newReports, label: `${newReports} new issue report${newReports === 1 ? '' : 's'}` },
  };

  const sidebar = (
    <nav aria-label="Main" className="flex h-full flex-col gap-6 px-3 py-5">
      <Brand />
      <div className="flex flex-col gap-5">
        {GROUPS.map((group) => {
          const groupItems = items.filter((item) => item.group === group);
          if (!groupItems.length) return null;
          return (
            <div key={group}>
              <p className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">{group}</p>
              <ul className="flex flex-col gap-0.5">
                {groupItems.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.to === '/'}
                      className={({ isActive }) => cx(
                        'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
                        isActive ? 'bg-accent-soft text-accent-ink' : 'text-ink-2 hover:bg-surface-hover hover:text-ink',
                      )}
                    >
                      <item.icon className="size-4 shrink-0" aria-hidden />
                      {item.label}
                      {badges[item.to] && <CountBadge {...badges[item.to]} />}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <div className="mt-auto rounded-xl border border-line bg-surface-2 p-3">
        <div className="flex items-center gap-2.5">
          <Avatar name={admin.fullName} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink">{admin.fullName}</p>
            <p className="truncate text-xs text-muted">{admin.roleLabel}</p>
          </div>
        </div>
        <button type="button" onClick={() => void logout()} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-line-strong bg-surface py-1.5 text-[13px] font-medium text-ink-2 hover:text-ink">
          <LogOut className="size-3.5" aria-hidden /> Sign out
        </button>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen bg-page">
      <aside className="print-hidden fixed inset-y-0 left-0 z-30 hidden w-60 overflow-y-auto border-r border-line bg-surface lg:block">{sidebar}</aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="animate-fade-in absolute inset-y-0 left-0 w-64 overflow-y-auto border-r border-line bg-surface">
            <IconButton label="Close menu" className="absolute right-2 top-4" onClick={() => setOpen(false)}><X className="size-4" /></IconButton>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="lg:pl-60">
        <header className="print-hidden sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-line bg-page/90 px-4 backdrop-blur sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-2">
            <IconButton label="Open menu" className="lg:hidden" onClick={() => setOpen(true)}><Menu className="size-5" /></IconButton>
            <span className="truncate text-sm font-semibold text-ink lg:hidden">{current?.label ?? 'HabitAI Admin'}</span>
            <span className="hidden text-sm text-muted lg:inline">{todayLabel()}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <a
              href={APP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-2.5 text-[13px] font-medium text-ink-2 hover:text-ink"
              aria-label="Open the HabitAI app in a new tab"
            >
              <Smartphone className="size-4" aria-hidden />
              <span className="hidden sm:inline">HabitAI app</span>
              <ExternalLink className="size-3.5 text-muted" aria-hidden />
            </a>
            <IconButton label={`Theme: ${choice} (click to change)`} onClick={cycle}><ThemeIcon className="size-4" /></IconButton>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
