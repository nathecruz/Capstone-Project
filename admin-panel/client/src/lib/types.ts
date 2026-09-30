export type Role = 'user' | 'faculty' | 'admin';
export type Permission =
  | 'dashboard:view'
  | 'analytics:view'
  | 'users:view'
  | 'users:manage'
  | 'categories:view'
  | 'categories:manage'
  | 'notifications:view'
  | 'notifications:manage'
  | 'support:view'
  | 'support:manage'
  | 'audit:view'
  | 'settings:manage';

export interface Admin {
  id: string;
  fullName: string;
  username: string;
  email: string;
  role: Role;
  roleLabel: string;
  permissions: Permission[];
}

export interface UserRow {
  id: string;
  /** "First Last" */
  fullName: string;
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  role: Role;
  roleLabel: string;
  status: 'active' | 'deactivated';
  statusReason: string;
  statusChangedAt: number | null;
  createdAt: number;
  lastActiveAt: number | null;
  habitCount: number;
  completionCount: number;
  gender: string;
  region: string;
  dateOfBirth: string;
}

export interface Category {
  id: string;
  label: string;
  icon: string;
  color: string;
  description: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
  habitCount: number;
  studentCount: number;
  completions30d: number;
}

export interface Template {
  id: string;
  name: string;
  type: 'system' | 'reminder';
  title: string;
  body: string;
  description: string;
  isActive: boolean;
  isSystem: boolean;
  createdAt: number;
  updatedAt: number;
  timesSent: number;
  lastSentAt: number | null;
}

export interface TemplateVariable {
  key: string;
  description: string;
  sample: string;
}

export type Audience =
  | { kind: 'all' }
  | { kind: 'active' }
  | { kind: 'inactive' }
  | { kind: 'no_habits' }
  | { kind: 'users'; userIds: string[] };
