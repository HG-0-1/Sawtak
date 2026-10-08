import { describe, expect, it } from 'vitest';
import { normalizeJordanianMobile } from '../apps/api/src/phone.js';
import { haversineMeters, ipMatchesCidrs } from '../apps/api/src/access.js';
import { signPresenceToken, verifyPresenceToken } from '../apps/api/src/presence.js';

const config = {
  NODE_ENV: 'test' as const, PORT: 3000, PUBLIC_BASE_URL: 'http://localhost:5173', EVENT_ID: 'mc2026', DATABASE_URL: 'postgresql://unused',
  SESSION_SIGNING_KEYS: 'dev:ZGV2LXNlc3Npb24ta2V5LWNvbnRlbnQtbXVzdC1iZS0zMi1ieXRlcw',
  PRESENCE_KEYS: 'dev:ZGV2LXByZXNlbmNlLWtleS1jb250ZW50LW11c3QtYmUtMzItYnl0ZXM',
  PII_KEYS: 'dev:ZGV2LXBpaS1rZXktY29udGVudC1tdXN0LWJlLTMyLWJ5dGVzLWxlbg', PHONE_PEPPER: 'x'.repeat(32), OTP_PEPPER: 'x'.repeat(32), IP_HASH_KEY: 'x'.repeat(32), TRUSTED_PROXY_CIDRS: '',
  SMS_PROVIDER: 'mock' as const, STORAGE_DRIVER: 'local' as const, DEV_ACCESS_OVERRIDE: '0' as const, LOAD_TEST_MODE: '0' as const, DEMO_ADMIN_USERNAME: 'admin', DEMO_ADMIN_PASSWORD: 'ChangeMe!2026', secureCookies: false
};

describe('phone normalization', () => {
  it('accepts common Jordan mobile representations', () => {
    expect(normalizeJordanianMobile('079 123 4567')).toBe('+962791234567');
    expect(normalizeJordanianMobile('+962791234567')).toBe('+962791234567');
    expect(normalizeJordanianMobile('061234567')).toBeNull();
  });
});

describe('geofence primitives', () => {
  it('returns zero at the same point and approximately one km for nearby points', () => {
    expect(haversineMeters(31.9539,35.9106,31.9539,35.9106)).toBe(0);
    expect(haversineMeters(31.9539,35.9106,31.9629,35.9106)).toBeGreaterThan(900);
  });
});

describe('IP allowlist', () => {
  it('uses CIDR ranges and does not accept a neighboring range', () => {
    expect(ipMatchesCidrs('10.32.4.9', ['10.32.0.0/16'])).toBe(true);
    expect(ipMatchesCidrs('10.33.4.9', ['10.32.0.0/16'])).toBe(false);
  });
});

describe('rotating presence token', () => {
  it('accepts a current token but rejects a tampered token', () => {
    const now = 1_700_000_000_000;
    const token = signPresenceToken(config, 'entrance', 60, now);
    expect(verifyPresenceToken(config, token, 60, now)).toEqual({ locationId: 'entrance' });
    expect(verifyPresenceToken(config, `${token}x`, 60, now)).toBeNull();
  });
});
