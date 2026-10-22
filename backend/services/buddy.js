// Habit Buddy: the student's mascot. It grows through stages with every check-in, wears items and
// lives in a room, all bought with tokens. The server owns what was bought and the prices; the app
// shows them.
import { runAll } from '../db/run-all.js';
import { weekEndKey } from './habit-week.js';
import { getWeeklyQuests, weekNumber, weekStartOf } from './quests.js';
import { countedCheckIns, countedDaySql, spendTokens } from './wallet.js';

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
  { id: 'dragon', slot: 'hand', name: 'Dragon', emoji: '🐉', cost: 420, stage: 'legend' },
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
  { id: 'aurora', slot: 'room', name: 'Aurora', emoji: '🌌', cost: 500, stage: 'legend' },
  // Gear: a worn accessory on the body.
  { id: 'scarf', slot: 'accessory', name: 'Scarf', emoji: '🧣', cost: 50, stage: 'baby' },
  { id: 'glasses', slot: 'accessory', name: 'Glasses', emoji: '👓', cost: 70, stage: 'baby' },
  { id: 'necktie', slot: 'accessory', name: 'Necktie', emoji: '👔', cost: 90, stage: 'kid' },
  { id: 'sunglasses', slot: 'accessory', name: 'Sunglasses', emoji: '🕶️', cost: 120, stage: 'kid' },
  { id: 'backpack', slot: 'accessory', name: 'Backpack', emoji: '🎒', cost: 150, stage: 'teen' },
  { id: 'watch', slot: 'accessory', name: 'Watch', emoji: '⌚', cost: 180, stage: 'teen' },
  { id: 'medal', slot: 'accessory', name: 'Gold medal', emoji: '🥇', cost: 260, stage: 'champ' },
  { id: 'diamond', slot: 'accessory', name: 'Diamond', emoji: '💎', cost: 450, stage: 'legend' },
];
const SLOTS = ['head', 'hand', 'room', 'accessory'];

// The Weekly Drop: one limited item each Monday-to-Sunday week of the account day, on sale only that
// week and only after 2 of the week's 3 weekly quests are done. They take turns, so each one comes
// back every 12 weeks. Worn like shop items; the app draws them the same way.
export const DROP_COST = 150;
export const DROP_QUESTS_NEEDED = 2;
export const BUDDY_DROPS = [
  { id: 'drop-umbrella', slot: 'hand', name: 'Umbrella', emoji: '☔' },
  { id: 'drop-rice', slot: 'hand', name: 'Rice stalk', emoji: '🌾' },
  { id: 'drop-carabao', slot: 'hand', name: 'Carabao', emoji: '🐃' },
  { id: 'drop-mango', slot: 'hand', name: 'Mango', emoji: '🥭' },
  { id: 'drop-salabat', slot: 'hand', name: 'Salabat tea', emoji: '🍵' },
  { id: 'drop-lantern', slot: 'hand', name: 'Lantern', emoji: '🏮' },
  { id: 'drop-sunflower', slot: 'head', name: 'Sunflower', emoji: '🌻' },
  { id: 'drop-parol', slot: 'head', name: 'Parol star', emoji: '🌟' },
  { id: 'drop-fireworks', slot: 'head', name: 'Fireworks', emoji: '🎆' },
  { id: 'drop-mini-tree', slot: 'hand', name: 'Mini tree', emoji: '🎄' },
  { id: 'drop-sports-medal', slot: 'accessory', name: 'Sports medal', emoji: '🏅' },
  { id: 'drop-ribbon', slot: 'accessory', name: 'Ribbon', emoji: '🎗️' },
].map((item) => ({ ...item, cost: DROP_COST, stage: 'kid', drop: true }));
const WEARABLES = [...BUDDY_ITEMS, ...BUDDY_DROPS];

const dropIndex = (weekStart) => ((weekNumber(weekStart) % BUDDY_DROPS.length) + BUDDY_DROPS.length) % BUDDY_DROPS.length;

/** The drop on sale in the week starting `weekStart`. */
export function dropForWeek(weekStart) {
  return BUDDY_DROPS[dropIndex(weekStart)];
}

/** Weeks until `drop` is on sale again, from the week starting `weekStart` (0: it is that week's drop). */
export function weeksUntilDrop(drop, weekStart) {
  return (BUDDY_DROPS.indexOf(drop) - dropIndex(weekStart) + BUDDY_DROPS.length) % BUDDY_DROPS.length;
}

export const isBuddyDrop = (itemId) => BUDDY_DROPS.some((item) => item.id === itemId);

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

/** The weekly quests done toward unlocking the drop of `today`'s week (recomputed from the check-ins). */
async function dropQuestsDone(db, userId, today) {
  return (await getWeeklyQuests(db, userId, today)).filter((quest) => quest.complete).length;
}

/**
 * Name, what it wears, what was bought, the treats fed, and the catalogs. With the account day
 * `today`, also this week's drop: { item, weekStart, weekEnd, questsDone, questsNeeded, unlocked,
 * owned } (else null). The routes add the treats classmates sent (services/buddy-gifts.js).
 */
export async function getBuddy(db, userId, { today = null } = {}) {
  // One query at a time on a transaction client (buying, feeding), side by side on the pool.
  const [buddy, owned, treats, checkIns, questsDone] = await runAll(db, [
    () => db.query('SELECT name, head_item AS head, hand_item AS hand, room_item AS room, accessory_item AS accessory FROM user_buddy WHERE user_id=$1', [userId]),
    () => db.query('SELECT item_id AS "itemId" FROM buddy_items WHERE user_id=$1 ORDER BY bought_at', [userId]),
    () => db.query('SELECT treat_id AS "treatId", fed_count AS "count" FROM buddy_treats WHERE user_id=$1', [userId]),
    // Habi grows on the check-ins that count toward points (at most 6 a day from CHECK_IN_CAP_FROM).
    () => countedCheckIns(db, userId),
    () => (today ? dropQuestsDone(db, userId, today) : null),
  ]);
  const row = buddy.rows[0];
  const fedTreats = treats.rows.map((treat) => ({ treatId: treat.treatId, count: Number(treat.count) }));
  const ownedIds = owned.rows.map((item) => item.itemId);
  const weekStart = today ? weekStartOf(today) : null;
  const drop = today ? dropForWeek(weekStart) : null;
  return {
    name: row?.name || DEFAULT_BUDDY_NAME,
    head: row?.head || '',
    hand: row?.hand || '',
    room: row?.room || '',
    accessory: row?.accessory || '',
    owned: ownedIds,
    checkIns,
    items: BUDDY_ITEMS,
    stages: BUDDY_STAGES,
    treats: BUDDY_TREATS,
    fedTreats,
    treatsFed: fedTreats.reduce((sum, treat) => sum + treat.count, 0),
    drop: drop ? {
      item: drop,
      weekStart,
      weekEnd: weekEndKey(weekStart),
      questsDone,
      questsNeeded: DROP_QUESTS_NEEDED,
      unlocked: questsDone >= DROP_QUESTS_NEEDED,
      owned: ownedIds.includes(drop.id),
    } : null,
    drops: BUDDY_DROPS,
    dropsOwned: ownedIds.filter(isBuddyDrop).length,
  };
}

/**
 * A Habi as classmates see it with the Buddy Showcase: its stage (with that stage's least check-ins,
 * not the student's own count) and what it wears. An item is kept only if it is in the shop or the
 * drops, fits its slot and was bought; anything else is ''.
 */
export function showcaseLook({ checkIns, head, hand, accessory, room, owned }) {
  const stage = BUDDY_STAGES[buddyStageIndex(Number(checkIns) || 0)];
  const kept = (itemId, slot) => (itemId && owned.includes(itemId) && WEARABLES.some((item) => item.id === itemId && item.slot === slot) ? itemId : '');
  return { stage: stage.id, checkIns: stage.min, head: kept(head, 'head'), hand: kept(hand, 'hand'), accessory: kept(accessory, 'accessory'), room: kept(room, 'room') };
}

/**
 * The showcased Habi (showcaseLook) of each student in `userIds`, by user id, in one grouped query:
 * lifetime counted check-ins (as getBuddy counts them), what it wears and what was bought.
 */
export async function showcaseBuddies(db, userIds) {
  if (!userIds.length) return new Map();
  const result = await db.query(
    `WITH days AS (
       SELECT user_id, completed_date AS d, COUNT(*)::int AS n FROM habit_completions
        WHERE user_id = ANY($1::text[]) GROUP BY user_id, completed_date
     ), counted AS (
       SELECT user_id, SUM(${countedDaySql('d', 'n')})::int AS checkins FROM days GROUP BY user_id
     )
     SELECT ids.id AS "userId", COALESCE(c.checkins, 0) AS "checkIns", b.head_item AS head, b.hand_item AS hand,
            b.accessory_item AS accessory, b.room_item AS room, ARRAY(SELECT item_id FROM buddy_items i WHERE i.user_id = ids.id) AS owned
       FROM unnest($1::text[]) AS ids(id)
       LEFT JOIN counted c ON c.user_id = ids.id
       LEFT JOIN user_buddy b ON b.user_id = ids.id`,
    [userIds],
  );
  return new Map(result.rows.map((row) => [row.userId, showcaseLook(row)]));
}

async function saveRow(db, userId, { name, head, hand, room, accessory }, now) {
  await db.query(
    `INSERT INTO user_buddy(user_id,name,head_item,hand_item,room_item,accessory_item,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT(user_id) DO UPDATE SET name=excluded.name, head_item=excluded.head_item, hand_item=excluded.hand_item, room_item=excluded.room_item, accessory_item=excluded.accessory_item, updated_at=excluded.updated_at`,
    [userId, name, head, hand, room, accessory, now],
  );
}

/**
 * Buys an item with tokens and puts it on. Returns { status, message, code? } on refusal. A weekly
 * drop needs `today`, the account day (services/account-day.js): it is sold only in its own week,
 * once, from the Kid stage and after 2 of that week's 3 quests. Call inside a transaction that
 * locked the user row.
 */
export async function buyBuddyItem(db, userId, itemId, { today = null, now = Date.now() } = {}) {
  const item = WEARABLES.find((entry) => entry.id === itemId);
  if (!item) return { status: 404, message: 'That item is not in the shop.' };
  if (item.drop) {
    if (!today) return { status: 400, message: 'Send your today and time zone.' };
    const weeks = weeksUntilDrop(item, weekStartOf(today));
    if (weeks) return { status: 410, code: 'DROP_GONE', message: `This drop is gone for now. It comes back in ${weeks} week${weeks === 1 ? '' : 's'}.` };
  }
  const current = await getBuddy(db, userId);
  if (current.owned.includes(item.id)) return { status: 409, message: 'You already have this item.' };
  if (buddyStageIndex(current.checkIns) < stageIndexOf(item.stage)) {
    const stage = BUDDY_STAGES[stageIndexOf(item.stage)];
    return { status: 403, message: `${current.name} needs to reach the ${stage.name} stage (${stage.min} check-ins) first.` };
  }
  if (item.drop && (await dropQuestsDone(db, userId, today)) < DROP_QUESTS_NEEDED) {
    return { status: 403, code: 'DROP_LOCKED', message: `Finish ${DROP_QUESTS_NEEDED} of this week's 3 quests to unlock the ${item.name}.` };
  }
  const spent = await spendTokens(db, userId, item.cost, item.drop ? `Buddy: ${item.name} (weekly drop)` : `Buddy: ${item.name}`, { kind: 'buddy-item', now });
  if (!spent.ok) return { status: 402, message: `You need ${item.cost - spent.balance} more tokens for the ${item.name}.` };
  await db.query('INSERT INTO buddy_items(user_id,item_id,bought_at) VALUES($1,$2,$3)', [userId, item.id, now]);
  // Put it on (or move in) right away.
  const wearing = Object.fromEntries(SLOTS.map((slot) => [slot, item.slot === slot ? item.id : current[slot]]));
  await saveRow(db, userId, { name: current.name, ...wearing }, now);
  return null;
}

/** Renames the buddy and changes what it wears or its room (only items that were bought, drops too, in their slot). */
export async function saveBuddy(db, userId, { name, head, hand, room, accessory }, now = Date.now()) {
  const current = await getBuddy(db, userId);
  const wearable = (itemId, slot) => !itemId || (current.owned.includes(itemId) && WEARABLES.some((item) => item.id === itemId && item.slot === slot));
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
