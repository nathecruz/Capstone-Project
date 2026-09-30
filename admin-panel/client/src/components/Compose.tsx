import { useEffect, useMemo, useState } from 'react';
import { Bell, Send } from 'lucide-react';
import { post } from '../lib/api';
import type { Audience, Template, TemplateVariable } from '../lib/types';
import { useApi } from '../lib/useApi';
import { Alert, Button, Field, Input, Modal, Select, Textarea, useToast } from './ui';

interface TemplatesResponse {
  templates: Template[];
  variables: TemplateVariable[];
  sample: Record<string, string>;
}

export function renderPreview(text: string, sample: Record<string, string>) {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key: string) => sample[key.toLowerCase()] ?? match);
}

/** How the notification will look inside the HabitAI app's Notifications screen. */
export function PhonePreview({ type, title, body }: { type: 'system' | 'reminder'; title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface-2 p-3">
      <p className="mb-2 text-xs font-medium text-muted">Preview in the app · {type === 'system' ? 'System' : 'Reminders'} tab</p>
      <div className="flex gap-3 rounded-xl bg-surface p-3 shadow-card">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full" style={{ background: 'color-mix(in srgb, #6c8dff 16%, transparent)', color: '#6c8dff' }}>
          <Bell className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">{title || 'Notification title'}</p>
          <p className="mt-0.5 whitespace-pre-line text-[13px] text-ink-2">{body || 'Notification message'}</p>
          <p className="mt-1 text-[11px] text-muted">Just now</p>
        </div>
      </div>
    </div>
  );
}

export const AUDIENCES: { value: Exclude<Audience['kind'], 'users'>; label: string }[] = [
  { value: 'all', label: 'All active students' },
  { value: 'active', label: 'Recently active students' },
  { value: 'inactive', label: 'Inactive students (re-engagement)' },
  { value: 'no_habits', label: 'Students without any habit' },
];

export function ComposeModal({ open, onClose, onSent, fixedAudience, initialTemplateId }: {
  open: boolean;
  onClose: () => void;
  onSent?: () => void;
  fixedAudience?: { audience: Audience; label: string };
  initialTemplateId?: string | null;
}) {
  const toast = useToast();
  const templates = useApi<TemplatesResponse>(open ? '/notifications/templates' : null);
  const usable = useMemo(() => (templates.data?.templates ?? []).filter((template) => !template.isSystem && template.isActive), [templates.data]);
  const [templateId, setTemplateId] = useState<string>('');
  const [type, setType] = useState<'system' | 'reminder'>('system');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audienceKind, setAudienceKind] = useState<Exclude<Audience['kind'], 'users'>>('all');
  const [count, setCount] = useState<{ count: number; label: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setConfirming(false);
    setTemplateId(initialTemplateId ?? '');
    setTitle('');
    setBody('');
    setType('system');
    setAudienceKind('all');
  }, [open, initialTemplateId]);

  useEffect(() => {
    const template = usable.find((item) => item.id === templateId);
    if (template) {
      setType(template.type);
      setTitle(template.title);
      setBody(template.body);
    }
  }, [templateId, usable]);

  const audience: Audience = fixedAudience?.audience ?? { kind: audienceKind };
  const audienceKey = JSON.stringify(audience);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCount(null);
    post<{ count: number; label: string }>('/notifications/audience-preview', { audience: JSON.parse(audienceKey) })
      .then((result) => { if (!cancelled) setCount(result); })
      .catch(() => { if (!cancelled) setCount(null); });
    return () => { cancelled = true; };
  }, [open, audienceKey]);

  const sample = templates.data?.sample ?? {};

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const result = await post<{ recipients: number }>('/notifications/broadcasts', { templateId: templateId || null, type, title, body, audience });
      toast(`Notification sent to ${result.recipients} account${result.recipients === 1 ? '' : 's'}.`);
      onSent?.();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not send the notification.');
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  const recipients = count?.count ?? 0;
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Send notification"
      description="Delivered to the Notifications screen of the HabitAI app. Placeholders are filled in for each recipient."
      footer={confirming ? (
        <>
          <span className="mr-auto self-center text-[13px] text-ink-2">Send to <strong className="text-ink">{recipients}</strong> account{recipients === 1 ? '' : 's'}? This cannot be recalled.</span>
          <Button onClick={() => setConfirming(false)}>Back</Button>
          <Button variant="primary" loading={busy} icon={<Send className="size-4" />} onClick={send}>Confirm and send</Button>
        </>
      ) : (
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={<Send className="size-4" />} disabled={!title.trim() || !body.trim() || !recipients} onClick={() => setConfirming(true)}>Review and send</Button>
        </>
      )}
    >
      <div className="grid grid-cols-1 gap-5 md:grid-cols-[1fr_280px]">
        <div className="flex flex-col gap-4">
          {error && <Alert tone="critical">{error}</Alert>}
          <Field label="Start from a template" htmlFor="compose-template">
            <Select id="compose-template" value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
              <option value="">Write a custom message</option>
              {usable.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Audience" htmlFor="compose-audience" hint={count ? `${count.count} matching account${count.count === 1 ? '' : 's'}` : 'Counting recipients…'}>
              {fixedAudience ? <Input id="compose-audience" value={fixedAudience.label} disabled /> : (
                <Select id="compose-audience" value={audienceKind} onChange={(event) => setAudienceKind(event.target.value as typeof audienceKind)}>
                  {AUDIENCES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Shows under" htmlFor="compose-type">
              <Select id="compose-type" value={type} onChange={(event) => setType(event.target.value as 'system' | 'reminder')}>
                <option value="system">System updates</option>
                <option value="reminder">Reminders</option>
              </Select>
            </Field>
          </div>
          <Field label="Title" htmlFor="compose-title"><Input id="compose-title" value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} /></Field>
          <Field label="Message" htmlFor="compose-body" hint={`${body.length}/500 · Placeholders: ${(templates.data?.variables ?? []).filter((variable) => variable.key !== 'habit').map((variable) => `{{${variable.key}}}`).join(' ')}`}>
            <Textarea id="compose-body" value={body} maxLength={500} rows={4} onChange={(event) => setBody(event.target.value)} />
          </Field>
        </div>
        <PhonePreview type={type} title={renderPreview(title, sample)} body={renderPreview(body, sample)} />
      </div>
    </Modal>
  );
}
