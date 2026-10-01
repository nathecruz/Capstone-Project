import { useEffect, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import { ApiError, del, post } from '../lib/api';
import { formatRelative } from '../lib/format';
import type { AccessRequest } from '../lib/types';
import { useApi } from '../lib/useApi';
import { STAFF_ROLE_OPTIONS } from './UserActions';
import { Alert, Avatar, Badge, Button, Card, ConfirmDialog, cx, Modal, useToast } from './ui';

/** Fired after a request is approved or rejected, so the sidebar count refreshes. */
const ACCESS_REQUESTS_CHANGED = 'habitai:access-requests-changed';

interface AccessRequestsResponse {
  items: AccessRequest[];
}

/** How many access requests are waiting, for the sidebar badge. Refetches when `refreshKey` changes (navigation). */
export function usePendingAccessRequests(enabled: boolean, refreshKey: string) {
  const { data, reload } = useApi<AccessRequestsResponse>(enabled ? '/access-requests' : null);
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (enabled) reload();
  }, [enabled, refreshKey, reload]);

  useEffect(() => {
    if (!enabled) return;
    window.addEventListener(ACCESS_REQUESTS_CHANGED, reload);
    return () => window.removeEventListener(ACCESS_REQUESTS_CHANGED, reload);
  }, [enabled, reload]);

  return enabled ? data?.items.length ?? 0 : 0;
}

/** Waiting access requests with Approve / Reject; renders nothing when there are none. */
export function AccessRequestsCard({ onApproved }: { onApproved: () => void }) {
  const toast = useToast();
  const { data, error, reload } = useApi<AccessRequestsResponse>('/access-requests');
  const [approving, setApproving] = useState<AccessRequest | null>(null);
  const [rejecting, setRejecting] = useState<AccessRequest | null>(null);
  const [role, setRole] = useState<AccessRequest['requestedRole']>('faculty');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const items = data?.items ?? [];
  if (!items.length && !error) return null;

  function close() {
    setApproving(null);
    setRejecting(null);
  }

  function openApprove(item: AccessRequest) {
    setActionError(null);
    setRole(item.requestedRole);
    setApproving(item);
  }

  function openReject(item: AccessRequest) {
    setActionError(null);
    setRejecting(item);
  }

  async function run(task: () => Promise<unknown>, message: string, approved: boolean) {
    setBusy(true);
    setActionError(null);
    try {
      await task();
      toast(message);
      close();
      reload();
      if (approved) onApproved();
      window.dispatchEvent(new Event(ACCESS_REQUESTS_CHANGED));
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Something went wrong.');
      // Another administrator already handled it.
      if (reason instanceof ApiError && reason.status === 404) reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card
        className="mb-4"
        title={<span className="inline-flex items-center gap-2">Access requests <Badge tone="accent">{items.length}</Badge></span>}
        subtitle="People who asked for Admin Panel access from the sign-in page. They cannot sign in until you approve them."
        bodyClassName="!p-0"
      >
        {error && <div className="px-5 pb-4"><Alert tone="critical">{error}</Alert></div>}
        <ul className="divide-y divide-line border-t border-line">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
              <div className="flex min-w-0 flex-1 basis-64 items-start gap-3">
                <Avatar name={item.fullName} />
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">{item.fullName}</p>
                  <p className="truncate text-xs text-muted">{item.email} · {formatRelative(item.createdAt)}</p>
                  {item.reason && <p className="mt-1 text-[13px] text-ink-2">“{item.reason}”</p>}
                </div>
              </div>
              <Badge tone={item.requestedRole === 'admin' ? 'accent' : 'warning'}>Asked for {item.requestedRoleLabel}</Badge>
              <div className="flex gap-2">
                <Button size="sm" icon={<X className="size-3.5" />} onClick={() => openReject(item)}>Reject</Button>
                <Button size="sm" variant="primary" icon={<Check className="size-3.5" />} onClick={() => openApprove(item)}>Approve</Button>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Modal
        open={Boolean(approving)}
        onClose={close}
        title="Approve access request"
        size="sm"
        description={approving && <>Creates an Admin Panel account for <strong className="text-ink">{approving.fullName}</strong> ({approving.email}). They sign in with the password they chose.</>}
        footer={(
          <>
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={() => approving && run(() => post(`/access-requests/${approving.id}/approve`, { role }), `${approving.fullName} can now sign in.`, true)}>Approve</Button>
          </>
        )}
      >
        {actionError && <div className="mb-3"><Alert tone="critical">{actionError}</Alert></div>}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-[13px] font-medium text-ink">Give this role</legend>
          {STAFF_ROLE_OPTIONS.map((option) => (
            <label key={option.value} className={cx('flex cursor-pointer gap-3 rounded-lg border p-3', role === option.value ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface-hover')}>
              <input type="radio" name="approve-role" className="mt-1 accent-[var(--accent)]" checked={role === option.value} onChange={() => setRole(option.value as AccessRequest['requestedRole'])} />
              <span>
                <span className="block text-sm font-medium text-ink">{option.label}{approving?.requestedRole === option.value && <span className="ml-1.5 text-xs font-normal text-muted">(requested)</span>}</span>
                <span className="block text-xs text-ink-2">{option.description}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </Modal>

      <ConfirmDialog
        open={Boolean(rejecting)}
        title="Reject access request"
        confirmLabel="Reject"
        busy={busy}
        onClose={close}
        onConfirm={() => rejecting && run(() => del(`/access-requests/${rejecting.id}`), 'Request rejected.', false)}
      >
        {actionError && <div className="mb-3"><Alert tone="critical">{actionError}</Alert></div>}
        {rejecting && <><strong className="text-ink">{rejecting.fullName}</strong> ({rejecting.email}) will not get access. They can send a new request later.</>}
      </ConfirmDialog>
    </>
  );
}
