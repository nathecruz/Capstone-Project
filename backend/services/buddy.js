// Habit Buddy: the student's mascot. It grows through stages with every check-in, wears items and
// lives in a room, all bought with tokens. The server owns what was bought and the prices; the app
// shows them.
import { runAll } from '../db/run-all.js';
import { countedCheckIns, spendTokens } from './wallet.js';

export const BUDDY_STAGES = [
  { id: 'baby', name: 'Baby', min: 0 },
  { id: 'kid', name: 'Kid', min: 10 },
  { id: 'teen', name: 'Teen', min: 50 },
  { id: 'champ', name: 'Champ', min: 150 },
  { id: 'legend', name: 'Legend', min: 400 },
];

// A long unlock ladder: something affordable at every stage and new goals to save for. Head and
// hand items are drawn as the emoji; rooms also need a look in ROOM_LOOK (frontend/utils/buddy.ts).
export const BUDDY_ITEMS = [
  // Hats and head toppers.
  { id: 'cap', slot: 'head', name: 'Cap', emoji: '🧢', cost: 40, stage: 'baby' },
  { id: 'sun-hat', slot: 'head', name: 'Sun hat', emoji: '👒', cost: 50, stage: 'baby' },
  { id: 'bow', slot: 'head', name: 'Bow', emoji: '🎀', cost: 60, stage: 'baby' },
  { id: 'flower-crown', slot: 'head', name: 'Flower crown', emoji: '🌸', cost: 90, stage: 'kid' },
  { id: 'party-hat', slot: 'head', name: 'Party hat', emoji: '🎉', cost: 110, stage: 'kid' },
  { id: 'grad-cap', slot: 'head', name: 'Graduation cap', emoji: '🎓', cost: 120, stage: 'kid' },
  { id: 'top-hat', slot: 'head', name: 'Top hat', emoji: '🎩', cost: 150, stage: 'teen' },
  { id: 'star-topper', slot: 'head', name: 'Shining star', emoji: '⭐', cost: 180, stage: 'teen' },
  { id: 'crown', slot: 'head', name: 'Crown', emoji: '👑', cost: 300, stage: 'champ' },
  { id: 'rainbow', slot: 'head', name: 'Rainbow', emoji: '🌈', cost: 360, stage: 'legend' },
  // Things to hold.
  { id: 'cookie', slot: 'hand', name: 'Cookie', emoji: '🍪', cost: 45, stage: 'baby' },
  { id: 'books', slot: 'hand', name: 'Books', emoji: '📚', cost: 50, stage: 'baby' },
  { id: 'coffee', slot: 'hand', name: 'Coffee', emoji: '☕', cost: 55, stage: 'baby' },
  { id: 'plant', slot: 'hand', name: 'Little plant', emoji: '🌱', cost: 70, stage: 'baby' },
  { id: 'teddy', slot: 'hand', name: 'Teddy bear', emoji: '🧸', cost: 85, stage: 'baby' },
  { id: 'ball', slot: 'hand', name: 'Basketball', emoji: '🏀', cost: 90, stage: 'kid' },
  { id: 'headphones', slot: 'hand', name: 'Headphones', emoji: '🎧', cost: 100, stage: 'kid' },
  { id: 'game', slot: 'hand', name: 'Game controller', emoji: '🎮', cost: 120, stage: 'kid' },
  { id: 'guitar', slot: 'hand', name: 'Guitar', emoji: '🎸', cost: 140, stage: 'teen' },
  { id: 'laptop', slot: 'hand', name: 'Laptop', emoji: '💻', cost: 170, stage: 'teen' },
  { id: 'trophy', slot: 'hand', name: 'Trophy', emoji: '🏆', cost: 250, stage: 'champ' },
  { id: 'wand', slot: 'hand', name: 'Magic wand', emoji: '🪄', cost: 280, stage: 'champ' },
  // Rooms (each one also has a look in ROOM_LOOK).
  { id: 'garden', slot: 'room', name: 'Garden', emoji: '🌳', cost: 60, stage: 'baby' },
  { id: 'bedroom', slot: 'room', name: 'Cozy room', emoji: '🛏️', cost: 70, stage: 'baby' },
  { id: 'library', slot: 'room', name: 'Library', emoji: '🏛️', cost: 90, stage: 'kid' },
  { id: 'gym', slot: 'room', name: 'Gym', emoji: '🏋️', cost: 110, stage: 'kid' },
  { id: 'beach', slot: 'room', name: 'Beach', emoji: '🏖️', cost: 120, stage: 'kid' },
  { id: 'cafe', slot: 'room', name: 'Café', emoji: '☕', cost: 140, stage: 'kid' },
  { id: 'mountains', slot: 'room', name: 'Mountains', emoji: '🏔️', cost: 170, stage: 'teen' },
  { id: 'space', slot: 'room', name: 'Space', emoji: '🪐', cost: 200, stage: 'teen' },
  { id: 'city', slot: 'room', name: 'City lights', emoji: '🌆', cost: 230, stage: 'teen' },
  { id: 'underwater', slot: 'room', name: 'Underwater', emoji: '🐠', cost: 280, stage: 'champ' },
  { id: 'castle', slot: 'room', name: 'Castle', emoji: '🏰', cost: 300, stage: 'champ' },
  // Gear: a worn accessory on the body.
  { id: 'scarf', slot: 'accessory', name: 'Scarf', emoji: '🧣', cost: 50, stage: 'baby' },
  { id: 'glasses', slot: 'accessory', name: 'Glasses', emoji: '👓', cost: 70, stage: 'baby' },
  { id: 'necktie', slot: 'accessory', name: 'Necktie', emoji: '👔', cost: 90, stage: 'kid' },
  { id: 'sunglasses', slot: 'accessory', name: 'Sunglasses', emoji: '🕶️', cost: 120, stage: 'kid' },
  { id: 'backpack', slot: 'accessory', name: 'Backpack', emoji: '🎒', cost: 150, stage: 'teen' },
  { id: 'watch', slot: 'accessory', name: 'Watch', emoji: '⌚', cost: 180, stage: 'teen' },
  { id: 'medal', slot: 'accessory', name: 'Gold medal', emoji: '🥇', cost: 260, stage: 'champ' },
];
const SLOTS = ['head', 'hand', 'room', 'accessory'];

// Treats are cheap consumables: feed one to cheer the buddy up. Each feed spends tokens and the
// treat is "discovered" for the collection; the app shows the line the buddy says.
export const BUDDY_TREATS = [
  { id: 'apple', name: 'Apple', emoji: '🍎', cost: 15, line: 'Crunchy and sweet — thank you!' },
  { id: 'carrot', name: 'Carrot', emoji: '🥕', cost: 15, line: 'Yum! Good for my eyes!' },
  { id: 'cheese', name: 'Cheese', emoji: '🧀', cost: 20, line: 'Cheese! My whiskers are happy!' },
  { id: 'cupcake', name: 'Cupcake', emoji: '🧁', cost: 25, line: 'So sweet, just like you!' },
  { id: 'icecream', name: 'Ice cream', emoji: '🍦', cost: 30, line: 'Brain freeze! Totally worth it!' },
  { id: 'sushi', name: 'Sushi', emoji: '🍣', cost: 35, line: 'Fancy! I feel so spoiled!' },
  { id: 'cake', name: 'Birthday cake', emoji: '🎂', cost: 50, line: 'A party in my mouth! You are the best!' },
];

export const DEFAULT_BUDDY_NAME = 'Habi';

/** The stage reached with `checkIns` check-ins (its index in BUDDY_STAGES). */
export function buddyStageIndex(checkIns) {
  return BUDDY_STAGES.reduce((reached, stage, index) => (checkIns >= stage.min ? index : reached), 0);
}

const stageIndexOf = (id) => BUDDY_STAGES.findIndex((stage) => stage.id === id);

/** Name, what it wears, what was bought, the treats fed, and the catalogs. */
export async function getBuddy(db, userId) {
  // One query at a time on a transaction client (buying, feeding), side by side on the pool.
  const [buddy, owned, treats, checkIns] = await runAll(db, [
    () => db.query('SELECT name, head_item AS head, hand_item AS hand, room_item AS room, accessory_item AS accessory FROM user_buddy WHERE user_id=$1', [userId]),
    () => db.query('SELECT item_id AS "itemId" FROM buddy_items WHERE user_id=$1 ORDER BY bought_at', [userId]),
    () => db.query('SELECT treat_id AS "treatId", fed_count AS "count" FROM buddy_treats WHERE user_id=$1', [userId]),
    // Habi grows on the check-ins that count toward points (at most 6 a day from CHECK_IN_CAP_FROM).
    () => countedCheckIns(db, userId),
  ]);
  const row = buddy.rows[0];
  const fedTreats = treats.rows.map((treat) => ({ treatId: treat.treatId, count: Number(treat.count) }));
  return {
    name: row?.name || DEFAULT_BUDDY_NAME,
    head: row?.head || '',
    hand: row?.hand || '',
    room: row?.room || '',
    accessory: row?.accessory || '',
    owned: owned.rows.map((item) => item.itemId),
    checkIns,
    items: BUDDY_ITEMS,
    stages: BUDDY_STAGES,
    treats: BUDDY_TREATS,
    fedTreats,
    treatsFed: fedTreats.reduce((sum, treat) => sum + treat.count, 0),
  };
}

async function saveRow(db, userId, { name, head, hand, room, accessory }, now) {
  await db.query(
    `INSERT INTO user_buddy(user_id,name,head_item,hand_item,room_item,accessory_item,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT(user_id) DO UPDATE SET name=excluded.name, head_item=excluded.head_item, hand_item=excluded.hand_item, room_item=excluded.room_item, accessory_item=excluded.accessory_item, updated_at=excluded.updated_at`,
    [userId, name, head, hand, room, accessory, now],
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
  const spent = await spendTokens(db, userId, item.cost, `Buddy: ${item.name}`, { kind: 'buddy-item', now });
  if (!spent.ok) return { status: 402, message: `You need ${item.cost - spent.balance} more tokens for the ${item.name}.` };
  await db.query('INSERT INTO buddy_items(user_id,item_id,bought_at) VALUES($1,$2,$3)', [userId, item.id, now]);
  // Put it on (or move in) right away.
  const wearing = Object.fromEntries(SLOTS.map((slot) => [slot, item.slot === slot ? item.id : current[slot]]));
  await saveRow(db, userId, { name: current.name, ...wearing }, now);
  return null;
}

/** Renames the buddy and changes what it wears or its room (only items that were bought, in their slot). */
export async function saveBuddy(db, userId, { name, head, hand, room, accessory }, now = Date.now()) {
  const current = await getBuddy(db, userId);
  const wearable = (itemId, slot) => !itemId || (current.owned.includes(itemId) && BUDDY_ITEMS.some((item) => item.id === itemId && item.slot === slot));
  if (!wearable(head, 'head') || !wearable(hand, 'hand') || !wearable(room, 'room') || !wearable(accessory, 'accessory')) return { status: 400, message: 'Buy that item before using it.' };
  await saveRow(db, userId, {
    name: name?.trim() || current.name,
    head: head ?? current.head,
    hand: hand ?? current.hand,
    room: room ?? current.room,
    accessory: accessory ?? current.accessory,
  }, now);
  return null;
}

/**
 * Feeds a treat: spends its tokens and records the feed (discovering it for the collection).
 * Returns { status, message } on refusal, or { line } with what the buddy says. Call inside a
 * transaction that locked the user row.
 */
export async function feedTreat(db, userId, treatId, now = Date.now()) {
  const treat = BUDDY_TREATS.find((entry) => entry.id === treatId);
  if (!treat) return { status: 404, message: 'That treat is not in the shop.' };
  const spent = await spendTokens(db, userId, treat.cost, `Buddy treat: ${treat.name}`, { kind: 'buddy-treat', now });
  if (!spent.ok) return { status: 402, message: `You need ${treat.cost - spent.balance} more tokens for the ${treat.name}.` };
  await db.query(
    `INSERT INTO buddy_treats(user_id,treat_id,fed_count,last_fed_at) VALUES($1,$2,1,$3)
     ON CONFLICT(user_id,treat_id) DO UPDATE SET fed_count=buddy_treats.fed_count+1, last_fed_at=excluded.last_fed_at`,
    [userId, treat.id, now],
  );
  return { line: treat.line };
}
