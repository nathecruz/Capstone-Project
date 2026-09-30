import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LifeBuoy, Lightbulb, Paperclip } from 'lucide-react';
import { Alert, Badge, Button, Card, EmptyState, Field, Modal, PageHeader, Select, Spinner, Table, Tabs, Td, Textarea, Th, useToast } from '../components/ui';
import { patch } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime, formatRelative } from '../lib/format';
import { useApi } from '../lib/useApi';

interface Issue {
  id: string;
  topic: string;
  timing: string;
  description: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  adminNotes: string;
  createdAt: number;
  updatedAt: number | null;
  attachmentName: string | null;
  hasAttachment: boolean;
  userId: string;
  userName: string;
  userEmail: string;
}

interface Suggestion {
  id: string;
  suggestion: string;
  status: string;
  createdAt: number;
  userName: string;
  userEmail: string;
}

const ISSUE_STATUS = {
  open: { label: 'Open', tone: 'critical' as const },
  in_progress: { label: 'In progress', tone: 'warning' as const },
  resolved: { label: 'Resolved', tone: 'good' as const },
  closed: { label: 'Closed', tone: 'neutral' as const },
};

const SUGGESTION_STATUS: Record<string, string> = { new: 'New', under_review: 'Under review', planned: 'Planned', done: 'Done', declined: 'Declined' };

function IssueModal({ issue, onClose, onSaved, canManage }: { issue: Issue | null; onClose: () => void; onSaved: () => void; canManage: boolean }) {
  const toast = useToast();
  const [status, setStatus] = useState<Issue['status']>('open');
  const [notes, setNotes] = useState('');
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (issue) { setStatus(issue.status); setNotes(issue.adminNotes); setNotify(true); setError(null); }
  }, [issue]);

  async function save() {
    if (!issue) return;
    setBusy(true);
    setError(null);
    try {
      await patch(`/support/issues/${issue.id}`, { status, adminNotes: notes, notifyUser: notify && status !== issue.status });
      toast('Issue updated.');
      onSaved();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not update the issue.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={Boolean(issue)}
      onClose={onClose}
      title={issue?.topic ?? 'Issue'}
      description={issue && <>Reported by {issue.userName} ({issue.userEmail}) · {formatDateTime(issue.createdAt)}</>}
      footer={canManage ? <><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save</Button></> : <Button onClick={onClose}>Close</Button>}
    >
      {issue && (
        <div className="flex flex-col gap-4">
          {error && <Alert tone="critical">{error}</Alert>}
          <div className="rounded-lg bg-surface-2 p-3 text-sm">
            <p className="mb-1 text-xs text-muted">When it happened: {issue.timing}</p>
            <p className="whitespace-pre-line text-ink">{issue.description}</p>
          </div>
          {issue.hasAttachment && (
            <a href={`/api/support/issues/${issue.id}/attachment`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm font-medium text-accent-ink hover:underline">
              <Paperclip className="size-4" /> {issue.attachmentName || 'Attachment'}
            </a>
          )}
          {canManage && (
            <>
              <Field label="Status" htmlFor="issue-status">
                <Select id="issue-status" value={status} onChange={(event) => setStatus(event.target.value as Issue['status'])}>
                  {Object.entries(ISSUE_STATUS).map(([value, info]) => <option key={value} value={value}>{info.label}</option>)}
                </Select>
              </Field>
              <Field label="Notes" htmlFor="issue-notes" hint="Internal notes. If you notify the student, the notes are included in the message.">
                <Textarea id="issue-notes" rows={3} maxLength={1000} value={notes} onChange={(event) => setNotes(event.target.value)} />
              </Field>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" className="accent-[var(--accent)]" checked={notify} disabled={status === issue.status} onChange={(event) => setNotify(event.target.checked)} />
                Notify the student in the app about the status change
              </label>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

export function SupportPage() {
  const { can } = useAuth();
  const toast = useToast();
  const manage = can('support:manage');
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'suggestions' ? 'suggestions' : 'issues';
  const [filter, setFilter] = useState('');
  const issues = useApi<{ items: Issue[]; counts: Record<string, number> }>(tab === 'issues' ? `/support/issues${filter ? `?status=${filter}` : ''}` : null);
  const suggestions = useApi<{ items: Suggestion[] }>(tab === 'suggestions' ? '/support/suggestions' : null);
  const [selected, setSelected] = useState<Issue | null>(null);

  async function setSuggestionStatus(id: string, status: string) {
    try {
      await patch(`/support/suggestions/${id}`, { status });
      suggestions.reload();
      toast('Suggestion updated.');
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : 'Could not update.', 'critical');
    }
  }

  const counts = issues.data?.counts ?? {};
  return (
    <>
      <PageHeader title="Support" description="Issue reports and feature suggestions submitted from the HabitAI app." />
      <Tabs value={tab} onChange={(value) => setParams(value === 'issues' ? {} : { tab: value })} tabs={[{ value: 'issues', label: 'Issue reports' }, { value: 'suggestions', label: 'Feature suggestions' }]} />

      {tab === 'issues' && (
        <Card bodyClassName="!p-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
            {[['', 'All'], ...Object.entries(ISSUE_STATUS).map(([value, info]) => [value, info.label])].map(([value, label]) => (
              <Button key={value} size="sm" variant={filter === value ? 'primary' : 'secondary'} onClick={() => setFilter(value)}>
                {label}{value && counts[value] ? ` (${counts[value]})` : ''}
              </Button>
            ))}
          </div>
          {issues.error && <div className="p-5"><Alert tone="critical">{issues.error}</Alert></div>}
          {!issues.data ? (issues.loading && <Spinner />) : issues.data.items.length === 0 ? (
            <EmptyState icon={<LifeBuoy className="size-8" />} title="No issue reports">Reports students submit from Help & Support appear here.</EmptyState>
          ) : (
            <Table>
              <thead><tr><Th>Issue</Th><Th>Student</Th><Th>Status</Th><Th>Reported</Th></tr></thead>
              <tbody>
                {issues.data.items.map((issue) => (
                  <tr key={issue.id} className="cursor-pointer hover:bg-surface-hover" onClick={() => setSelected(issue)}>
                    <Td>
                      <p className="font-medium text-ink">{issue.topic}{issue.hasAttachment && <Paperclip className="ml-1.5 inline size-3.5 text-muted" aria-label="Has attachment" />}</p>
                      <p className="line-clamp-1 max-w-lg text-xs text-muted">{issue.description}</p>
                    </Td>
                    <Td><p className="text-ink">{issue.userName}</p><p className="text-xs text-muted">{issue.userEmail}</p></Td>
                    <Td><Badge tone={ISSUE_STATUS[issue.status]?.tone ?? 'neutral'}>{ISSUE_STATUS[issue.status]?.label ?? issue.status}</Badge></Td>
                    <Td className="whitespace-nowrap text-ink-2">{formatRelative(issue.createdAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {tab === 'suggestions' && (
        <Card bodyClassName="!p-0">
          {suggestions.error && <div className="p-5"><Alert tone="critical">{suggestions.error}</Alert></div>}
          {!suggestions.data ? (suggestions.loading && <Spinner />) : suggestions.data.items.length === 0 ? (
            <EmptyState icon={<Lightbulb className="size-8" />} title="No suggestions yet" />
          ) : (
            <Table>
              <thead><tr><Th>Suggestion</Th><Th>Student</Th><Th>Submitted</Th><Th>Status</Th></tr></thead>
              <tbody>
                {suggestions.data.items.map((item) => (
                  <tr key={item.id}>
                    <Td className="max-w-xl whitespace-pre-line">{item.suggestion}</Td>
                    <Td><p className="text-ink">{item.userName}</p><p className="text-xs text-muted">{item.userEmail}</p></Td>
                    <Td className="whitespace-nowrap text-ink-2">{formatRelative(item.createdAt)}</Td>
                    <Td>
                      {manage ? (
                        <Select aria-label="Suggestion status" value={item.status} onChange={(event) => void setSuggestionStatus(item.id, event.target.value)} className="w-36">
                          {Object.entries(SUGGESTION_STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </Select>
                      ) : <Badge>{SUGGESTION_STATUS[item.status] ?? item.status}</Badge>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      <IssueModal issue={selected} canManage={manage} onClose={() => setSelected(null)} onSaved={issues.reload} />
    </>
  );
}
