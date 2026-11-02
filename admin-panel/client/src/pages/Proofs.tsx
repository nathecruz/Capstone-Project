import { useEffect, useState } from 'react';
import { Camera, Footprints, Image as ImageIcon, Search, ShieldCheck, Timer } from 'lucide-react';
import { Alert, Badge, Button, Card, cx, EmptyState, Input, Modal, PageHeader, Pagination, Select, Spinner, Table, Td, Th } from '../components/ui';
import { formatDate, formatDateTime, formatNumber } from '../lib/format';
import { useApi } from '../lib/useApi';

// The proof of each proven check-in (the app's backend/services/check-in-proof.js): a Focus timer
// that ran its minutes, a walk of so many steps, or a photo. Photos are kept for a few weeks; opening
// one is in the audit log.
interface Proof {
  userId: string;
  habitId: string;
  date: string;
  kind: 'timer' | 'steps' | 'photo';
  minutes: number | null;
  steps: number | null;
  createdAt: number;
  hasPhoto: boolean;
  name: string;
  username: string;
  role: 'user' | 'faculty' | 'admin';
  habit: string;
  category: string | null;
}

const KINDS = [
  ['all', 'All proofs'],
  ['timer', 'Focus timer'],
  ['steps', 'Steps'],
  ['photo', 'Photo'],
];

function proofDetail(proof: Proof) {
  if (proof.kind === 'timer') return `Focus timer, ${formatNumber(proof.minutes)} min`;
  if (proof.kind === 'steps') return `${formatNumber(proof.steps)} steps in ${formatNumber(proof.minutes)} min`;
  return proof.hasPhoto ? 'Photo' : 'Photo (no longer kept)';
}

const KIND_ICON = { timer: Timer, steps: Footprints, photo: Camera };

export function ProofsPage() {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [kind, setKind] = useState('all');
  const [page, setPage] = useState(1);
  const [viewing, setViewing] = useState<Proof | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => { setDebounced(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const params = new URLSearchParams({ search: debounced, kind, page: String(page) });
  const { data, error, loading } = useApi<{ items: Proof[]; total: number; page: number; pageSize: number }>(`/proofs?${params}`);
  const photoUrl = (proof: Proof) => `/api/proofs/photo?${new URLSearchParams({ userId: proof.userId, habitId: proof.habitId, date: proof.date })}`;

  return (
    <>
      <PageHeader
        title="Check-in proofs"
        description="How each check-in was proven: a Focus timer that ran its full time, a walk counted by the phone, or a photo. Photos are kept for a few weeks, then deleted; opening one is recorded in the audit log."
      />
      <Card bodyClassName="!p-0">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input aria-label="Search proofs" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name, username or habit" className="pl-9" />
          </div>
          <Select aria-label="Kind of proof" value={kind} onChange={(event) => { setKind(event.target.value); setPage(1); }} className="w-auto">
            {KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </div>
        {error && <div className="p-5"><Alert tone="critical">{error}</Alert></div>}
        {!data ? (loading && <Spinner />) : data.items.length === 0 ? (
          <EmptyState icon={<ShieldCheck className="size-8" />} title="No proofs yet">Proven check-ins appear here.</EmptyState>
        ) : (
          <div className={cx(loading && 'opacity-60')}>
            <Table>
              <thead><tr><Th>Day</Th><Th>Person</Th><Th>Habit</Th><Th>Proof</Th><Th>Checked in</Th><Th><span className="sr-only">Photo</span></Th></tr></thead>
              <tbody>
                {data.items.map((proof) => {
                  const Icon = KIND_ICON[proof.kind];
                  return (
                    <tr key={`${proof.userId}:${proof.habitId}:${proof.date}`}>
                      <Td className="whitespace-nowrap text-ink-2">{formatDate(`${proof.date}T00:00:00`)}</Td>
                      <Td>
                        <p className="font-medium text-ink">{proof.name}</p>
                        <p className="text-xs text-muted">@{proof.username}{proof.role === 'faculty' ? ' · Faculty' : ''}</p>
                      </Td>
                      <Td>
                        <p className="text-ink">{proof.habit}</p>
                        {proof.category && <p className="text-xs text-muted">{proof.category}</p>}
                      </Td>
                      <Td><Badge tone={proof.kind === 'photo' ? 'accent' : 'good'} icon={<Icon className="size-3.5" />}>{proofDetail(proof)}</Badge></Td>
                      <Td className="whitespace-nowrap text-ink-2">{formatDateTime(proof.createdAt)}</Td>
                      <Td align="right">
                        {proof.hasPhoto && <Button size="sm" icon={<ImageIcon className="size-4" />} onClick={() => setViewing(proof)}>View photo</Button>}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </div>
        )}
      </Card>
      <Modal open={Boolean(viewing)} onClose={() => setViewing(null)} title={viewing ? `${viewing.habit}` : 'Photo'} description={viewing ? `${viewing.name} · ${formatDate(`${viewing.date}T00:00:00`)}` : undefined}>
        {viewing && <img src={photoUrl(viewing)} alt={`Check-in photo of ${viewing.habit} by ${viewing.name}`} className="mx-auto max-h-[60vh] rounded-lg" />}
      </Modal>
    </>
  );
}
