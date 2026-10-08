import { hmacB64Url, safeEqualText } from './crypto.js';
import { parseKeyRing, type Config } from './config.js';

export type PresenceData = { locationId: string; expiresAt: number };

const windowIndex = (now: number, seconds: number) => Math.floor(now / 1000 / seconds);

export function signPresenceToken(config: Config, locationId: string, seconds: number, now = Date.now()): string {
  const [keyId, key] = [...parseKeyRing(config.PRESENCE_KEYS).entries()][0];
  const window = windowIndex(now, seconds);
  const mac = hmacB64Url(key, `v1|${config.EVENT_ID}|${locationId}|${window}`).slice(0, 22);
  return `v1.${keyId}.${locationId}.${window}.${mac}`;
}

export function verifyPresenceToken(config: Config, token: string, seconds: number, now = Date.now()): { locationId: string } | null {
  const [version, keyId, locationId, windowText, mac] = token.split('.');
  if (version !== 'v1' || !keyId || !mac || !/^[a-z0-9_-]{1,16}$/.test(locationId ?? '')) return null;
  const key = parseKeyRing(config.PRESENCE_KEYS).get(keyId); const window = Number(windowText);
  const current = windowIndex(now, seconds);
  if (!key || !Number.isInteger(window) || window > current + 1 || window < current - 1) return null;
  const expected = hmacB64Url(key, `v1|${config.EVENT_ID}|${locationId}|${window}`).slice(0, 22);
  return safeEqualText(mac, expected) ? { locationId } : null;
}
