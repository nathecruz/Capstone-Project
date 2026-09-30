export const TEMPLATE_VARIABLES = [
  { key: 'first_name', description: "Recipient's first name", sample: 'Juan' },
  { key: 'full_name', description: "Recipient's full name", sample: 'Juan Dela Cruz' },
  { key: 'username', description: "Recipient's username", sample: 'juandc' },
  { key: 'habit_count', description: 'Number of habits the recipient tracks', sample: '4' },
  { key: 'best_streak', description: "Recipient's best current streak (days)", sample: '6' },
  { key: 'app_name', description: 'Application name', sample: 'HabitAI' },
  { key: 'habit', description: 'Habit name (automatic habit reminder only)', sample: 'Drink Water' },
];

const PLACEHOLDER = /\{\{\s*([a-z_]+)\s*\}\}/gi;

export function renderTemplate(text, variables) {
  return String(text).replace(PLACEHOLDER, (match, key) => {
    const value = variables[key.toLowerCase()];
    return value === undefined || value === null ? match : String(value);
  });
}

export function unknownPlaceholders(text) {
  const known = new Set(TEMPLATE_VARIABLES.map((variable) => variable.key));
  const found = [...String(text).matchAll(PLACEHOLDER)].map((match) => match[1].toLowerCase());
  return [...new Set(found.filter((key) => !known.has(key)))];
}

export function recipientVariables(recipient, appName) {
  const fullName = String(recipient.fullName || '').trim();
  const firstName = String(recipient.firstName || '').trim() || fullName.split(/\s+/)[0];
  return {
    first_name: firstName || recipient.username || 'there',
    full_name: fullName || recipient.username || 'there',
    username: recipient.username || '',
    habit_count: Number(recipient.habitCount) || 0,
    best_streak: Number(recipient.bestStreak) || 0,
    app_name: appName,
  };
}

export function sampleVariables(appName) {
  return Object.fromEntries(TEMPLATE_VARIABLES.map((variable) => [variable.key, variable.key === 'app_name' ? appName : variable.sample]));
}
