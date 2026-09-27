const MIN_PASSWORD_LENGTH = 8;
const COMMON_PASSWORD_WORDS = [
  'password', 'passw0rd', 'pass123', 'password123', 'admin', 'administrator', 'qwerty', 'welcome',
  'letmein', 'login', 'monkey', 'dragon', 'football', 'abc123', 'sunshine', 'iloveyou',
  'happy', 'lovely', 'secret', 'superman', 'batman', 'master', 'shadow', 'princess',
  'password1', 'passphrase', '012345', '123456', '123456789', '12345678', '123123', '111111',
];

const SERVICE_WORDS = ['habitai', 'habit', 'habits', 'tracker', 'goals', 'progress', 'app', 'account'];

function normalizePasswordSeed(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function getPasswordStrengthStatus(
  password: string,
  context: { fullName?: string; email?: string; username?: string; serviceWords?: string[]; existingPasswords?: string[] } = {},
) {
  const pass = password.trim();

  if (!pass) {
    return {
      strength: 'empty' as const,
      label: 'No password entered',
      color: '#ADB5BD',
      description: 'Add a password to begin.',
      score: 0,
    };
  }

  const validation = validatePasswordStrength(password, context);
  const hasLowercase = /[a-z]/.test(pass);
  const hasUppercase = /[A-Z]/.test(pass);
  const hasNumber = /\d/.test(pass);
  const hasSymbol = /[^A-Za-z0-9\s]/.test(pass);
  const lengthBonus = pass.length >= 16 ? 2 : pass.length >= MIN_PASSWORD_LENGTH ? 1 : 0;
  const varietyBonus = [hasLowercase, hasUppercase, hasNumber, hasSymbol].filter(Boolean).length;
  const score = Math.min(lengthBonus + varietyBonus, 4);

  if (!validation.ok) {
    return {
      strength: validation.strength,
      label: validation.strength === 'medium' ? 'Moderate password' : 'Weak password',
      color: validation.strength === 'medium' ? '#F4A524' : '#E95D5D',
      description: validation.message || 'Avoid common or predictable choices.',
      score,
    };
  }

  return {
    strength: 'strong' as const,
    label: 'Strong password',
    color: '#2FA76E',
    description: 'Excellent choice. This is hard to guess.',
    score,
  };
}

export function validatePasswordStrength(
  password: string,
  context: { fullName?: string; email?: string; username?: string; serviceWords?: string[]; existingPasswords?: string[] } = {},
) {
  const pass = password.trim();

  if (!pass) {
    return { ok: false, strength: 'weak' as const, message: 'Password is required.' };
  }

  if (pass.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, strength: 'weak' as const, message: 'Password must be at least 8 characters long.' };
  }

  const lower = pass.toLowerCase();
  const hasLowercase = /[a-z]/.test(pass);
  const hasUppercase = /[A-Z]/.test(pass);
  const hasNumber = /\d/.test(pass);
  const hasSymbol = /[^A-Za-z0-9\s]/.test(pass);
  const characterClasses = [hasLowercase, hasUppercase, hasNumber, hasSymbol].filter(Boolean).length;
  const words = lower.split(/[^a-z0-9]+/).filter(Boolean);
  const maybeBirthday = /(?:0?[1-9]|1[0-2])(?:[/-]?)(?:0?[1-9]|[12]\d|3[01])(?:[/-]?)(?:19\d{2}|20\d{2}|\d{2})/.test(pass)
    || /(?:19\d{2}|20\d{2})/.test(pass);

  const allSeeds = [
    ...(context.fullName ? [context.fullName] : []),
    ...(context.username ? [context.username] : []),
    ...(context.email ? [context.email.split('@')[0], context.email] : []),
    ...(context.serviceWords ?? []),
    ...SERVICE_WORDS,
  ];

  const bannedSeeds = Array.from(new Set(
    allSeeds
      .map(normalizePasswordSeed)
      .filter((seed) => seed.length >= 3),
  ));

  const weakWordMatch = [...COMMON_PASSWORD_WORDS, ...bannedSeeds].some((seed) => {
    const normalizedSeed = normalizePasswordSeed(seed);
    if (!normalizedSeed || normalizedSeed.length < 3) {
      return false;
    }

    return lower.includes(normalizedSeed);
  });

  if (weakWordMatch) {
    return {
      ok: false,
      strength: 'weak' as const,
      message: 'Choose a stronger password that avoids common words, personal details, dates, and app-specific terms.',
    };
  }

  if (maybeBirthday) {
    return {
      ok: false,
      strength: 'weak' as const,
      message: 'Avoid birthdays, dates, or other personal details in your password.',
    };
  }

  if (characterClasses < 4) {
    return {
      ok: false,
      strength: 'medium' as const,
      message: 'Use at least 8 characters with uppercase letters, lowercase letters, numbers, and symbols.',
    };
  }

  if (words.length >= 2 && words.length < 4) {
    return {
      ok: false,
      strength: 'medium' as const,
      message: 'Passphrases must contain at least four unrelated words.',
    };
  }

  if ((context.existingPasswords ?? []).some((existingPassword) => existingPassword === password)) {
    return {
      ok: false,
      strength: 'weak' as const,
      message: 'Choose a password that is not used by another account or tier.',
    };
  }

  if (/(.)\1{2,}/.test(pass) || /(?:123|456|789)/.test(pass.toLowerCase()) && pass.length <= 24) {
    return {
      ok: false,
      strength: 'weak' as const,
      message: 'Avoid repeated or predictable patterns such as repeated characters or common numeric sequences.',
    };
  }

  return { ok: true, strength: 'strong' as const };
}
