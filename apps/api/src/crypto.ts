import crypto from 'node:crypto';
import type { Config } from './config.js';
import { parseKeyRing } from './config.js';

const b64url = (input: Buffer) => input.toString('base64url');
const fromB64url = (input: string) => Buffer.from(input, 'base64url');

export function randomToken(bytes = 32) { return b64url(crypto.randomBytes(bytes)); }
export function sha256(value: string | Buffer) { return crypto.createHash('sha256').update(value).digest(); }
export function keyedHash(key: string, value: string) { return crypto.createHmac('sha256', Buffer.from(key, 'base64')).update(value).digest(); }
export function hmacB64Url(key: Buffer, value: string) { return crypto.createHmac('sha256', key).update(value).digest('base64url'); }
export function safeEqualText(left: string, right: string) {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function encryptPii(config: Config, plaintext: string): Buffer {
  const [keyId, key] = [...parseKeyRing(config.PII_KEYS).entries()][0];
  const normalized = crypto.createHash('sha256').update(key).digest();
  const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', normalized, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from(`${keyId}.`), iv, cipher.getAuthTag(), data]);
}

export function decryptPii(config: Config, payload: Buffer): string {
  const dot = payload.indexOf(46); if (dot < 1) throw new Error('Malformed encrypted value');
  const keyId = payload.subarray(0, dot).toString(); const key = parseKeyRing(config.PII_KEYS).get(keyId);
  if (!key) throw new Error('Unknown PII key id');
  const body = payload.subarray(dot + 1); const iv = body.subarray(0, 12); const tag = body.subarray(12, 28); const data = body.subarray(28);
  const normalized = crypto.createHash('sha256').update(key).digest(); const decipher = crypto.createDecipheriv('aes-256-gcm', normalized, iv); decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export function otpHash(config: Config, challengeId: string, code: string) {
  return keyedHash(config.OTP_PEPPER, `${challengeId}|${code}`);
}
