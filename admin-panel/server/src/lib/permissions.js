// Roles stored in users.role. Only "admin" and "faculty" may sign in to the admin panel.
export const ROLES = ['user', 'faculty', 'admin'];
export const STAFF_ROLES = ['faculty', 'admin'];

export const ROLE_LABELS = {
  user: 'Student',
  faculty: 'PSAU Faculty',
  admin: 'System Administrator',
};

// Faculty get aggregated, anonymized views only; administrators manage the system.
export const ROLE_PERMISSIONS = {
  admin: [
    'dashboard:view',
    'class:view',
    'analytics:view',
    'users:view',
    'users:manage',
    'categories:view',
    'categories:manage',
    'notifications:view',
    'notifications:manage',
    'support:view',
    'support:manage',
    'audit:view',
    'settings:manage',
  ],
  faculty: ['dashboard:view', 'class:view', 'analytics:view', 'categories:view', 'notifications:view'],
  user: [],
};

export function permissionsFor(role) {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function hasPermission(role, permission) {
  return permissionsFor(role).includes(permission);
}
