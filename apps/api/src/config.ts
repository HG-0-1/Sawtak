import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: new URL('../../../.env', import.meta.url) });

const encodedKey = z.string().min(16);
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:5173'),
  EVENT_ID: z.string().regex(/^[a-z0-9_-]+$/i).default('mc2026'),
  DATABASE_URL: z.string().url(),
  SESSION_SIGNING_KEYS: encodedKey,
  PRESENCE_KEYS: encodedKey,
  PII_KEYS: encodedKey,
  PHONE_PEPPER: encodedKey,
  OTP_PEPPER: encodedKey,
  IP_HASH_KEY: encodedKey,
  TRUSTED_PROXY_CIDRS: z.string().default(''),
  SMS_PROVIDER: z.enum(['mock', 'http']).default('mock'),
  SMS_HTTP_URL: z.string().url().optional().or(z.literal('')),
  SMS_HTTP_AUTH_HEADER: z.string().optional(),
  SMS_SENDER_ID: z.string().max(32).optional(),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  DEV_ACCESS_OVERRIDE: z.enum(['0', '1']).default('0'),
  LOAD_TEST_MODE: z.enum(['0', '1']).default('0'),
  DEMO_OTP_CODE: z.string().regex(/^\d{6}$/).optional(),
  DEMO_ADMIN_USERNAME: z.string().default('admin'),
  DEMO_ADMIN_PASSWORD: z.string().min(12).default('ChangeMe!2026')
});

export type Config = z.infer<typeof schema> & { secureCookies: boolean };

export function loadConfig(): Config {
  const config = schema.parse(process.env);
  if (config.NODE_ENV === 'production') {
    const forbidden = [
      config.SMS_PROVIDER === 'mock' && 'SMS_PROVIDER=mock',
      config.STORAGE_DRIVER === 'local' && 'STORAGE_DRIVER=local',
      config.DEV_ACCESS_OVERRIDE === '1' && 'DEV_ACCESS_OVERRIDE=1',
      config.LOAD_TEST_MODE === '1' && 'LOAD_TEST_MODE=1',
      Boolean(config.DEMO_OTP_CODE) && 'DEMO_OTP_CODE'
    ].filter(Boolean);
    if (forbidden.length) throw new Error(`Unsafe production configuration: ${forbidden.join(', ')}`);
    if (config.SMS_PROVIDER === 'http' && !config.SMS_HTTP_URL) throw new Error('Production requires SMS_HTTP_URL when SMS_PROVIDER=http');
  }
  return { ...config, secureCookies: config.NODE_ENV === 'production' };
}

export function parseKeyRing(value: string): Map<string, Buffer> {
  const ring = new Map<string, Buffer>();
  for (const entry of value.split(',')) {
    const [keyId, data] = entry.trim().split(':', 2);
    if (!keyId || !data) throw new Error('Key ring must use kid:base64 entries');
    ring.set(keyId, Buffer.from(data, 'base64'));
  }
  return ring;
}
