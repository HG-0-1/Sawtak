import { z } from 'zod';

export const roles = ['SUPER_ADMIN', 'ADMIN', 'VIEWER'] as const;
export const accessModes = ['STRICT', 'STANDARD', 'QR_ONLY', 'OFF'] as const;
export const votingModes = ['AUTO', 'FORCE_OPEN', 'FORCE_CLOSED', 'PAUSED'] as const;

export const geoSchema = z.object({
  lat: z.number().gte(-90).lte(90),
  lng: z.number().gte(-180).lte(180),
  accuracyM: z.number().positive().max(10_000)
});

export const otpRequestSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(8).max(24),
  consent: z.literal(true),
  geo: geoSchema.optional()
});

export const voteSchema = z.object({
  categoryId: z.string().uuid(),
  exhibitorId: z.string().uuid(),
  geo: geoSchema.optional()
});

export const errorCodes = [
  'PRESENCE_REQUIRED', 'OUTSIDE_VENUE', 'LOCATION_NEEDED', 'OTP_INVALID', 'OTP_EXPIRED',
  'OTP_LOCKED', 'OTP_THROTTLED', 'VOTING_NOT_OPEN', 'ALREADY_VOTED', 'EXHIBITOR_NOT_IN_CATEGORY',
  'UNAUTHENTICATED', 'FORBIDDEN', 'INVALID_DISPLAY_TOKEN', 'INVALID_PRESENCE_TOKEN', 'VALIDATION_ERROR'
] as const;
export type ErrorCode = typeof errorCodes[number];

export type PublicCategory = {
  id: string; slug: string; nameEn: string; nameAr: string | null; descriptionEn: string | null;
  descriptionAr: string | null; sortOrder: number; exhibitors: PublicExhibitor[];
};
export type PublicExhibitor = {
  id: string; name: string; nameAr: string | null; description: string | null; descriptionAr: string | null;
  boothLabel: string | null; imageUrl: string | null;
};
