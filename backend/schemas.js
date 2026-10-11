import { z } from 'zod';

export const emailSchema = z.string().trim().email().max(254);
export const passwordSchema = z.string().min(8).max(128);
export const registerSchema = z.object({ firstName: z.string().trim().min(1).max(60).optional(), lastName: z.string().trim().min(1).max(60).optional(), fullName: z.string().trim().min(2).max(100).optional(), username: z.string().trim().min(2).max(30).regex(/^[a-zA-Z0-9_.-]+$/), email: emailSchema, password: passwordSchema, dateOfBirth: z.string().trim().min(1).max(40), gender: z.string().trim().min(1).max(40), region: z.string().trim().max(80).default(''), device: z.string().trim().max(160).optional(), privacyConsent: z.boolean().optional() }).strict();
export const profileSchema = z.object({ firstName: z.string().trim().min(1).max(60).optional(), lastName: z.string().trim().min(1).max(60).optional(), fullName: z.string().trim().min(2).max(100).optional(), username: z.string().trim().min(2).max(30).regex(/^[a-zA-Z0-9_.-]+$/), email: emailSchema, dateOfBirth: z.string().trim().max(40), gender: z.string().trim().max(40), about: z.string().trim().max(500), currentPassword: z.string().min(1).max(128).optional() }).strict();
export const profileUpdateSchema = profileSchema;
export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(128), device: z.string().trim().max(160).optional() }).strict();
export const forgotPasswordSchema = z.object({ email: emailSchema }).strict();
export const verifyOtpSchema = z.object({ email: emailSchema, otp: z.string().regex(/^\d{6}$/) }).strict();
export const otpSchema = verifyOtpSchema;
export const resetPasswordSchema = verifyOtpSchema.extend({ newPassword: passwordSchema }).strict();
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema }).strict();
export const accountDeletionSchema = z.object({ currentPassword: z.string().min(1).max(128) }).strict();

export const stateDataSchema = z.object({ avatarImage: z.string().nullable(), profile: z.record(z.string(), z.unknown()), preferences: z.record(z.string(), z.unknown()), habits: z.array(z.record(z.string(), z.unknown())), points: z.number().int().min(0).max(100000000), tokens: z.number().int().min(0).max(100000000), tokenHistory: z.array(z.record(z.string(), z.unknown())), darkModeOverride: z.boolean().nullable(), ringInterval: z.number().int().min(1).max(1440), snoozeFrequency: z.string().max(80), goals: z.array(z.record(z.string(), z.unknown())).optional() }).strict();
export const stateSchema = stateDataSchema.extend({ clientUpdatedAt: z.number().int().positive().optional(), baseUpdatedAt: z.number().int().positive().nullable().optional(), baseState: stateDataSchema.nullable().optional() }).strict();
export const appStateDataSchema = stateDataSchema;
export const appStateSchema = stateSchema;

export const habitPredictionSchema = z.object({ habit_name: z.string().trim().min(1).max(120).optional(), name: z.string().trim().min(1).max(120).optional(), streak: z.coerce.number().int().min(0).max(10000).optional(), completion_rate: z.coerce.number().finite().min(0).max(1).optional(), missed_days: z.coerce.number().int().min(0).max(10000).optional(), last_7_days: z.array(z.coerce.number().int().min(0).max(1)).length(7).optional(), average_session_minutes: z.coerce.number().int().min(0).max(1440).optional(), priority: z.string().trim().min(1).max(30).optional(), goal_type: z.string().trim().min(1).max(50).optional() }).strict();
export const leaderboardSchema = z.object({ avatar: z.string().trim().max(2).optional() }).strict();
export const leaderboardSyncSchema = leaderboardSchema;
export const habitCompletionSchema = z.object({ habitId: z.string().trim().min(1).max(120), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), completed: z.boolean(), timeZone: z.string().trim().min(1).max(80).optional() }).strict();
const timeZoneSchema = z.string().trim().min(1).max(80).refine((value) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, 'Unknown time zone.');
// `summary` is accepted for older app builds; the server now builds AI context from the database.
export const buddyItemSchema = z.object({ itemId: z.string().trim().min(1).max(40) }).strict();
export const buddySaveSchema = z.object({ name: z.string().trim().min(1).max(20).optional(), head: z.string().max(40).optional(), hand: z.string().max(40).optional(), room: z.string().max(40).optional() }).strict();
export const dayInputSchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), timeZone: timeZoneSchema.optional() }).strict();
export const rewardFrameSchema = z.object({ frame: z.string().max(20) }).strict();
export const mysteryBoxSchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), timeZone: timeZoneSchema.optional() }).strict();
export const streakFreezeSchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), timeZone: timeZoneSchema.optional() }).strict();
export const webPushDoneSchema = z.object({ token: z.string().min(20).max(1000) }).strict();
export const assistantSchema = z.object({ question: z.string().trim().max(500).optional(), summary: z.record(z.string(), z.unknown()).optional(), mode: z.enum(['assistant', 'coach', 'support']).default('assistant'), timeZone: timeZoneSchema.optional() }).strict();
export const habitAnalysisRequestSchema = z.object({ habitId: z.string().trim().min(1).max(120), timeZone: timeZoneSchema.optional() }).strict();
export const habitClassificationSchema = z.object({ name: z.string().trim().min(1).max(100), category: z.string().trim().max(60).optional(), categories: z.array(z.string().trim().min(1).max(60)).max(20).optional() }).strict();
export const goalGenerationSchema = z.object({ goal: z.string().trim().min(1).max(500), focusTarget: z.string().trim().max(30).optional(), timeline: z.string().trim().max(30).optional(), timeZone: timeZoneSchema.optional() }).strict();
export const goalPlanSchema = z.object({ category: z.enum(['Career', 'Health', 'Finance', 'Education', 'Relationships', 'Personal Growth']), summary: z.string().min(1).max(1000), intensity: z.enum(['High focus', 'Balanced', 'Quick win']), focusAreas: z.array(z.string().trim().min(1).max(120)).length(3), actionPlan: z.array(z.string().trim().min(1).max(70)).length(4), actionDueDates: z.array(z.string().trim().min(1).max(40)).length(4), nextMilestone: z.string().min(1).max(500), risk: z.string().min(1).max(500), riskAction: z.string().min(1).max(500), timeline: z.enum(['7-14 days', '30-60 days', '90 days']), nextCheckIn: z.string().trim().min(1).max(40), status: z.literal('Fresh plan') });
export const issueSchema = z.object({ topic: z.string().trim().min(1).max(100), timing: z.string().trim().min(1).max(50), description: z.string().trim().min(1).max(500) }).strict();
export const issueReportSchema = issueSchema;
export const suggestionSchema = z.object({ suggestion: z.string().trim().min(3).max(500) }).strict();
export const rewardTitleSchema = z.object({ title: z.string().max(60) }).strict();
export const rewardRedemptionSchema = z.object({ rewardId: z.string().trim().min(1).max(80), rewardName: z.string().trim().min(1).max(120), tokenCost: z.number().int().positive().max(100000) }).strict();
export const notificationReadSchema = z.object({ read: z.boolean() }).strict();
export const webPushSubscriptionSchema = z.object({
	endpoint: z.string().url().max(2048).refine((value) => value.startsWith('https://')),
	expirationTime: z.number().positive().nullable().optional(),
	keys: z.object({ p256dh: z.string().min(1).max(512), auth: z.string().min(1).max(512) }).strict(),
}).strict();
export const webPushSubscriptionRequestSchema = z.object({
	subscription: webPushSubscriptionSchema,
	timeZone: z.string().trim().min(1).max(80),
}).strict();
export const webPushUnsubscribeSchema = z.object({ endpoint: z.string().url().max(2048).refine((value) => value.startsWith('https://')) }).strict();
export const webPushSnoozeRequestSchema = z.object({ token: z.string().min(32).max(128) }).strict();
export const webPushTestSchema = z.object({ endpoint: z.string().url().max(2048).refine((value) => value.startsWith('https://')).optional() }).strict();
