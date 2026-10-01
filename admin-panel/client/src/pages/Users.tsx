import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, UserPlus, Users as UsersIcon } from 'lucide-react';
import { AccessRequestsCard } from '../components/AccessRequests';
import { UserActionMenu, UserFormModal, useUserActions } from '../components/UserActions';
import { Alert, Avatar, Badge, Button, Card, cx, EmptyState, Input, PageHeader, Pagination, Select, Spinner, Table, Td, Th } from '../components/ui';
import { useAuth } from '../lib/auth';
import { formatDate, formatNumber, formatRelative } from '../lib/format';
import type { UserRow } from '../lib/types';
import { useApi } from '../lib/useApi';

interface UsersResponse {
  items: UserRow[];
  total: number;
  page: number;
  pageSize: number;
  summary: { total: number; active: number; deactivated: number; students: number; faculty: number; admins: number };
}

export function RoleBadge({ user }: { user: Pick<UserRow, 'role' | 'roleLabel'> }) {
  return <Badge tone={user.role === 'admin' ? 'accent' : user.role === 'faculty' ? 'warning' : 'neutral'}>{user.roleLabel}</Badge>;
}

export function StatusBadge({ status }: { status: UserRow['status'] }) {
  return status === 'active' ? <Badge tone="good">Active</Badge> : <Badge tone="critical">Deactivated</Badge>;
}

export function UsersPage() {
  const { admin, can } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [role, setRole] = useState('all');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => { setDebounced(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const params = new URLSearchParams({ search: debounced, role, status, sort, page: String(page), pageSize: '20' });
  const { data, error, loading, reload } = useApi<UsersResponse>(`/users?${params}`);
  const { open, modals } = useUserActions(() => reload(), admin!.id);
  const manage = can('users:manage');
  const summary = data?.summary;

  const filterChips = summary ? [
    { label: 'All accounts', value: summary.total, active: role === 'all' && status === 'all', onClick: () => { setRole('all'); setStatus('all'); setPage(1); } },
    { label: 'Students', value: summary.students, active: role === 'user', onClick: () => { setRole('user'); setStatus('all'); setPage(1); } },
    { label: 'Faculty', value: summary.faculty, active: role === 'faculty', onClick: () => { setRole('faculty'); setStatus('all'); setPage(1); } },
    { label: 'Administrators', value: summary.admins, active: role === 'admin', onClick: () => { setRole('admin'); setStatus('all'); setPage(1); } },
    { label: 'Deactivated', value: summary.deactivated, active: status === 'deactivated' && role === 'all', onClick: () => { setRole('all'); setStatus('deactivated'); setPage(1); } },
  ] : [];

  return (
    <>
      <PageHeader
        title="Users"
        description="Create accounts, assign roles, and deactivate or reactivate access to HabitAI."
        actions={manage && <Button variant="primary" icon={<UserPlus className="size-4" />} onClick={() => setCreating(true)}>Add account</Button>}
      />

      {manage && <AccessRequestsCard onApproved={() => reload()} />}

      <div className="mb-4 flex flex-wrap gap-2">
        {filterChips.map((chip) => (
          <button
            key={chip.label}
            type="button"
            onClick={chip.onClick}
            aria-pressed={chip.active}
            className={cx('inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[13px] font-medium', chip.active ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line bg-surface text-ink-2 hover:text-ink')}
          >
            {chip.label}
            <span className="tabular text-muted">{chip.value}</span>
          </button>
        ))}
      </div>

      <Card bodyClassName="!p-0">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input aria-label="Search users" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name, email or username" className="pl-9" />
          </div>
          <Select aria-label="Role" value={role} onChange={(event) => { setRole(event.target.value); setPage(1); }} className="w-auto">
            <option value="all">All roles</option>
            <option value="user">Students</option>
            <option value="faculty">Faculty</option>
            <option value="admin">Administrators</option>
          </Select>
          <Select aria-label="Status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className="w-auto">
            <option value="all">Any status</option>
            <option value="active">Active</option>
            <option value="deactivated">Deactivated</option>
          </Select>
          <Select aria-label="Sort" value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }} className="w-auto">
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="name">Name A–Z</option>
            <option value="last_active">Recently active</option>
          </Select>
        </div>

        {error && <div className="p-5"><Alert tone="critical">{error}</Alert></div>}
        {!data ? (loading && <Spinner />) : data.items.length === 0 ? (
          <EmptyState icon={<UsersIcon className="size-8" />} title="No accounts match these filters">Try a different search or clear the filters.</EmptyState>
        ) : (
          <div className={cx('transition-opacity', loading && 'opacity-60')}>
            <Table>
              <thead>
                <tr>
                  <Th>Account</Th>
                  <Th>Role</Th>
                  <Th>Status</Th>
                  <Th align="right">Habits</Th>
                  <Th align="right">Check-ins</Th>
                  <Th>Last active</Th>
                  <Th>Joined</Th>
                  <Th><span className="sr-only">Actions</span></Th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((user) => (
                  <tr key={user.id} className="cursor-pointer hover:bg-surface-hover" onClick={() => navigate(`/users/${user.id}`)}>
                    <Td>
                      <div className="flex min-w-52 items-center gap-3">
                        <Avatar name={user.fullName} />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-ink">{user.fullName}{user.id === admin!.id && <span className="ml-1.5 text-xs font-normal text-muted">(you)</span>}</p>
                          <p className="truncate text-xs text-muted">{user.email}</p>
                        </div>
                      </div>
                    </Td>
                    <Td><RoleBadge user={user} /></Td>
                    <Td><StatusBadge status={user.status} /></Td>
                    <Td align="right">{formatNumber(user.habitCount)}</Td>
                    <Td align="right">{formatNumber(user.completionCount)}</Td>
                    <Td className="whitespace-nowrap text-ink-2">{formatRelative(user.lastActiveAt)}</Td>
                    <Td className="whitespace-nowrap text-ink-2">{formatDate(user.createdAt)}</Td>
                    <Td align="right">
                      {manage && <UserActionMenu user={user} currentAdminId={admin!.id} onAction={open} onView={() => navigate(`/users/${user.id}`)} />}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </div>
        )}
      </Card>

      <UserFormModal open={creating} onClose={() => setCreating(false)} onSaved={() => reload()} />
      {modals}
    </>
  );
}
