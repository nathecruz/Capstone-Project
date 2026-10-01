import { useEffect, useState } from 'react';
import { Download, ScrollText, Search } from 'lucide-react';
import { Alert, Badge, Button, Card, cx, EmptyState, Input, PageHeader, Pagination, Select, Spinner, Table, Td, Th, useToast } from '../components/ui';
import { download } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { useApi } from '../lib/useApi';

interface Entry {
  id: string;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId: string | null;
  summary: string;
  details: Record<string, unknown>;
  ip: string;
  createdAt: number;
}

const CATEGORIES = [
  ['all', 'All actions'],
  ['auth', 'Sign-ins'],
  ['user', 'User accounts'],
  ['category', 'Habit categories'],
  ['template', 'Templates'],
  ['notification', 'Sent notifications'],
  ['achievement', 'Achievements'],
  ['support', 'Support'],
  ['analytics', 'Analytics exports'],
  ['settings', 'Settings'],
];

function actionTone(action: string) {
  if (/deleted|deactivated|failed|denied|rejected/.test(action)) return 'critical' as const;
  if (/created|reactivated|broadcast|approved/.test(action)) return 'good' as const;
  if (action.startsWith('auth.')) return 'neutral' as const;
  return 'accent' as const;
}

export function AuditLogPage() {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [category, setCategory] = useState('all');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => { setDebounced(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const params = new URLSearchParams({ search: debounced, category, page: String(page) });
  const { data, error, loading } = useApi<{ items: Entry[]; total: number; page: number; pageSize: number }>(`/audit?${params}`);

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every administrative action and Admin Panel sign-in, for accountability."
        actions={<Button icon={<Download className="size-4" />} onClick={() => download(`/audit/export.csv?${new URLSearchParams({ search: debounced, category })}`, 'habitai-audit-log.csv').catch(() => toast('Export failed.', 'critical'))}>Export CSV</Button>}
      />
      <Card bodyClassName="!p-0">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input aria-label="Search the audit log" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search summaries or actor email" className="pl-9" />
          </div>
          <Select aria-label="Action type" value={category} onChange={(event) => { setCategory(event.target.value); setPage(1); }} className="w-auto">
            {CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </div>
        {error && <div className="p-5"><Alert tone="critical">{error}</Alert></div>}
        {!data ? (loading && <Spinner />) : data.items.length === 0 ? (
          <EmptyState icon={<ScrollText className="size-8" />} title="No matching entries" />
        ) : (
          <div className={cx(loading && 'opacity-60')}>
            <Table>
              <thead><tr><Th>Time</Th><Th>Actor</Th><Th>Action</Th><Th>Details</Th><Th>IP address</Th></tr></thead>
              <tbody>
                {data.items.map((entry) => (
                  <tr key={entry.id}>
                    <Td className="whitespace-nowrap text-ink-2">{formatDateTime(entry.createdAt)}</Td>
                    <Td className="whitespace-nowrap">{entry.actorEmail || '—'}</Td>
                    <Td><Badge tone={actionTone(entry.action)}>{entry.action}</Badge></Td>
                    <Td className="min-w-64">{entry.summary}</Td>
                    <Td className="whitespace-nowrap font-mono text-xs text-muted">{entry.ip || '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </div>
        )}
      </Card>
    </>
  );
}
