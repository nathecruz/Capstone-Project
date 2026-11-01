// Habits are about Health and Academics (the capstone panel's scope): a new habit is filed under
// one of them on the server, whatever app version saved it.
import assert from 'node:assert/strict';
import test from 'node:test';
import { focusCategories, focusCategory, focusCategoryFor, withHabitRules } from '../services/habit-rules.js';

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
  const focused = { id: 'health', label: 'Walk', category: 'Health', activeUntil: '2026-11-08' };
  const state = { habits: [stored, ended, fresh, focused] };
  const saved = withHabitRules(state, { habits: [stored] }, today);
  assert.deepEqual(saved.habits.map((habit) => habit.category), ['Mind', 'Lifestyle', 'Academics', 'Health']);
  assert.equal(withHabitRules({ habits: [stored, focused] }, { habits: [stored] }, today).habits[0], stored, 'nothing to change keeps the objects');
  assert.equal(withHabitRules({ habits: [focused] }, null, today).habits[0], focused);
  assert.equal(withHabitRules({ profile: {} }, null, today).habits, undefined);
});
