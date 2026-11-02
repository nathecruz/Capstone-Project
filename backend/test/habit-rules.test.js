// Habits are about Health and Academics (the capstone panel's scope): a new habit is filed under
// one of them on the server, whatever app version saved it.
import assert from 'node:assert/strict';
import test from 'node:test';
import { focusCategories, focusCategory, focusCategoryFor, habitProof, suggestedProof, withHabitRules } from '../services/habit-rules.js';

test('a habit belongs to Health or Academics, by its own category or its name', () => {
  assert.equal(focusCategory(' academics '), 'Academics');
  assert.equal(focusCategory('Mind'), null);
  assert.equal(focusCategoryFor({ label: 'Anything', category: 'health' }), 'Health');
  assert.equal(focusCategoryFor({ label: 'Review notes', category: 'Productivity' }), 'Academics');
  assert.equal(focusCategoryFor({ name: 'Grade papers for 30 minutes' }), 'Academics');
  assert.equal(focusCategoryFor({ label: 'Meditate', category: 'Mind' }), 'Health');
  assert.equal(focusCategoryFor({ label: 'Bread and butter' }), 'Health');
  assert.deepEqual(focusCategories(['Mind', 'academics']), ['Academics']);
  assert.deepEqual(focusCategories(['Mind']), ['Health', 'Academics']);
  assert.deepEqual(focusCategories(undefined), ['Health', 'Academics']);
});

test('a new habit is filed under its area; stored ones and ended ones keep their category', () => {
  const today = '2026-11-02';
  const stored = { id: 'old', label: 'Journal', category: 'Mind', activeUntil: '2026-11-08' };
  const ended = { id: 'ended', label: 'Save money', category: 'Lifestyle', activeUntil: '2026-11-01' };
  const fresh = { id: 'new', label: 'Read a chapter', category: 'Mind', activeUntil: '2026-11-08' };
  const focused = { id: 'health', label: 'Walk', category: 'Health', activeUntil: '2026-11-08', proof: { type: 'steps', steps: 2000 } };
  const saved = withHabitRules({ habits: [stored, ended, fresh, focused] }, { habits: [stored] }, today);
  assert.deepEqual(saved.habits.map((habit) => habit.category), ['Mind', 'Lifestyle', 'Academics', 'Health']);
  assert.equal(saved.habits[0], stored, 'a stored habit from before proofs stays as it was');
  assert.equal(saved.habits[1], ended);
  const unchanged = { habits: [stored, focused] };
  assert.equal(withHabitRules(unchanged, { habits: [stored] }, today), unchanged, 'nothing to change keeps the state');
  assert.equal(withHabitRules({ profile: {} }, null, today).habits, undefined);
});

test('every new habit gets a proof, and a habit with a proof keeps one', () => {
  const today = '2026-11-02';
  const habit = (id, label, proof) => ({ id, label, category: 'Health', activeUntil: '2026-11-08', ...(proof === undefined ? {} : { proof }) });
  // New habits: the proof sent, within the limits, else the one the name suggests.
  const added = withHabitRules({ habits: [
    habit('a', 'Walk 3,000 steps'),
    habit('b', 'Study 1 hour'),
    habit('c', 'Drink water', { type: 'timer', minutes: 2 }),
    habit('d', 'Stretch', { type: 'nothing' }),
    habit('e', 'Eat vegetables'),
  ] }, null, today);
  assert.deepEqual(added.habits.map((item) => item.proof), [
    { type: 'steps', steps: 3000 }, { type: 'timer', minutes: 60 }, { type: 'timer', minutes: 5 }, { type: 'timer', minutes: 20 }, { type: 'photo' },
  ]);
  // Stored: a missing or broken proof does not remove it; a valid one replaces it.
  const stored = habit('s', 'Read', { type: 'timer', minutes: 20 });
  const sent = (proof) => withHabitRules({ habits: [habit('s', 'Read', proof)] }, { habits: [stored] }, today).habits[0].proof;
  assert.deepEqual(sent(undefined), { type: 'timer', minutes: 20 });
  assert.deepEqual(sent(null), { type: 'timer', minutes: 20 });
  assert.deepEqual(sent({ type: 'none' }), { type: 'timer', minutes: 20 });
  assert.deepEqual(sent({ type: 'photo' }), { type: 'photo' });
  assert.deepEqual(sent({ type: 'steps', steps: 999999 }), { type: 'steps', steps: 30000 });
  // An ended habit is history: nothing is added to it.
  const old = { id: 'x', label: 'Walk', category: 'Mind', activeUntil: '2026-10-25' };
  assert.equal(withHabitRules({ habits: [old] }, null, today).habits[0], old);
});

test('the proof a name suggests', () => {
  assert.deepEqual(suggestedProof('Walk 5k steps'), { type: 'steps', steps: 5000 });
  assert.deepEqual(suggestedProof('Evening walk'), { type: 'steps', steps: 2000 });
  assert.deepEqual(suggestedProof('Read for 15 minutes'), { type: 'timer', minutes: 15 });
  assert.deepEqual(suggestedProof('Meditate'), { type: 'timer', minutes: 20 });
  assert.deepEqual(suggestedProof('Drink 8 glasses of water'), { type: 'photo' });
  assert.equal(habitProof({ proof: { type: 'timer', minutes: 'soon' } }), null);
  assert.equal(habitProof({}), null);
});
