import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChartColumn, Eye, EyeOff, HeartPulse, Lock, ShieldCheck } from 'lucide-react';
import { Alert, Button, cx, Field, Input } from '../components/ui';
import { useAuth } from '../lib/auth';

const FEATURES = [
  { icon: HeartPulse, title: 'Class Pulse for faculty', text: 'See how your students are doing with their habits as a group. No student is ever named.' },
  { icon: ChartColumn, title: 'Engagement analytics', text: 'Check-ins, consistency and trends across HabitAI, updated from the app.' },
  { icon: ShieldCheck, title: 'Managed access', text: 'Accounts, categories, notifications and support, with every action in the audit log.' },
];

/**
 * The sign-in and access request pages: the HabitAI story on a purple panel (a band on phones)
 * beside the form.
 */
export function AuthLayout({ title, subtitle, wide = false, children }: { title: string; subtitle: string; wide?: boolean; children: ReactNode }) {
  return (
    // On phones the purple band takes only its own height; the form gets the rest of the screen.
    <div className="grid min-h-screen grid-rows-[auto_1fr] bg-page lg:grid-cols-2 lg:grid-rows-none">
      <aside className="flex flex-col gap-8 bg-gradient-to-br from-[#5b42d8] to-[#7a5cf0] px-6 py-6 text-white sm:px-10 lg:justify-between lg:py-12">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-white/15">
            <svg viewBox="0 0 32 32" className="size-6" aria-hidden><path d="M9 16.5l4.5 4.5L23 11.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
          <div className="leading-tight">
            <p className="text-base font-semibold">HabitAI</p>
            <p className="text-xs opacity-80">Admin Panel</p>
          </div>
        </div>
        <div className="hidden max-w-md lg:block">
          <h2 className="text-3xl font-bold leading-tight [text-wrap:balance]">Habit data for PSAU faculty and administrators, in one place.</h2>
          <ul className="mt-8 flex flex-col gap-5">
            {FEATURES.map((feature) => (
              <li key={feature.title} className="flex gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/15"><feature.icon className="size-4" aria-hidden /></span>
                <div>
                  <p className="text-sm font-semibold">{feature.title}</p>
                  <p className="mt-0.5 text-sm leading-5 opacity-85">{feature.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="hidden text-xs opacity-75 lg:block">Students use the HabitAI app. This panel is for PSAU faculty and system administrators.</p>
      </aside>
      <main className="flex justify-center px-4 py-10 sm:px-8 lg:items-center">
        <div className={cx('w-full', wide ? 'max-w-md' : 'max-w-sm')}>
          <h1 className="text-2xl font-semibold text-ink">{title}</h1>
          <p className="mt-1 text-sm text-ink-2">{subtitle}</p>
          <div className="mt-6">{children}</div>
        </div>
      </main>
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
    <AuthLayout title="Sign in" subtitle="Use your PSAU faculty or administrator account.">
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
      <p className="mt-4 text-center text-xs text-muted">Only Faculty and System Administrator accounts can sign in. Every sign-in is recorded in the audit log.</p>
    </AuthLayout>
  );
}
