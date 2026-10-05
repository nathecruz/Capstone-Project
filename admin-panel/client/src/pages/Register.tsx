import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { CircleCheck, Eye, EyeOff, Send } from 'lucide-react';
import { STAFF_ROLE_OPTIONS } from '../components/UserActions';
import { Alert, Button, cx, Field, Input, Textarea } from '../components/ui';
import { post } from '../lib/api';
import type { AccessRequest } from '../lib/types';
import { AuthLayout } from './Login';

/** Public form that asks for Admin Panel access; an administrator approves it from the Users page. */
export function RegisterPage() {
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', password: '', confirm: '', reason: '' });
  const [requestedRole, setRequestedRole] = useState<AccessRequest['requestedRole']>('faculty');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const mismatch = Boolean(form.confirm) && form.password !== form.confirm;
  const complete = Boolean(form.firstName.trim() && form.lastName.trim() && form.email.trim() && form.password && form.confirm) && !mismatch;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!complete) return;
    setError(null);
    setBusy(true);
    try {
      await post('/auth/register', {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        password: form.password,
        requestedRole,
        reason: form.reason.trim(),
      });
      setSent(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to send the request.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Request access" subtitle="For PSAU faculty and system administrators. An administrator approves each request." wide>
      {sent ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-line bg-surface p-6 text-center shadow-card">
          <CircleCheck className="size-9 text-good-ink" aria-hidden />
          <h2 className="text-base font-semibold text-ink">Request sent</h2>
          <p className="text-sm text-ink-2">
            A System Administrator will review your request. Once it is approved, sign in with <strong className="text-ink">{form.email.trim()}</strong> and the password you chose.
          </p>
          <Link to="/" className="mt-2 text-sm font-medium text-accent-ink hover:underline">Back to sign in</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-6 shadow-card" noValidate>
          {error && <Alert tone="critical">{error}</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" htmlFor="r-first">
              <Input id="r-first" autoComplete="given-name" required maxLength={60} value={form.firstName} onChange={set('firstName')} />
            </Field>
            <Field label="Last name" htmlFor="r-last">
              <Input id="r-last" autoComplete="family-name" required maxLength={60} value={form.lastName} onChange={set('lastName')} />
            </Field>
          </div>
          <Field label="Email" htmlFor="r-email">
            <Input id="r-email" type="email" autoComplete="email" required maxLength={254} value={form.email} onChange={set('email')} placeholder="you@psau.edu.ph" />
          </Field>
          <Field label="Password" htmlFor="r-password" hint="At least 8 characters with uppercase and lowercase letters, a number and a symbol. Leave out your name and email.">
            <div className="relative">
              <Input id="r-password" type={show ? 'text' : 'password'} autoComplete="new-password" required maxLength={128} value={form.password} onChange={set('password')} className="pr-10" />
              <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'} className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted hover:text-ink">
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </Field>
          <Field label="Confirm password" htmlFor="r-confirm" error={mismatch ? 'The passwords do not match.' : undefined}>
            <Input id="r-confirm" type={show ? 'text' : 'password'} autoComplete="new-password" required maxLength={128} value={form.confirm} onChange={set('confirm')} />
          </Field>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-[13px] font-medium text-ink">Access needed</legend>
            {STAFF_ROLE_OPTIONS.map((option) => (
              <label key={option.value} className={cx('flex cursor-pointer gap-3 rounded-lg border p-3', requestedRole === option.value ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface-hover')}>
                <input type="radio" name="requested-role" className="mt-1 accent-[var(--accent)]" checked={requestedRole === option.value} onChange={() => setRequestedRole(option.value as AccessRequest['requestedRole'])} />
                <span>
                  <span className="block text-sm font-medium text-ink">{option.label}</span>
                  <span className="block text-xs text-ink-2">{option.description}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <Field label="Reason (optional)" htmlFor="r-reason" hint="Helps the administrator recognize you, e.g. “Capstone adviser, CS Department”.">
            <Textarea id="r-reason" maxLength={300} value={form.reason} onChange={set('reason')} />
          </Field>
          <Button type="submit" variant="primary" loading={busy} disabled={!complete} icon={<Send className="size-4" />}>Send request</Button>
        </form>
      )}

      {!sent && (
        <p className="mt-5 text-center text-sm text-ink-2">
          Already have access? <Link to="/" className="font-medium text-accent-ink hover:underline">Sign in</Link>
        </p>
      )}
      <p className="mt-4 text-center text-xs text-muted">Nobody can sign in with a request until a System Administrator approves it. Requests are recorded in the audit log.</p>
    </AuthLayout>
  );
}
