import { useEffect, useSyncExternalStore } from 'react';
import { getRewards, saveRewardFrame, saveRewardTitle, subscribeToAuthChanges, type ServerReward } from '@/authentication';

// The token rewards a student owns (Premium Themes, Custom Title, Profile Frames), their title and frame, shared by the
// Leaderboards, Profile and Settings screens. Loaded from the server; cleared when the account changes.
type RewardsState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  rewards: ServerReward[];
  owned: string[];
  title: string;
  frame: string;
};

const EMPTY: RewardsState = { status: 'idle', rewards: [], owned: [], title: '', frame: '' };
let state = EMPTY;
const listeners = new Set<() => void>();

function update(changes: Partial<RewardsState>) {
  state = { ...state, ...changes };
  listeners.forEach((listener) => listener());
}

subscribeToAuthChanges(() => update(EMPTY));

export async function loadRewards() {
  if (state.status === 'loading') return;
  update({ status: 'loading' });
  const result = await getRewards();
  if (result.ok) update({ status: 'ready', rewards: result.rewards, owned: result.owned, title: result.title, frame: result.frame ?? '' });
  else update({ status: 'error' });
}

/** Marks a reward as owned right after it was redeemed. */
export function markRewardOwned(rewardId: string) {
  if (!state.owned.includes(rewardId)) update({ owned: [...state.owned, rewardId] });
}

export async function saveFrame(frame: string) {
  const result = await saveRewardFrame(frame);
  if (result.ok) update({ frame: result.frame });
  return result;
}

export async function saveTitle(title: string) {
  const result = await saveRewardTitle(title);
  if (result.ok) update({ title: result.title });
  return result;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useRewards() {
  const snapshot = useSyncExternalStore(subscribe, () => state, () => state);
  useEffect(() => {
    // Loads once per account; after an error, screens retry with loadRewards.
    if (state.status === 'idle') void loadRewards();
  }, [snapshot.status]);
  return { ...snapshot, owns: (rewardId: string) => snapshot.owned.includes(rewardId) };
}
