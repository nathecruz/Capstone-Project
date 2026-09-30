// First and last names, with the same rules as the app backend (backend/lib/names.js).
// Accounts store both (users.first_name, users.last_name) and keep users.full_name as
// "First Last" for search, emails and older readers.

// Words that belong to the surname when they come before it: "Juan Dela Cruz" -> "Dela Cruz".
const SURNAME_PARTICLES = new Set(['de', 'del', 'dela', 'delos', 'los', 'las', 'la', 'san', 'santa', 'sta', 'sta.', 'sto', 'sto.', 'santo', 'van', 'von', 'da', 'di', 'du', 'le', 'y']);
const SUFFIXES = new Set(['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv', 'v']);

/**
 * Best-effort split of a single full name, for accounts created before first and last names
 * were separate (and for old app versions that still send `fullName`).
 * "Maria Clara de los Santos" -> { firstName: "Maria Clara", lastName: "de los Santos" }.
 */
export function splitFullName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] || '', lastName: '' };
  let start = parts.length - 1;
  if (SUFFIXES.has(parts[start].toLowerCase()) && start > 1) start -= 1;
  while (start > 1 && SURNAME_PARTICLES.has(parts[start - 1].toLowerCase())) start -= 1;
  return { firstName: parts.slice(0, start).join(' '), lastName: parts.slice(start).join(' ') };
}

export function joinName(firstName, lastName) {
  return [firstName, lastName].map((part) => String(part || '').trim().replace(/\s+/g, ' ')).filter(Boolean).join(' ');
}

/** The names a request carries: first/last from current apps, or a legacy `fullName`. */
export function namesFromInput(input) {
  const firstName = String(input?.firstName || '').trim().replace(/\s+/g, ' ');
  const lastName = String(input?.lastName || '').trim().replace(/\s+/g, ' ');
  if (firstName || lastName) return { firstName, lastName, fullName: joinName(firstName, lastName) };
  const split = splitFullName(input?.fullName);
  return { ...split, fullName: joinName(split.firstName, split.lastName) };
}

/** Names of a stored account; rows saved before the split fall back to splitting full_name. */
export function namesFromRow(row) {
  if (row?.firstName || row?.lastName) return { firstName: row.firstName || '', lastName: row.lastName || '', fullName: joinName(row.firstName, row.lastName) };
  const split = splitFullName(row?.fullName);
  return { ...split, fullName: row?.fullName || '' };
}
