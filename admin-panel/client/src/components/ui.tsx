import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CircleCheck, Info, LoaderCircle, X } from 'lucide-react';
import { initials } from '../lib/format';

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

// Buttons ------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-hover border border-transparent',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-surface-hover',
  ghost: 'bg-transparent text-ink-2 border border-transparent hover:bg-surface-hover hover:text-ink',
  danger: 'bg-critical text-white border border-transparent hover:brightness-110',
};

export function Button({ variant = 'secondary', size = 'md', loading = false, icon, children, className, disabled, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  loading?: boolean;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap',
        size === 'sm' ? 'h-8 px-2.5 text-[13px]' : 'h-9 px-3.5 text-sm',
        BUTTON_STYLES[variant],
        className,
      )}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export function IconButton({ label, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={cx('inline-flex size-8 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40', className)}
    >
      {children}
    </button>
  );
}

// Layout primitives ----------------------------------------------------------------

export function Card({ title, subtitle, actions, children, className, bodyClassName }: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cx('rounded-xl border border-line bg-surface shadow-card', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-5 pt-4">
          <div className="min-w-0 flex-1 basis-48">
            {title && <h2 className="text-[15px] font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx('px-5 pb-5', title || actions ? 'pt-3' : 'pt-5', bodyClassName)}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

type Tone = 'neutral' | 'accent' | 'good' | 'warning' | 'critical';
const BADGE_STYLES: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-ink-2 border-line',
  accent: 'bg-accent-soft text-accent-ink border-transparent',
  good: 'bg-good-soft text-good-ink border-transparent',
  warning: 'bg-warning-soft text-warning-ink border-transparent',
  critical: 'bg-critical-soft text-critical-ink border-transparent',
};

export function Badge({ tone = 'neutral', children, icon }: { tone?: Tone; children: ReactNode; icon?: ReactNode }) {
  return (
    <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium', BADGE_STYLES[tone])}>
      {icon}
      {children}
    </span>
  );
}

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-accent-soft font-semibold text-accent-ink"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials(name)}
    </span>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-muted">
      <LoaderCircle className="size-5 animate-spin" aria-hidden />
      {label}…
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      {icon && <div className="mb-3 text-muted">{icon}</div>}
      <p className="text-sm font-medium text-ink">{title}</p>
      {children && <div className="mt-1 max-w-sm text-[13px] text-muted">{children}</div>}
    </div>
  );
}

export function Alert({ tone = 'neutral', children, title }: { tone?: 'neutral' | 'warning' | 'critical' | 'good'; title?: string; children: ReactNode }) {
  const Icon = tone === 'critical' || tone === 'warning' ? AlertTriangle : tone === 'good' ? CircleCheck : Info;
  const styles = {
    neutral: 'bg-surface-2 border-line text-ink-2',
    warning: 'bg-warning-soft border-transparent text-ink',
    critical: 'bg-critical-soft border-transparent text-ink',
    good: 'bg-good-soft border-transparent text-ink',
  }[tone];
  const iconColor = { neutral: 'text-muted', warning: 'text-warning-ink', critical: 'text-critical-ink', good: 'text-good-ink' }[tone];
  return (
    <div role={tone === 'critical' ? 'alert' : undefined} className={cx('flex gap-2.5 rounded-lg border px-3.5 py-3 text-[13px]', styles)}>
      <Icon className={cx('mt-0.5 size-4 shrink-0', iconColor)} aria-hidden />
      <div className="min-w-0">
        {title && <p className="font-semibold text-ink">{title}</p>}
        <div>{children}</div>
      </div>
    </div>
  );
}

// Form controls ------------------------------------------------------------------------

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink">{label}</label>
      {children}
      {error ? <p className="text-xs text-critical-ink">{error}</p> : hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

const CONTROL = 'rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-2 focus:outline-offset-0 focus:outline-accent/25 disabled:opacity-60';

// Controls fill their container unless the caller sets an explicit width class.
const controlWidth = (className?: string) => (/(^|\s)(w-|min-w-|flex-1)/.test(className ?? '') ? '' : 'w-full');

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cx(CONTROL, controlWidth(className), 'h-9', className)} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cx(CONTROL, controlWidth(className), 'h-9 pr-8', className)}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cx(CONTROL, 'w-full min-h-20 py-2', className)} />;
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50',
        checked ? 'bg-accent' : 'bg-line-strong',
      )}
    >
      <span className={cx('inline-block size-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-4.5' : 'translate-x-0.5')} />
    </button>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange, label }: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line-strong bg-surface p-0.5">
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cx(
            'h-7 rounded-md px-3 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-accent',
            value === option.value ? 'bg-accent-soft text-accent-ink' : 'text-ink-2 hover:text-ink',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, tabs, onChange }: { value: T; tabs: { value: T; label: string; count?: number }[]; onChange: (value: T) => void }) {
  return (
    <div role="tablist" className="mb-5 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          onClick={() => onChange(tab.value)}
          className={cx(
            '-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
            value === tab.value ? 'border-accent text-ink' : 'border-transparent text-ink-2 hover:text-ink',
          )}
        >
          {tab.label}
          {tab.count !== undefined && <span className="rounded-full bg-surface-2 px-1.5 text-xs text-ink-2 tabular">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3 text-[13px] text-ink-2">
      <span className="tabular">{from}–{to} of {total}</span>
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <span className="tabular">Page {page} of {pages}</span>
        <Button size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}

// Modal -------------------------------------------------------------------------------

export function Modal({ open, onClose, title, description, children, footer, size = 'md' }: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Depends on `open` only, so parent re-renders (typing) never steal focus.
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
      if (event.key === 'Tab' && panel.current) {
        const focusable = panel.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])');
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => {
      const target = panel.current?.querySelector<HTMLElement>('[data-autofocus], input:not([disabled]), select, textarea, button:not([data-close])');
      target?.focus();
    });
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  const width = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl' }[size];
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} className={cx('animate-fade-in flex max-h-[92vh] w-full flex-col rounded-t-2xl border border-line bg-surface shadow-pop sm:rounded-2xl', width)}>
        <div className="flex items-start justify-between gap-4 px-5 pt-5">
          <div>
            <h2 id={titleId} className="text-base font-semibold text-ink">{title}</h2>
            {description && <div className="mt-1 text-[13px] text-ink-2">{description}</div>}
          </div>
          <IconButton label="Close" data-close onClick={onClose}><X className="size-4" /></IconButton>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({ open, title, children, confirmLabel = 'Confirm', tone = 'danger', busy, onConfirm, onClose, disabled }: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  tone?: 'danger' | 'primary';
  busy?: boolean;
  disabled?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={(
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={tone} loading={busy} disabled={disabled} onClick={onConfirm}>{confirmLabel}</Button>
        </>
      )}
    >
      <div className="text-sm text-ink-2">{children}</div>
    </Modal>
  );
}

// Toasts ------------------------------------------------------------------------------

type ToastItem = { id: number; tone: 'good' | 'critical' | 'neutral'; message: string };
const ToastContext = createContext<(message: string, tone?: ToastItem['tone']) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);
  const push = useCallback((message: string, tone: ToastItem['tone'] = 'good') => {
    const id = ++counter.current;
    setItems((current) => [...current.slice(-3), { id, tone, message }]);
    setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), tone === 'critical' ? 7000 : 4000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      {createPortal(
        <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:items-end sm:px-6">
          {items.map((item) => (
            <div key={item.id} className="animate-fade-in pointer-events-auto flex max-w-sm items-start gap-2.5 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink shadow-pop">
              {item.tone === 'good' ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-good-ink" aria-hidden /> : item.tone === 'critical' ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-critical-ink" aria-hidden /> : <Info className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />}
              <span>{item.message}</span>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

// Tables ------------------------------------------------------------------------------

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('overflow-x-auto', className)}>
      <table className="w-full border-collapse text-left text-[13px]">{children}</table>
    </div>
  );
}

export function Th({ children, className, align = 'left' }: { children?: ReactNode; className?: string; align?: 'left' | 'right' | 'center' }) {
  return <th scope="col" className={cx('whitespace-nowrap border-b border-line px-3 py-2.5 font-medium text-muted first:pl-5 last:pr-5', align === 'right' && 'text-right', align === 'center' && 'text-center', className)}>{children}</th>;
}

export function Td({ children, className, align = 'left' }: { children?: ReactNode; className?: string; align?: 'left' | 'right' | 'center' }) {
  return <td className={cx('border-b border-line px-3 py-2.5 align-middle text-ink first:pl-5 last:pr-5', align === 'right' && 'text-right tabular', align === 'center' && 'text-center', className)}>{children}</td>;
}
