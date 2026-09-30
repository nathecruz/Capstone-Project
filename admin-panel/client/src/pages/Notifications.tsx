import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Bell, Pencil, Plus, Send, Trash2, Trophy, Zap } from 'lucide-react';
import { ComposeModal, PhonePreview, renderPreview } from '../components/Compose';
import { Alert, Badge, Button, Card, ConfirmDialog, cx, EmptyState, Field, IconButton, Input, Modal, PageHeader, Pagination, Select, Spinner, Switch, Table, Tabs, Td, Textarea, Th, useToast } from '../components/ui';
import { del, patch, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime, formatNumber, formatPercent, formatRelative } from '../lib/format';
import type { Template, TemplateVariable } from '../lib/types';
import { useApi } from '../lib/useApi';

interface TemplatesResponse {
  templates: Template[];
  variables: TemplateVariable[];
  sample: Record<string, string>;
}

interface Broadcast {
  id: string;
  type: 'system' | 'reminder';
  title: string;
  body: string;
  audienceLabel: string;
  recipientCount: number;
  delivered: number;
  read: number;
  sentAt: number;
  templateName: string | null;
  sentBy: string | null;
}

function TemplateModal({ open, template, variables, sample, onClose, onSaved }: {
  open: boolean;
  template: Template | null;
  variables: TemplateVariable[];
  sample: Record<string, string>;
  onClose: () => void;
  onSaved: (templates: Template[]) => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', type: 'system' as 'system' | 'reminder', title: '', body: '', description: '', isActive: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastField = useRef<'title' | 'body'>('body');
  const isSystem = Boolean(template?.isSystem);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(template
      ? { name: template.name, type: template.type, title: template.title, body: template.body, description: template.description, isActive: template.isActive }
      : { name: '', type: 'system', title: '', body: '', description: '', isActive: true });
  }, [open, template]);

  const allowed = variables.filter((variable) => (isSystem ? variable.key === 'habit' || variable.key === 'app_name' : variable.key !== 'habit'));

  function insert(key: string) {
    const field = lastField.current;
    setForm((current) => ({ ...current, [field]: `${current[field]}${current[field] && !current[field].endsWith(' ') ? ' ' : ''}{{${key}}}` }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = template
        ? await patch<{ templates: Template[] }>(`/notifications/templates/${template.id}`, form)
        : await post<{ templates: Template[] }>('/notifications/templates', form);
      onSaved(result.templates);
      toast(template ? 'Template saved.' : 'Template created.');
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save the template.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={template ? 'Edit template' : 'New template'}
      description={isSystem ? 'This template is used automatically by the reminder dispatcher when a habit reminder is due.' : 'Reusable message for notifications you send to students.'}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="template-form" loading={busy}>{template ? 'Save template' : 'Create template'}</Button></>}
    >
      <div className="grid grid-cols-1 gap-5 md:grid-cols-[1fr_280px]">
        <form id="template-form" onSubmit={submit} className="flex flex-col gap-4">
          {error && <Alert tone="critical">{error}</Alert>}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Template name" htmlFor="tpl-name"><Input id="tpl-name" required maxLength={80} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
            <Field label="Shows under" htmlFor="tpl-type">
              <Select id="tpl-type" value={form.type} disabled={isSystem} onChange={(event) => setForm({ ...form, type: event.target.value as 'system' | 'reminder' })}>
                <option value="system">System updates</option>
                <option value="reminder">Reminders</option>
              </Select>
            </Field>
          </div>
          <Field label="Internal description" htmlFor="tpl-description"><Input id="tpl-description" maxLength={200} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></Field>
          <Field label="Title" htmlFor="tpl-title"><Input id="tpl-title" required maxLength={120} value={form.title} onFocus={() => { lastField.current = 'title'; }} onChange={(event) => setForm({ ...form, title: event.target.value })} /></Field>
          <Field label="Message" htmlFor="tpl-body" hint={`${form.body.length}/500`}>
            <Textarea id="tpl-body" required rows={4} maxLength={500} value={form.body} onFocus={() => { lastField.current = 'body'; }} onChange={(event) => setForm({ ...form, body: event.target.value })} />
          </Field>
          <div>
            <p className="mb-1.5 text-[13px] font-medium text-ink">Insert a placeholder</p>
            <div className="flex flex-wrap gap-1.5">
              {allowed.map((variable) => (
                <button key={variable.key} type="button" title={variable.description} onClick={() => insert(variable.key)} className="rounded-md border border-line bg-surface-2 px-2 py-1 font-mono text-xs text-ink-2 hover:border-accent hover:text-ink">
                  {`{{${variable.key}}}`}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-line p-3">
            <div>
              <p className="text-sm font-medium text-ink">Active</p>
              <p className="text-xs text-muted">{isSystem ? 'When off, reminders use the built-in default text.' : 'Inactive templates are hidden when sending.'}</p>
            </div>
            <Switch label="Active" checked={form.isActive} onChange={(value) => setForm({ ...form, isActive: value })} />
          </div>
        </form>
        <PhonePreview type={form.type} title={renderPreview(form.title, sample)} body={renderPreview(form.body, sample)} />
      </div>
    </Modal>
  );
}

function AchievementModal({ achievement, onClose, onSaved }: { achievement: { id: string; name: string; description: string } | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (achievement) { setName(achievement.name); setDescription(achievement.description); setError(null); }
  }, [achievement]);

  async function save() {
    if (!achievement) return;
    setBusy(true);
    setError(null);
    try {
      await patch(`/notifications/achievements/${achievement.id}`, { name, description });
      toast('Achievement notification updated.');
      onSaved();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={Boolean(achievement)} onClose={onClose} title="Edit achievement notification" size="sm" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save</Button></>}>
      <div className="flex flex-col gap-4">
        {error && <Alert tone="critical">{error}</Alert>}
        <Field label="Title (achievement name)" htmlFor="ach-name"><Input id="ach-name" maxLength={60} value={name} onChange={(event) => setName(event.target.value)} /></Field>
        <Field label="Message" htmlFor="ach-description"><Textarea id="ach-description" maxLength={200} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} /></Field>
        <p className="text-xs text-muted">Used for the notification a student receives when they unlock this achievement.</p>
      </div>
    </Modal>
  );
}

export function NotificationsPage() {
  const { can } = useAuth();
  const manage = can('notifications:manage');
  const toast = useToast();
  const [tab, setTab] = useState<'templates' | 'history' | 'automatic'>('templates');
  const templates = useApi<TemplatesResponse>('/notifications/templates');
  const [historyPage, setHistoryPage] = useState(1);
  const history = useApi<{ items: Broadcast[]; total: number; page: number; pageSize: number }>(tab === 'history' ? `/notifications/broadcasts?page=${historyPage}` : null);
  const achievements = useApi<{ achievements: { id: string; name: string; description: string; earnedBy: number }[] }>(tab === 'automatic' ? '/notifications/achievements' : null);
  const [editing, setEditing] = useState<Template | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Template | null>(null);
  const [compose, setCompose] = useState<{ templateId: string | null } | null>(null);
  const [editingAchievement, setEditingAchievement] = useState<{ id: string; name: string; description: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const setTemplates = (list: Template[]) => templates.data && templates.setData({ ...templates.data, templates: list });
  const all = templates.data?.templates ?? [];
  const manual = all.filter((template) => !template.isSystem);
  const automatic = all.filter((template) => template.isSystem);

  async function toggle(template: Template, isActive: boolean) {
    try {
      const result = await patch<{ templates: Template[] }>(`/notifications/templates/${template.id}`, { isActive });
      setTemplates(result.templates);
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : 'Could not update.', 'critical');
    }
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    try {
      const result = await del<{ templates: Template[] }>(`/notifications/templates/${deleting.id}`);
      setTemplates(result.templates);
      toast('Template deleted.');
      setDeleting(null);
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : 'Could not delete.', 'critical');
    } finally {
      setBusy(false);
    }
  }

  const templateRow = (template: Template) => (
    <li key={template.id} className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-ink">{template.name}</p>
          <Badge tone={template.type === 'system' ? 'accent' : 'neutral'}>{template.type === 'system' ? 'System update' : 'Reminder'}</Badge>
          {template.isSystem && <Badge tone="warning" icon={<Zap className="size-3" />}>Automatic</Badge>}
          {!template.isActive && <Badge>Inactive</Badge>}
        </div>
        {template.description && <p className="mt-0.5 text-xs text-muted">{template.description}</p>}
        <div className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-[13px]">
          <p className="font-medium text-ink">{template.title}</p>
          <p className="text-ink-2">{template.body}</p>
        </div>
        <p className="mt-2 text-xs text-muted">
          {template.isSystem ? 'Sent by the reminder dispatcher' : template.timesSent ? `Sent ${template.timesSent} time${template.timesSent === 1 ? '' : 's'} · last ${formatRelative(template.lastSentAt)}` : 'Not sent yet'}
        </p>
      </div>
      {manage && (
        <div className="flex items-center gap-1 sm:flex-col sm:items-end">
          <div className="flex items-center gap-1">
            <Switch label={`${template.name} active`} checked={template.isActive} onChange={(value) => void toggle(template, value)} />
            <IconButton label={`Edit ${template.name}`} onClick={() => setEditing(template)}><Pencil className="size-4" /></IconButton>
            {!template.isSystem && <IconButton label={`Delete ${template.name}`} onClick={() => setDeleting(template)}><Trash2 className="size-4" /></IconButton>}
          </div>
          {!template.isSystem && <Button size="sm" icon={<Send className="size-3.5" />} disabled={!template.isActive} onClick={() => setCompose({ templateId: template.id })}>Send</Button>}
        </div>
      )}
    </li>
  );

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Manage notification templates and send announcements or reminders to students’ in-app Notifications screen."
        actions={manage && (
          <>
            <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>New template</Button>
            <Button variant="primary" icon={<Send className="size-4" />} onClick={() => setCompose({ templateId: null })}>Send notification</Button>
          </>
        )}
      />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'templates', label: 'Templates', count: manual.length }, { value: 'history', label: 'Sent history' }, { value: 'automatic', label: 'Automatic notifications' }]} />

      {tab === 'templates' && (
        templates.error ? <Alert tone="critical">{templates.error}</Alert> : !templates.data ? <Spinner /> : manual.length ? (
          <ul className="grid grid-cols-1 gap-3 xl:grid-cols-2">{manual.map(templateRow)}</ul>
        ) : <Card><EmptyState icon={<Bell className="size-8" />} title="No templates yet">Create a template to reuse announcements and reminders.</EmptyState></Card>
      )}

      {tab === 'history' && (
        <Card bodyClassName="!p-0">
          {history.error && <div className="p-5"><Alert tone="critical">{history.error}</Alert></div>}
          {!history.data ? (history.loading && <Spinner />) : history.data.items.length === 0 ? (
            <EmptyState icon={<Send className="size-8" />} title="Nothing sent yet">Notifications you send appear here with their read rate.</EmptyState>
          ) : (
            <div className={cx(history.loading && 'opacity-60')}>
              <Table>
                <thead>
                  <tr><Th>Sent</Th><Th>Notification</Th><Th>Audience</Th><Th align="right">Recipients</Th><Th>Read rate</Th><Th>Sent by</Th></tr>
                </thead>
                <tbody>
                  {history.data.items.map((item) => {
                    const rate = item.delivered ? item.read / item.delivered : null;
                    return (
                      <tr key={item.id}>
                        <Td className="whitespace-nowrap text-ink-2">{formatDateTime(item.sentAt)}</Td>
                        <Td>
                          <p className="font-medium text-ink">{item.title}</p>
                          <p className="line-clamp-1 max-w-md text-xs text-muted">{item.body}</p>
                          <div className="mt-1 flex gap-1.5"><Badge tone={item.type === 'system' ? 'accent' : 'neutral'}>{item.type === 'system' ? 'System update' : 'Reminder'}</Badge>{item.templateName && <Badge>{item.templateName}</Badge>}</div>
                        </Td>
                        <Td className="text-ink-2">{item.audienceLabel}</Td>
                        <Td align="right">{formatNumber(item.recipientCount)}</Td>
                        <Td>
                          <div className="flex min-w-32 items-center gap-2">
                            <div className="h-1.5 flex-1 rounded-full bg-surface-2"><div className="h-full rounded-full" style={{ width: `${(rate ?? 0) * 100}%`, background: 'var(--series-1)' }} /></div>
                            <span className="w-24 text-right text-xs text-ink-2 tabular">{formatPercent(rate)} ({item.read}/{item.delivered})</span>
                          </div>
                        </Td>
                        <Td className="whitespace-nowrap text-ink-2">{item.sentBy ?? '—'}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
              <Pagination page={history.data.page} pageSize={history.data.pageSize} total={history.data.total} onPage={setHistoryPage} />
            </div>
          )}
        </Card>
      )}

      {tab === 'automatic' && (
        <div className="flex flex-col gap-5">
          <Card title="Habit reminders" subtitle="Text of the push and in-app reminder sent when a student’s habit reminder is due.">
            {automatic.length ? <ul className="flex flex-col gap-3">{automatic.map(templateRow)}</ul> : <EmptyState title="No automatic templates" />}
          </Card>
          <Card title="Achievement unlocked" subtitle="Title and message a student receives when they earn each achievement." bodyClassName="!px-0 !pb-0">
            {achievements.error && <div className="px-5 pb-5"><Alert tone="critical">{achievements.error}</Alert></div>}
            {!achievements.data ? (achievements.loading && <Spinner />) : (
              <Table>
                <thead><tr><Th>Achievement</Th><Th>Message</Th><Th align="right">Earned by</Th>{manage && <Th><span className="sr-only">Actions</span></Th>}</tr></thead>
                <tbody>
                  {achievements.data.achievements.map((achievement) => (
                    <tr key={achievement.id}>
                      <Td><span className="inline-flex items-center gap-2 font-medium"><Trophy className="size-4 text-muted" aria-hidden />{achievement.name}</span></Td>
                      <Td className="text-ink-2">{achievement.description}</Td>
                      <Td align="right">{achievement.earnedBy}</Td>
                      {manage && <Td align="right"><IconButton label={`Edit ${achievement.name}`} onClick={() => setEditingAchievement(achievement)}><Pencil className="size-4" /></IconButton></Td>}
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      )}

      <TemplateModal
        open={creating || Boolean(editing)}
        template={editing}
        variables={templates.data?.variables ?? []}
        sample={templates.data?.sample ?? {}}
        onClose={() => { setCreating(false); setEditing(null); }}
        onSaved={setTemplates}
      />
      <ConfirmDialog open={Boolean(deleting)} title="Delete template" confirmLabel="Delete" busy={busy} onClose={() => setDeleting(null)} onConfirm={remove}>
        Delete <strong className="text-ink">{deleting?.name}</strong>? Notifications already sent are not affected.
      </ConfirmDialog>
      <ComposeModal
        open={Boolean(compose)}
        initialTemplateId={compose?.templateId}
        onClose={() => setCompose(null)}
        onSent={() => { templates.reload(); history.reload(); setTab('history'); setHistoryPage(1); }}
      />
      <AchievementModal achievement={editingAchievement} onClose={() => setEditingAchievement(null)} onSaved={achievements.reload} />
    </>
  );
}
