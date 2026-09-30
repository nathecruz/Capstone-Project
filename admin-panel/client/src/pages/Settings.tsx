import { useEffect, useState, type FormEvent } from 'react';
import { Database, KeyRound, Server, ShieldCheck } from 'lucide-react';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Spinner, Table, Td, Th, useToast } from '../components/ui';
import { post, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatBytes, formatNumber } from '../lib/format';
import { useApi } from '../lib/useApi';

interface SettingsResponse { settings: { anonymityThreshold: number; inactiveDays: number }; timeZone: string; appName: string }
interface SystemResponse {
  database: { database: string; version: string; bytes: number; latencyMs: number; host: string };
  tables: { name: string; rows: number; bytes: number }[];
  sessions: { appSessions: number; adminSessions: number; pushSubscriptions: number };
  server: { node: string; uptimeSeconds: number; timeZone: string };
}

function ChangePassword() {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (next !== confirm) return setError('The new passwords do not match.');
    setBusy(true);
    setError(null);
    try {
      const result = await post<{ message: string }>('/auth/change-password', { currentPassword: current, newPassword: next });
      toast(result.message);
      setCurrent(''); setNext(''); setConfirm('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not change the password.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {error && <Alert tone="critical">{error}</Alert>}
      <Field label="Current password" htmlFor="pw-current"><Input id="pw-current" type="password" autoComplete="current-password" required value={current} onChange={(event) => setCurrent(event.target.value)} /></Field>
      <Field label="New password" htmlFor="pw-new" hint="At least 8 characters with uppercase, lowercase, a number and a symbol."><Input id="pw-new" type="password" autoComplete="new-password" required value={next} onChange={(event) => setNext(event.target.value)} /></Field>
      <Field label="Confirm new password" htmlFor="pw-confirm"><Input id="pw-confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(event) => setConfirm(event.target.value)} /></Field>
      <div><Button type="submit" variant="primary" loading={busy} icon={<KeyRound className="size-4" />}>Change password</Button></div>
      <p className="text-xs text-muted">This password is shared with your HabitAI app account. Changing it signs you out of the app and other Admin Panel sessions.</p>
    </form>
  );
}

function SystemSettings() {
  const toast = useToast();
  const { data, setData } = useApi<SettingsResponse>('/settings');
  const [threshold, setThreshold] = useState(3);
  const [inactive, setInactive] = useState(14);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (data) { setThreshold(data.settings.anonymityThreshold); setInactive(data.settings.inactiveDays); }
  }, [data]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await put<{ settings: SettingsResponse['settings'] }>('/settings', { anonymityThreshold: threshold, inactiveDays: inactive });
      if (data) setData({ ...data, settings: result.settings });
      toast('Settings saved.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save settings.');
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <Spinner />;
  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      {error && <Alert tone="critical">{error}</Alert>}
      <Field label="Minimum group size for analytics (k-anonymity)" htmlFor="set-k" hint="Demographic groups and cohorts with fewer students are combined or hidden. Allowed: 2–20.">
        <Input id="set-k" type="number" min={2} max={20} value={threshold} onChange={(event) => setThreshold(Number(event.target.value))} className="w-32" />
      </Field>
      <Field label="Inactive after (days)" htmlFor="set-inactive" hint="Used by the “Inactive students” and “Recently active” notification audiences. Allowed: 3–90.">
        <Input id="set-inactive" type="number" min={3} max={90} value={inactive} onChange={(event) => setInactive(Number(event.target.value))} className="w-32" />
      </Field>
      <p className="text-xs text-muted">Reporting time zone: <strong className="text-ink-2">{data.timeZone}</strong> (set with APP_TIME_ZONE on the server).</p>
      <div><Button type="submit" variant="primary" loading={busy}>Save settings</Button></div>
    </form>
  );
}

function SystemHealth() {
  const { data, error, reload, loading } = useApi<SystemResponse>('/settings/system');
  if (error) return <Alert tone="critical">{error}</Alert>;
  if (!data) return <Spinner />;
  const uptime = data.server.uptimeSeconds;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-lg bg-surface-2 p-3"><p className="text-xs text-muted">Database</p><p className="mt-0.5 flex items-center gap-1.5 text-sm font-semibold text-ink"><Badge tone="good">Connected</Badge> {data.database.latencyMs} ms</p></div>
        <div className="rounded-lg bg-surface-2 p-3"><p className="text-xs text-muted">PostgreSQL</p><p className="mt-0.5 text-sm font-semibold text-ink">{data.database.version} · {formatBytes(data.database.bytes)}</p></div>
        <div className="rounded-lg bg-surface-2 p-3"><p className="text-xs text-muted">Active sessions</p><p className="mt-0.5 text-sm font-semibold text-ink">{data.sessions.appSessions} app · {data.sessions.adminSessions} admin</p></div>
        <div className="rounded-lg bg-surface-2 p-3"><p className="text-xs text-muted">Server</p><p className="mt-0.5 text-sm font-semibold text-ink">Node {data.server.node} · up {uptime > 3600 ? `${Math.floor(uptime / 3600)} h` : `${Math.floor(uptime / 60)} min`}</p></div>
      </div>
      <p className="flex items-center gap-2 text-xs text-muted"><Database className="size-3.5" /> {data.database.database} on {data.database.host}</p>
      <div className="-mx-5">
        <Table>
          <thead><tr><Th>Table</Th><Th align="right">Rows (approx.)</Th><Th align="right">Size</Th></tr></thead>
          <tbody>
            {data.tables.map((table) => <tr key={table.name}><Td className="font-mono text-xs">{table.name}</Td><Td align="right">{formatNumber(table.rows)}</Td><Td align="right">{formatBytes(table.bytes)}</Td></tr>)}
          </tbody>
        </Table>
      </div>
      <div><Button size="sm" loading={loading} onClick={reload}>Refresh</Button></div>
    </div>
  );
}

export function SettingsPage() {
  const { admin, can } = useAuth();
  return (
    <>
      <PageHeader title="Settings" description="Your account and system configuration." />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title="My account" subtitle={`${admin!.fullName} · ${admin!.email} · ${admin!.roleLabel}`}>
          <ChangePassword />
        </Card>
        {can('settings:manage') && (
          <Card title={<span className="inline-flex items-center gap-2"><ShieldCheck className="size-4 text-muted" /> Privacy and engagement</span>}>
            <SystemSettings />
          </Card>
        )}
        {can('settings:manage') && (
          <Card className="xl:col-span-2" title={<span className="inline-flex items-center gap-2"><Server className="size-4 text-muted" /> System health</span>}>
            <SystemHealth />
          </Card>
        )}
      </div>
    </>
  );
}
