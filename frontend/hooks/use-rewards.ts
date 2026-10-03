import { useEffect, useSyncExternalStore } from 'react';
import { getRewards, saveRewardTitle, subscribeToAuthChanges, type ServerReward } from '@/authentication';

// The token rewards a student owns (Premium Themes, Custom Title) and their title, shared by the
// Leaderboards, Profile and Settings screens. Loaded from the server; cleared when the account changes.
type RewardsState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  rewards: ServerReward[];
  owned: string[];
  title: string;
};

const EMPTY: RewardsState = { status: 'idle', rewards: [], owned: [], title: '' };
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
  if (result.ok) update({ status: 'ready', rewards: result.rewards, owned: result.owned, title: result.title });
  else update({ status: 'error' });
}

/** Marks a reward as owned right after it was redeemed. */
export function markRewardOwned(rewardId: string) {
  if (!state.owned.includes(rewardId)) update({ owned: [...state.owned, rewardId] });
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
