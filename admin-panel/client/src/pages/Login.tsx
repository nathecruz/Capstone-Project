import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { Alert, Button, Field, Input } from '../components/ui';
import { useAuth } from '../lib/auth';

/** Logo and title shared by the sign-in and access request pages. */
export function AuthHeader({ subtitle }: { subtitle: string }) {
  return (
    <div className="mb-8 flex flex-col items-center text-center">
      <span className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-accent text-on-accent shadow-card">
        <svg viewBox="0 0 32 32" className="size-7" aria-hidden><path d="M9 16.5l4.5 4.5L23 11.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
      <h1 className="text-xl font-semibold text-ink">HabitAI Admin Panel</h1>
      <p className="mt-1 text-sm text-ink-2">{subtitle}</p>
    </div>
  );
}

export function LoginPage() {
  const { login, expired } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email.trim(), password);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to sign in.');
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-4 py-10">
      <div className="w-full max-w-sm">
        <AuthHeader subtitle="For PSAU faculty and system administrators" />

        <form onSubmit={submit} className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-6 shadow-card" noValidate>
          {expired && !error && <Alert tone="warning">Your session expired. Please sign in again.</Alert>}
          {error && <Alert tone="critical">{error}</Alert>}
          <Field label="Email" htmlFor="email">
            <Input id="email" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@psau.edu.ph" />
          </Field>
          <Field label="Password" htmlFor="password">
            <div className="relative">
              <Input id="password" type={show ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} className="pr-10" />
              <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'} className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted hover:text-ink">
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </Field>
          <Button type="submit" variant="primary" loading={busy} disabled={!email || !password} icon={<Lock className="size-4" />}>Sign in</Button>
        </form>
        <p className="mt-5 text-center text-sm text-ink-2">
          No account yet? <Link to="/register" className="font-medium text-accent-ink hover:underline">Request access</Link>
        </p>
        <p className="mt-4 text-center text-xs text-muted">Access is limited to accounts with the Faculty or Administrator role. Every sign-in is recorded in the audit log.</p>
      </div>
    </div>
  );
}
