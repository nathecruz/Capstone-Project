import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, EllipsisVertical, KeyRound, LogOut, Pencil, Power, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import { ApiError, del, patch, post } from '../lib/api';
import type { Role, UserRow } from '../lib/types';
import { Alert, Button, ConfirmDialog, cx, Field, Input, Modal, Select, Textarea, useToast } from './ui';

export const ROLE_OPTIONS: { value: Role; label: string; description: string }[] = [
  { value: 'user', label: 'Student', description: 'Uses the HabitAI mobile app. No Admin Panel access.' },
  { value: 'faculty', label: 'PSAU Faculty', description: 'Admin Panel: overview and anonymized analytics (read-only).' },
  { value: 'admin', label: 'System Administrator', description: 'Full Admin Panel access, including user management.' },
];
const GENDERS = ['Female', 'Male', 'Non-binary', 'Prefer not to say'];

function toDateInput(value: string) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Same "Month D, YYYY" format the mobile app stores.
function fromDateInput(value: string) {
  if (!value) return '';
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function errorMessage(error: unknown) {
  return error instanceof ApiError || error instanceof Error ? error.message : 'Something went wrong.';
}

function PasswordReveal({ password }: { password: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3 flex items-center gap-2 rounded-lg border border-line bg-surface-2 p-2 pl-3">
      <code className="flex-1 break-all font-mono text-sm text-ink">{password}</code>
      <Button size="sm" icon={copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} onClick={() => { void navigator.clipboard?.writeText(password); setCopied(true); }}>
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

// Create / edit ------------------------------------------------------------------------

export function UserFormModal({ open, user, onClose, onSaved }: { open: boolean; user?: UserRow | null; onClose: () => void; onSaved: (user: UserRow) => void }) {
  const editing = Boolean(user);
  const toast = useToast();
  const [form, setForm] = useState({ firstName: '', lastName: '', username: '', email: '', role: 'user' as Role, dateOfBirth: '', gender: '', region: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setCreated(null);
    setForm({
      firstName: user?.firstName ?? '',
      lastName: user?.lastName ?? '',
      username: user?.username ?? '',
      email: user?.email ?? '',
      role: user?.role ?? 'user',
      dateOfBirth: toDateInput(user?.dateOfBirth ?? ''),
      gender: user?.gender ?? '',
      region: user?.region ?? '',
      password: '',
    });
  }, [open, user]);

  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm((current) => ({ ...current, [key]: event.target.value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const profile = { firstName: form.firstName, lastName: form.lastName, username: form.username, email: form.email, dateOfBirth: fromDateInput(form.dateOfBirth), gender: form.gender, region: form.region };
    try {
      if (editing && user) {
        const result = await patch<{ user: UserRow }>(`/users/${user.id}`, profile);
        toast('Account details saved.');
        onSaved(result.user);
        onClose();
      } else {
        const result = await post<{ user: UserRow; temporaryPassword?: string }>('/users', { ...profile, role: form.role, password: form.password });
        onSaved(result.user);
        if (result.temporaryPassword) setCreated({ email: result.user.email, password: result.temporaryPassword });
        else { toast('Account created.'); onClose(); }
      }
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <Modal open={open} onClose={onClose} title="Account created" size="sm" footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
        <p className="text-sm text-ink-2">Share this temporary password with <strong className="text-ink">{created.email}</strong> through a private channel. It will not be shown again.</p>
        <PasswordReveal password={created.password} />
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit account' : 'Add account'}
      description={editing ? 'Update the profile details stored for this account.' : 'Create a student, faculty or administrator account.'}
      footer={(
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="user-form" loading={busy}>{editing ? 'Save changes' : 'Create account'}</Button>
        </>
      )}
    >
      <form id="user-form" onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {error && <div className="sm:col-span-2"><Alert tone="critical">{error}</Alert></div>}
        <Field label="First name" htmlFor="u-first-name"><Input id="u-first-name" required autoComplete="given-name" value={form.firstName} onChange={set('firstName')} maxLength={60} /></Field>
        <Field label="Last name" htmlFor="u-last-name"><Input id="u-last-name" required autoComplete="family-name" value={form.lastName} onChange={set('lastName')} maxLength={60} /></Field>
        <Field label="Email" htmlFor="u-email"><Input id="u-email" type="email" required value={form.email} onChange={set('email')} /></Field>
        <Field label="Username" htmlFor="u-username" hint="Letters, numbers, dot, dash, underscore"><Input id="u-username" required value={form.username} onChange={set('username')} maxLength={30} /></Field>
        {!editing && (
          <div className="sm:col-span-2">
            <Field label="Role" htmlFor="u-role" hint={ROLE_OPTIONS.find((option) => option.value === form.role)?.description}>
              <Select id="u-role" value={form.role} onChange={set('role')}>
                {ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </Select>
            </Field>
          </div>
        )}
        <Field label="Date of birth" htmlFor="u-dob"><Input id="u-dob" type="date" value={form.dateOfBirth} onChange={set('dateOfBirth')} max={toDateInput(new Date().toISOString())} /></Field>
        <Field label="Gender" htmlFor="u-gender">
          <Select id="u-gender" value={form.gender} onChange={set('gender')}>
            <option value="">Not specified</option>
            {GENDERS.map((gender) => <option key={gender}>{gender}</option>)}
            {form.gender && !GENDERS.includes(form.gender) && <option>{form.gender}</option>}
          </Select>
        </Field>
        <div className="sm:col-span-2"><Field label="Region / province" htmlFor="u-region"><Input id="u-region" value={form.region} onChange={set('region')} maxLength={80} placeholder="e.g. Pampanga" /></Field></div>
        {!editing && (
          <div className="sm:col-span-2">
            <Field label="Password" htmlFor="u-password" hint="Leave blank to generate a strong temporary password.">
              <Input id="u-password" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} />
            </Field>
          </div>
        )}
      </form>
    </Modal>
  );
}

// Row / page actions -----------------------------------------------------------------------

type Action = 'edit' | 'role' | 'status' | 'password' | 'sessions' | 'delete';

export type UserAction = Action;

export function useUserActions(onChanged: (action?: Action) => void, currentAdminId: string) {
  const toast = useToast();
  const [state, setState] = useState<{ action: Action; user: UserRow } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<Role>('user');
  const [reason, setReason] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [password, setPassword] = useState<string | null>(null);

  const open = useCallback((action: Action, user: UserRow) => {
    setState({ action, user });
    setError(null);
    setRole(user.role);
    setReason('');
    setConfirmEmail('');
    setPassword(null);
  }, []);
  const close = useCallback(() => setState(null), []);

  async function run(task: () => Promise<unknown>, message: string, keepOpen = false) {
    setBusy(true);
    setError(null);
    try {
      await task();
      toast(message);
      onChanged(state?.action);
      if (!keepOpen) close();
    } catch (reasonError) {
      setError(errorMessage(reasonError));
    } finally {
      setBusy(false);
    }
  }

  const user = state?.user;
  const modals: ReactNode = (
    <>
      <UserFormModal open={state?.action === 'edit'} user={user} onClose={close} onSaved={() => onChanged()} />

      <Modal
        open={state?.action === 'role'}
        onClose={close}
        title="Change role"
        size="sm"
        description={user && <>Choose what <strong className="text-ink">{user.fullName}</strong> can access.</>}
        footer={<><Button onClick={close}>Cancel</Button><Button variant="primary" loading={busy} disabled={role === user?.role} onClick={() => user && run(() => patch(`/users/${user.id}/role`, { role }), 'Role updated.')}>Save role</Button></>}
      >
        {error && <div className="mb-3"><Alert tone="critical">{error}</Alert></div>}
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">Role</legend>
          {ROLE_OPTIONS.map((option) => (
            <label key={option.value} className={cx('flex cursor-pointer gap-3 rounded-lg border p-3', role === option.value ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface-hover')}>
              <input type="radio" name="role" className="mt-1 accent-[var(--accent)]" checked={role === option.value} onChange={() => setRole(option.value)} />
              <span>
                <span className="block text-sm font-medium text-ink">{option.label}</span>
                <span className="block text-xs text-ink-2">{option.description}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </Modal>

      <Modal
        open={state?.action === 'status'}
        onClose={close}
        size="sm"
        title={user?.status === 'active' ? 'Deactivate account' : 'Reactivate account'}
        footer={(
          <>
            <Button onClick={close}>Cancel</Button>
            <Button
              variant={user?.status === 'active' ? 'danger' : 'primary'}
              loading={busy}
              onClick={() => user && run(
                () => patch(`/users/${user.id}/status`, { status: user.status === 'active' ? 'deactivated' : 'active', reason }),
                user.status === 'active' ? 'Account deactivated.' : 'Account reactivated.',
              )}
            >
              {user?.status === 'active' ? 'Deactivate' : 'Reactivate'}
            </Button>
          </>
        )}
      >
        {error && <div className="mb-3"><Alert tone="critical">{error}</Alert></div>}
        {user?.status === 'active' ? (
          <div className="flex flex-col gap-3 text-sm text-ink-2">
            <p><strong className="text-ink">{user.fullName}</strong> will be signed out of the mobile app and Admin Panel and cannot sign in until reactivated. Their data is kept.</p>
            <Field label="Reason (optional, kept in the audit log)" htmlFor="deactivate-reason">
              <Textarea id="deactivate-reason" value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} placeholder="e.g. Graduated, duplicate account, policy violation" />
            </Field>
          </div>
        ) : (
          <p className="text-sm text-ink-2"><strong className="text-ink">{user?.fullName}</strong> will be able to sign in again with their existing password.</p>
        )}
      </Modal>

      <Modal
        open={state?.action === 'password'}
        onClose={close}
        size="sm"
        title="Reset password"
        footer={password
          ? <Button variant="primary" onClick={close}>Done</Button>
          : <><Button onClick={close}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => user && run(async () => { const result = await post<{ temporaryPassword: string }>(`/users/${user.id}/reset-password`); setPassword(result.temporaryPassword); }, 'Password reset.', true)}>Generate new password</Button></>}
      >
        {error && <div className="mb-3"><Alert tone="critical">{error}</Alert></div>}
        {password ? (
          <>
            <p className="text-sm text-ink-2">Share this temporary password with <strong className="text-ink">{user?.email}</strong> privately. It will not be shown again.</p>
            <PasswordReveal password={password} />
          </>
        ) : (
          <p className="text-sm text-ink-2">A new temporary password will be generated for <strong className="text-ink">{user?.fullName}</strong>. They will be signed out of all devices.</p>
        )}
      </Modal>

      <ConfirmDialog
        open={state?.action === 'sessions'}
        onClose={close}
        title="Sign out everywhere"
        confirmLabel="Sign out all devices"
        busy={busy}
        onConfirm={() => user && run(() => post(`/users/${user.id}/revoke-sessions`), 'All sessions were signed out.')}
      >
        {error && <div className="mb-3"><Alert tone="critical">{error}</Alert></div>}
        <strong className="text-ink">{user?.fullName}</strong> will be signed out of the HabitAI app on every device{user?.id === currentAdminId ? ' (your current Admin Panel session stays signed in)' : ''}.
      </ConfirmDialog>

      <Modal
        open={state?.action === 'delete'}
        onClose={close}
        size="sm"
        title="Delete account permanently"
        footer={<><Button onClick={close}>Cancel</Button><Button variant="danger" loading={busy} disabled={confirmEmail.trim().toLowerCase() !== user?.email} onClick={() => user && run(() => del(`/users/${user.id}`, { confirmEmail: confirmEmail.trim().toLowerCase() }), 'Account deleted.')}>Delete permanently</Button></>}
      >
        {error && <div className="mb-3"><Alert tone="critical">{error}</Alert></div>}
        <div className="flex flex-col gap-3 text-sm text-ink-2">
          <Alert tone="critical">This removes the account and all of its habits, goals, check-ins, notifications and reports. It cannot be undone. Consider deactivating instead.</Alert>
          <Field label={`Type ${user?.email ?? ''} to confirm`} htmlFor="confirm-email">
            <Input id="confirm-email" value={confirmEmail} onChange={(event) => setConfirmEmail(event.target.value)} autoComplete="off" />
          </Field>
        </div>
      </Modal>
    </>
  );

  return { open, modals };
}

export function UserActionMenu({ user, onAction, onView, currentAdminId }: { user: UserRow; onAction: (action: Action, user: UserRow) => void; onView?: () => void; currentAdminId: string }) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const self = user.id === currentAdminId;
  const open = position !== null;
  const setOpen = (value: boolean) => {
    if (!value || !button.current) return setPosition(null);
    // The menu is portalled with fixed positioning so table scroll containers never clip it.
    const rect = button.current.getBoundingClientRect();
    const height = 300;
    const top = rect.bottom + height > window.innerHeight ? Math.max(8, rect.top - height - 4) : rect.bottom + 4;
    setPosition({ top, left: Math.max(8, rect.right - 208) });
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!ref.current?.contains(target) && !menu.current?.contains(target)) setPosition(null);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setPosition(null); };
    const onMove = () => setPosition(null);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    requestAnimationFrame(() => menu.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus());
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open]);

  const items: { action: Action | 'view'; label: string; icon: ReactNode; danger?: boolean; disabled?: boolean }[] = [
    ...(onView ? [{ action: 'view' as const, label: 'View details', icon: <UserRound className="size-4" /> }] : []),
    { action: 'edit', label: 'Edit details', icon: <Pencil className="size-4" /> },
    { action: 'role', label: 'Change role', icon: <ShieldCheck className="size-4" />, disabled: self },
    { action: 'password', label: 'Reset password', icon: <KeyRound className="size-4" /> },
    { action: 'sessions', label: 'Sign out everywhere', icon: <LogOut className="size-4" /> },
    { action: 'status', label: user.status === 'active' ? 'Deactivate' : 'Reactivate', icon: <Power className="size-4" />, danger: user.status === 'active', disabled: self },
    { action: 'delete', label: 'Delete permanently', icon: <Trash2 className="size-4" />, danger: true, disabled: self },
  ];

  return (
    <div ref={ref} className="relative inline-block text-left" onClick={(event) => event.stopPropagation()}>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${user.fullName}`}
        onClick={() => setOpen(!open)}
        className="inline-flex size-8 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-hover hover:text-ink"
      >
        <EllipsisVertical className="size-4" />
      </button>
      {position && createPortal(
        <div ref={menu} role="menu" style={{ top: position.top, left: position.left }} className="animate-fade-in fixed z-50 w-52 rounded-xl border border-line bg-surface p-1 shadow-pop" onClick={(event) => event.stopPropagation()}>
          {items.map((item) => (
            <button
              key={item.action}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              title={item.disabled ? 'Not available for your own account' : undefined}
              onClick={() => {
                setOpen(false);
                if (item.action === 'view') onView?.();
                else onAction(item.action, user);
              }}
              className={cx('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] disabled:cursor-not-allowed disabled:opacity-40', item.danger ? 'text-critical-ink hover:bg-critical-soft' : 'text-ink hover:bg-surface-hover')}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
