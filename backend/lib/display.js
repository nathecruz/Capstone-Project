import { splitFullName } from './names.js';

/**
 * "Juan" + "Dela Cruz" -> "Juan D." — leaderboards never show other students' full names.
 * With a single argument it is treated as a full name (older accounts).
 */
export function leaderboardName(firstName, lastName) {
  const names = lastName === undefined ? splitFullName(firstName) : { firstName: String(firstName || '').trim(), lastName: String(lastName || '').trim() };
  if (!names.firstName && !names.lastName) return 'Student';
  if (!names.lastName) return names.firstName;
  return `${names.firstName || names.lastName} ${names.lastName[0].toUpperCase()}.`;
}
