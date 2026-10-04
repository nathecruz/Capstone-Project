// Habit Buddy: the student's mascot. It grows through stages with every check-in, wears items and
// lives in a room, all bought with tokens. The server owns what was bought and the prices; the app
// shows them.
import { spendTokens } from './wallet.js';

export const BUDDY_STAGES = [
  { id: 'baby', name: 'Baby', min: 0 },
  { id: 'kid', name: 'Kid', min: 10 },
  { id: 'teen', name: 'Teen', min: 50 },
  { id: 'champ', name: 'Champ', min: 150 },
  { id: 'legend', name: 'Legend', min: 400 },
];

export const BUDDY_ITEMS = [
  { id: 'cap', slot: 'head', name: 'Cap', emoji: '🧢', cost: 40, stage: 'baby' },
  { id: 'bow', slot: 'head', name: 'Bow', emoji: '🎀', cost: 60, stage: 'baby' },
  { id: 'grad-cap', slot: 'head', name: 'Graduation cap', emoji: '🎓', cost: 120, stage: 'kid' },
  { id: 'top-hat', slot: 'head', name: 'Top hat', emoji: '🎩', cost: 150, stage: 'teen' },
  { id: 'crown', slot: 'head', name: 'Crown', emoji: '👑', cost: 300, stage: 'champ' },
  { id: 'books', slot: 'hand', name: 'Books', emoji: '📚', cost: 50, stage: 'baby' },
  { id: 'plant', slot: 'hand', name: 'Little plant', emoji: '🌱', cost: 70, stage: 'baby' },
  { id: 'ball', slot: 'hand', name: 'Basketball', emoji: '🏀', cost: 90, stage: 'kid' },
  { id: 'headphones', slot: 'hand', name: 'Headphones', emoji: '🎧', cost: 100, stage: 'kid' },
  { id: 'trophy', slot: 'hand', name: 'Trophy', emoji: '🏆', cost: 250, stage: 'champ' },
  { id: 'garden', slot: 'room', name: 'Garden', emoji: '🌳', cost: 60, stage: 'baby' },
  { id: 'library', slot: 'room', name: 'Library', emoji: '🏛️', cost: 90, stage: 'kid' },
  { id: 'beach', slot: 'room', name: 'Beach', emoji: '🏖️', cost: 120, stage: 'kid' },
  { id: 'space', slot: 'room', name: 'Space', emoji: '🪐', cost: 200, stage: 'teen' },
  { id: 'castle', slot: 'room', name: 'Castle', emoji: '🏰', cost: 300, stage: 'champ' },
];
const SLOTS = ['head', 'hand', 'room'];

export const DEFAULT_BUDDY_NAME = 'Habi';

/** The stage reached with `checkIns` check-ins (its index in BUDDY_STAGES). */
export function buddyStageIndex(checkIns) {
  return BUDDY_STAGES.reduce((reached, stage, index) => (checkIns >= stage.min ? index : reached), 0);
}

const stageIndexOf = (id) => BUDDY_STAGES.findIndex((stage) => stage.id === id);

async function checkInCount(db, userId) {
  return (await db.query('SELECT COUNT(*)::int AS count FROM habit_completions WHERE user_id=$1', [userId])).rows[0].count;
}

/** Name, what it wears, what was bought, and the catalog. */
export async function getBuddy(db, userId) {
  const [buddy, owned, checkIns] = await Promise.all([
    db.query('SELECT name, head_item AS head, hand_item AS hand, room_item AS room FROM user_buddy WHERE user_id=$1', [userId]),
    db.query('SELECT item_id AS "itemId" FROM buddy_items WHERE user_id=$1 ORDER BY bought_at', [userId]),
    checkInCount(db, userId),
  ]);
  const row = buddy.rows[0];
  return {
    name: row?.name || DEFAULT_BUDDY_NAME,
    head: row?.head || '',
    hand: row?.hand || '',
    room: row?.room || '',
    owned: owned.rows.map((item) => item.itemId),
    checkIns,
    items: BUDDY_ITEMS,
    stages: BUDDY_STAGES,
  };
}

async function saveRow(db, userId, { name, head, hand, room }, now) {
  await db.query(
    `INSERT INTO user_buddy(user_id,name,head_item,hand_item,room_item,updated_at) VALUES($1,$2,$3,$4,$5,$6)
     ON CONFLICT(user_id) DO UPDATE SET name=excluded.name, head_item=excluded.head_item, hand_item=excluded.hand_item, room_item=excluded.room_item, updated_at=excluded.updated_at`,
    [userId, name, head, hand, room, now],
  );
}

/**
 * Buys an item with tokens and puts it on. Returns { status, message } on refusal. Call inside a
 * transaction that locked the user row.
 */
export async function buyBuddyItem(db, userId, itemId, now = Date.now()) {
  const item = BUDDY_ITEMS.find((entry) => entry.id === itemId);
  if (!item) return { status: 404, message: 'That item is not in the shop.' };
  const current = await getBuddy(db, userId);
  if (current.owned.includes(item.id)) return { status: 409, message: 'You already have this item.' };
  if (buddyStageIndex(current.checkIns) < stageIndexOf(item.stage)) {
    const stage = BUDDY_STAGES[stageIndexOf(item.stage)];
    return { status: 403, message: `${current.name} needs to reach the ${stage.name} stage (${stage.min} check-ins) first.` };
  }
  const spent = await spendTokens(db, userId, item.cost, `Buddy: ${item.name}`, now);
  if (!spent.ok) return { status: 402, message: `You need ${item.cost - spent.balance} more tokens for the ${item.name}.` };
  await db.query('INSERT INTO buddy_items(user_id,item_id,bought_at) VALUES($1,$2,$3)', [userId, item.id, now]);
  // Put it on (or move in) right away.
  const wearing = Object.fromEntries(SLOTS.map((slot) => [slot, item.slot === slot ? item.id : current[slot]]));
  await saveRow(db, userId, { name: current.name, ...wearing }, now);
  return null;
}

/** Renames the buddy and changes what it wears or its room (only items that were bought, in their slot). */
export async function saveBuddy(db, userId, { name, head, hand, room }, now = Date.now()) {
  const current = await getBuddy(db, userId);
  const wearable = (itemId, slot) => !itemId || (current.owned.includes(itemId) && BUDDY_ITEMS.some((item) => item.id === itemId && item.slot === slot));
  if (!wearable(head, 'head') || !wearable(hand, 'hand') || !wearable(room, 'room')) return { status: 400, message: 'Buy that item before using it.' };
  await saveRow(db, userId, { name: name?.trim() || current.name, head: head ?? current.head, hand: hand ?? current.hand, room: room ?? current.room }, now);
  return null;
}
