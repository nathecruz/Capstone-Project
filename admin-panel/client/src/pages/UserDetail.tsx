import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Bell, Pencil, Trophy } from 'lucide-react';
import { ChartCard, ColumnChart, StatTile } from '../components/charts';
import { ComposeModal } from '../components/Compose';
import { UserActionMenu, useUserActions } from '../components/UserActions';
import { Alert, Avatar, Badge, Button, Card, cx, EmptyState, Spinner, Table, Td, Th } from '../components/ui';
import { useAuth } from '../lib/auth';
import { formatDate, formatDateTime, formatNumber, formatRelative, formatShortDay } from '../lib/format';
import type { UserRow } from '../lib/types';
import { useApi } from '../lib/useApi';
import { RoleBadge, StatusBadge } from './Users';

interface UserDetail {
  user: UserRow & { about: string };
  stats: {
    habitCount: number;
    completionCount: number;
    completions30d: number;
    bestStreak: number;
    goalCount: number;
    goalAvgProgress: number;
    tokenBalance: number;
    appSessions: number;
    pushDevices: number;
    issueReports: number;
    unreadNotifications: number;
    lastActiveAt: number | null;
  };
  habits: { id: string; label: string; category: string; frequency: string; streak: number; reminderEnabled: boolean; reminderTime: string; completions: number; lastCompleted: string | null }[];
  loginHistory: { device: string; loginAt: string }[];
  dailyCompletions: { day: string; completions: number }[];
  achievements: { name: string; description: string; earnedAt: number }[];
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line py-2 text-[13px] last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right text-ink">{children === '' || children === null || children === undefined ? '—' : children}</dd>
    </div>
  );
}

export function UserDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { admin, can } = useAuth();
  const { data, error, loading, reload } = useApi<UserDetail>(`/users/${id}`);
  const { open, modals } = useUserActions((action) => (action === 'delete' ? navigate('/users') : reload()), admin!.id);
  const [composing, setComposing] = useState(false);
  const manage = can('users:manage');

  if (error && !data) {
    return (
      <>
        <Link to="/users" className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-2 hover:text-ink"><ArrowLeft className="size-4" /> Users</Link>
        <Alert tone="critical" title="Could not load this account">{error}</Alert>
      </>
    );
  }
  if (!data) return <Spinner />;
  const { user, stats } = data;

  return (
    <div className={cx('transition-opacity', loading && 'opacity-60')}>
      <Link to="/users" className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-2 hover:text-ink"><ArrowLeft className="size-4" /> Users</Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <Avatar name={user.fullName} size={56} />
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight text-ink">{user.fullName}</h1>
            <p className="text-sm text-ink-2">{user.email}{user.username && <span className="text-muted"> · @{user.username}</span>}</p>
            <div className="mt-2 flex flex-wrap gap-2"><RoleBadge user={user} /><StatusBadge status={user.status} /></div>
          </div>
        </div>
        {manage && (
          <div className="flex items-center gap-2">
            {can('notifications:manage') && user.status === 'active' && <Button icon={<Bell className="size-4" />} onClick={() => setComposing(true)}>Send notification</Button>}
            <Button icon={<Pencil className="size-4" />} onClick={() => open('edit', user)}>Edit</Button>
            <UserActionMenu user={user} currentAdminId={admin!.id} onAction={(action, row) => open(action, row)} />
          </div>
        )}
      </div>

      {user.status === 'deactivated' && (
        <div className="mb-5">
          <Alert tone="warning" title={`Deactivated ${user.statusChangedAt ? formatDate(user.statusChangedAt) : ''}`}>
            <p>{user.statusReason ? `Reason: ${user.statusReason}` : 'No reason was recorded.'}</p>
            <p>The account cannot sign in to the app until it is reactivated.</p>
          </Alert>
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Habits" value={formatNumber(stats.habitCount)} hint={`Best streak ${stats.bestStreak} day${stats.bestStreak === 1 ? '' : 's'}`} />
        <StatTile label="Check-ins (30 days)" value={formatNumber(stats.completions30d)} hint={`${stats.completionCount} all time`} />
        <StatTile label="Token balance" value={formatNumber(stats.tokenBalance)} />
        <StatTile label="Goals" value={formatNumber(stats.goalCount)} hint={stats.goalCount ? `${stats.goalAvgProgress}% average progress` : undefined} />
        <StatTile label="Signed-in devices" value={formatNumber(stats.appSessions)} hint={`${stats.pushDevices} with push reminders`} />
        <StatTile label="Last active" value={<span className="text-lg">{formatRelative(stats.lastActiveAt)}</span>} hint={`${stats.unreadNotifications} unread notifications`} />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="flex flex-col gap-5 xl:col-span-2">
          <Card title="Habits" subtitle="As last synced from the app" bodyClassName="!px-0 !pb-0">
            {data.habits.length ? (
              <Table>
                <thead>
                  <tr><Th>Habit</Th><Th>Category</Th><Th>Frequency</Th><Th align="right">Streak</Th><Th>Reminder</Th><Th align="right">Check-ins</Th><Th>Last check-in</Th></tr>
                </thead>
                <tbody>
                  {data.habits.map((habit) => (
                    <tr key={habit.id}>
                      <Td className="font-medium">{habit.label}</Td>
                      <Td>{habit.category || '—'}</Td>
                      <Td>{habit.frequency}</Td>
                      <Td align="right">{habit.streak}</Td>
                      <Td className="whitespace-nowrap">{habit.reminderEnabled ? habit.reminderTime || 'On' : <span className="text-muted">Off</span>}</Td>
                      <Td align="right">{habit.completions}</Td>
                      <Td className="whitespace-nowrap">{habit.lastCompleted ? formatDate(habit.lastCompleted) : <span className="text-muted">Never</span>}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : <EmptyState title="No habits yet">This account has not created any habits in the app.</EmptyState>}
          </Card>

          <ChartCard
            title="Check-ins, last 30 days"
            rows={data.dailyCompletions}
            columns={[
              { key: 'day', label: 'Date', render: (row) => formatDate(row.day) },
              { key: 'completions', label: 'Check-ins', align: 'right', render: (row) => row.completions },
            ]}
          >
            <ColumnChart data={data.dailyCompletions} xKey="day" yKey="completions" seriesLabel="check-ins" formatX={formatShortDay} labels={false} height={200} />
          </ChartCard>
        </div>

        <div className="flex flex-col gap-5">
          <Card title="Profile">
            <dl>
              <Detail label="Joined">{formatDate(user.createdAt)}</Detail>
              <Detail label="Date of birth">{user.dateOfBirth}</Detail>
              <Detail label="Gender">{user.gender}</Detail>
              <Detail label="Region">{user.region}</Detail>
              <Detail label="Issue reports">{stats.issueReports}</Detail>
            </dl>
            {user.about && <p className="mt-3 rounded-lg bg-surface-2 p-3 text-[13px] text-ink-2">{user.about}</p>}
          </Card>

          <Card title="Recent sign-ins">
            {data.loginHistory.length ? (
              <ul className="-my-1 divide-y divide-[var(--border)]">
                {data.loginHistory.map((entry, index) => (
                  <li key={index} className="py-2 text-[13px]">
                    <p className="truncate text-ink" title={entry.device}>{entry.device}</p>
                    <p className="text-xs text-muted">{formatDateTime(entry.loginAt)}</p>
                  </li>
                ))}
              </ul>
            ) : <EmptyState title="No sign-ins recorded" />}
          </Card>

          <Card title="Achievements">
            {data.achievements.length ? (
              <ul className="flex flex-col gap-2.5">
                {data.achievements.map((achievement) => (
                  <li key={achievement.name} className="flex items-start gap-2.5 text-[13px]">
                    <Trophy className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
                    <div>
                      <p className="font-medium text-ink">{achievement.name}</p>
                      <p className="text-xs text-muted">{achievement.description}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : <EmptyState title="No achievements yet" />}
          </Card>
          {stats.issueReports > 0 && can('support:view') && <Badge tone="warning">This student has submitted {stats.issueReports} issue report(s) — see Support.</Badge>}
        </div>
      </div>

      {modals}
      <ComposeModal
        open={composing}
        onClose={() => setComposing(false)}
        fixedAudience={{ audience: { kind: 'users', userIds: [user.id] }, label: `${user.fullName} (${user.email})` }}
      />
    </div>
  );
}
