import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import argon2 from 'argon2';
import { EventEmitter } from 'node:events';
import { z, ZodError } from 'zod';
import { geoSchema, otpRequestSchema, voteSchema, type PublicCategory } from '@mc2026/shared';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { decryptPii, encryptPii, keyedHash, otpHash, randomToken, safeEqualText, sha256 } from './crypto.js';
import { normalizeJordanianMobile, last4 } from './phone.js';
import { evaluateAccess, ipMatchesCidrs, type AccessSettings } from './access.js';
import { signPresenceToken, verifyPresenceToken, type PresenceData } from './presence.js';
import { createSmsProvider, SmsDeliveryError } from './sms.js';

const config = loadConfig();
const db = createPool(config);
const events = new EventEmitter();
const sms = createSmsProvider(config);
events.setMaxListeners(2000);
const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info', redact: ['req.headers.cookie', 'req.headers.authorization', 'req.body.phone', 'req.body.code', 'res.headers.set-cookie'] },
  bodyLimit: 32 * 1024,
  trustProxy: (address: string) => ipMatchesCidrs(address, config.TRUSTED_PROXY_CIDRS.split(',').map(value => value.trim()).filter(Boolean))
});

await app.register(cookie, { secret: config.SESSION_SIGNING_KEYS, hook: 'onRequest' });
await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

const sessionMaxAge = 12 * 60 * 60;
const cookieBase = { httpOnly: true, sameSite: 'lax' as const, secure: config.secureCookies, path: '/' };
const getIp = (request: FastifyRequest) => request.ip;
const hashIp = (request: FastifyRequest) => keyedHash(config.IP_HASH_KEY, getIp(request));
const uaHash = (request: FastifyRequest) => sha256(request.headers['user-agent'] ?? '');

app.addHook('onRequest', async (_request, reply) => {
  reply.header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer')
    .header('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()')
    .header('X-Frame-Options', 'DENY').header('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; connect-src 'self'; frame-ancestors 'none'");
});

app.setErrorHandler((error, request, reply) => {
  if (error instanceof ZodError) return problem(reply, 400, 'VALIDATION_ERROR', 'Check the supplied fields.', request.id);
  request.log.error({ err: error }, 'Unhandled request error');
  return problem(reply, 500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.', request.id);
});

function problem(reply: FastifyReply, status: number, code: string, detail: string, requestId?: string) {
  return reply.code(status).type('application/problem+json').send({ type: `https://mc2026.vote/problems/${code}`, title: code, status, detail, code, requestId });
}
function jsonValue<T>(value: unknown): T { return typeof value === 'string' ? JSON.parse(value) as T : value as T; }

async function setting<T>(key: string): Promise<T> {
  const result = await db.query<{ value: unknown }>('SELECT value FROM settings WHERE key=$1', [key]);
  if (!result.rowCount) throw new Error(`Missing required setting: ${key}`);
  return jsonValue<T>(result.rows[0].value);
}
async function allSettings() {
  const [event, policy, presence, results] = await Promise.all([
    setting<Record<string, unknown>>('event.public'), setting<AccessSettings>('access.policy'),
    setting<{windowSeconds:number;sessionMinutes:number;locations:string[]}>('presence'), setting<Record<string, unknown>>('results')
  ]);
  return { event, policy, presence, results };
}
function signedValue(request: FastifyRequest, name: string) {
  const value = request.cookies[name]; if (!value) return null;
  const parsed = request.unsignCookie(value); return parsed.valid ? parsed.value : null;
}
function presenceFor(request: FastifyRequest): PresenceData | null {
  const raw = signedValue(request, 'mc_presence'); if (!raw) return null;
  try { const parsed = JSON.parse(raw) as PresenceData; return parsed.expiresAt > Date.now() ? parsed : null; } catch { return null; }
}
async function visitorFor(request: FastifyRequest) {
  const token = signedValue(request, 'mc_visitor'); if (!token) return null;
  const result = await db.query<{id:string;name:string;phone_last4:string;blocked_at:Date|null}>('SELECT v.id,v.name,v.phone_last4,v.blocked_at FROM visitor_sessions s JOIN visitors v ON v.id=s.visitor_id WHERE s.id_hash=$1 AND s.expires_at>now()', [sha256(token)]);
  return result.rows[0] ?? null;
}
async function adminFor(request: FastifyRequest) {
  const token = signedValue(request, 'mc_admin'); if (!token) return null;
  const result = await db.query<{id:string;username:string;role:'SUPER_ADMIN'|'ADMIN'|'VIEWER';mfa_passed:boolean}>('SELECT a.id,a.username,a.role,s.mfa_passed FROM admin_sessions s JOIN admins a ON a.id=s.admin_id WHERE s.id_hash=$1 AND s.expires_at>now()', [sha256(token)]);
  return result.rows[0] ?? null;
}
async function displayFor(request: FastifyRequest) {
  const token = signedValue(request, 'mc_display'); if (!token) return null;
  const result = await db.query<{kind:'RESULTS'|'QR'|'BOTH'}>('SELECT kind FROM display_sessions WHERE id_hash=$1 AND expires_at>now()', [sha256(token)]);
  return result.rows[0] ?? null;
}
async function issueVisitor(reply: FastifyReply, visitorId: string, request: FastifyRequest) {
  const token = randomToken();
  await db.query('INSERT INTO visitor_sessions(id_hash,visitor_id,expires_at,ip_hash,ua_hash) VALUES($1,$2,now()+interval \'12 hours\',$3,$4)', [sha256(token), visitorId, hashIp(request), uaHash(request)]);
  reply.setCookie('mc_visitor', token, { ...cookieBase, maxAge: sessionMaxAge, signed: true });
}
async function audit(adminId: string | null, action: string, targetType?: string, targetId?: string, metadata: Record<string, unknown> = {}) {
  await db.query('INSERT INTO audit_log(admin_id,action,target_type,target_id,metadata) VALUES($1,$2,$3,$4,$5::jsonb)', [adminId, action, targetType ?? null, targetId ?? null, JSON.stringify(metadata)]);
}
async function requireVisitor(request: FastifyRequest, reply: FastifyReply) {
  const visitor = await visitorFor(request); if (!visitor) { problem(reply, 401, 'UNAUTHENTICATED', 'Please verify your phone to continue.', request.id); return null; }
  if (visitor.blocked_at) { problem(reply, 403, 'FORBIDDEN', 'This visitor is not able to vote.', request.id); return null; }
  return visitor;
}
async function requireAdmin(request: FastifyRequest, reply: FastifyReply, superAdmin = false) {
  const admin = await adminFor(request); if (!admin || (superAdmin && admin.role !== 'SUPER_ADMIN') || (!superAdmin && admin.role === 'VIEWER')) { problem(reply, 403, 'FORBIDDEN', 'Admin permissions are required.', request.id); return null; }
  return admin;
}
async function accessFor(request: FastifyRequest, geo?: z.infer<typeof geoSchema>) {
  const policy = await setting<AccessSettings>('access.policy');
  return evaluateAccess(config, policy, { presence: Boolean(presenceFor(request)), ip: getIp(request), geo });
}
async function currentRound() {
  const result = await db.query<{id:string;mode:string;opens_at:Date|null;closes_at:Date|null}>('SELECT id,mode,opens_at,closes_at FROM voting_rounds WHERE is_current=true');
  return result.rows[0] ?? null;
}
function isVotingOpen(round: {mode:string;opens_at:Date|null;closes_at:Date|null} | null) {
  if (!round || round.mode === 'FORCE_CLOSED' || round.mode === 'PAUSED') return false;
  if (round.mode === 'FORCE_OPEN') return true;
  const now = Date.now(); return Boolean(round.opens_at && new Date(round.opens_at).getTime() <= now && (!round.closes_at || new Date(round.closes_at).getTime() > now));
}

app.get('/healthz', async () => ({ ok: true }));
app.get('/readyz', async (_request, reply) => { try { await db.query('SELECT 1'); return { ok: true }; } catch { return reply.code(503).send({ ok: false }); } });

app.get('/api/config/public', async () => {
  const { event, policy } = await allSettings(); const round = await currentRound();
  return { event, votingState: isVotingOpen(round) ? 'OPEN' : 'CLOSED', accessMode: policy.mode, development: config.NODE_ENV === 'development' };
});

app.post('/api/presence/redeem', async (request, reply) => {
  const body = z.object({ token: z.string().min(12).max(180) }).parse(request.body); const presence = await setting<{windowSeconds:number;sessionMinutes:number;locations:string[]}>('presence');
  const verified = verifyPresenceToken(config, body.token, presence.windowSeconds);
  if (!verified || !presence.locations.includes(verified.locationId)) return problem(reply, 400, 'INVALID_PRESENCE_TOKEN', 'This code is no longer active. Please scan the screen again.', request.id);
  await db.query('INSERT INTO presence_redemptions(location_id,window_index,ip_hash) VALUES($1,$2,$3)', [verified.locationId, Math.floor(Date.now() / 1000 / presence.windowSeconds), hashIp(request)]);
  const payload: PresenceData = { locationId: verified.locationId, expiresAt: Date.now() + presence.sessionMinutes * 60_000 };
  reply.setCookie('mc_presence', JSON.stringify(payload), { ...cookieBase, maxAge: presence.sessionMinutes * 60, signed: true });
  return { ok: true, expiresAt: new Date(payload.expiresAt).toISOString() };
});

app.post('/api/auth/otp/request', async (request, reply) => {
  const body = otpRequestSchema.parse(request.body); const access = await accessFor(request, body.geo);
  if (!access.allowed) return problem(reply, 403, access.reason ?? 'OUTSIDE_VENUE', 'Please scan the on-site code and allow location access.', request.id);
  const phone = normalizeJordanianMobile(body.phone); if (!phone) return problem(reply, 400, 'VALIDATION_ERROR', 'Enter a Jordanian mobile number, e.g. 07X XXX XXXX.', request.id);
  const phoneHash = keyedHash(config.PHONE_PEPPER, phone);
  const code = config.NODE_ENV === 'development' && config.DEMO_OTP_CODE ? config.DEMO_OTP_CODE : String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 5 * 60_000);
  const client = await db.connect();
  let id: string;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [phoneHash.toString('hex')]);
    const recent = await client.query<{count:string;retry_after_sec:string}>('SELECT count(*)::text AS count, GREATEST(1,CEIL(EXTRACT(EPOCH FROM (min(sent_at)+interval \'1 hour\'-now()))))::text AS retry_after_sec FROM otp_send_events WHERE phone_hash=$1 AND sent_at>now()-interval \'1 hour\'', [phoneHash]);
    if (Number(recent.rows[0].count) >= 5) {
      await client.query('ROLLBACK');
      reply.header('Retry-After', recent.rows[0].retry_after_sec);
      return problem(reply, 429, 'OTP_THROTTLED', 'This number reached five OTP sends in the last hour. Use “DEMO: Skip OTP and open voting” to continue now, or try again after the wait.', request.id);
    }
    id = (await client.query<{id:string}>('SELECT gen_random_uuid() AS id')).rows[0].id;
    await client.query('INSERT INTO otp_challenges(id,phone_hash,phone_enc,pending_name,consent_version,code_hash,expires_at,presence_sid,ip_hash,device_hash,provider) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [id, phoneHash, encryptPii(config, phone), body.name, 'DEMO-v1', otpHash(config, id, code), expiresAt, presenceFor(request)?.locationId ?? null, hashIp(request), uaHash(request), config.SMS_PROVIDER]);
    await client.query('INSERT INTO otp_send_events(phone_hash,challenge_id,send_number) VALUES($1,$2,1)', [phoneHash, id]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  try { const receipt = await sms.sendOtp(phone, code); await db.query('UPDATE otp_challenges SET provider=$2,provider_message_id=$3 WHERE id=$1', [id, receipt.provider, receipt.messageId ?? null]); }
  catch (error) { await db.query("UPDATE otp_challenges SET status='CANCELLED' WHERE id=$1", [id]); if (error instanceof SmsDeliveryError) return problem(reply, 503, 'OTP_UNAVAILABLE', 'Verification is taking longer than usual. Please try again shortly.', request.id); throw error; }
  // The mock provider deliberately does not log, render, or retain the OTP. DEMO_OTP_CODE is server configuration only.
  return { challengeId: id, expiresAt: expiresAt.toISOString(), resendAfterSec: 45 };
});

app.post('/api/auth/demo/skip-otp', async (request, reply) => {
  if (config.NODE_ENV !== 'development') return problem(reply, 404, 'NOT_FOUND', 'This endpoint is not available.', request.id);
  const body = otpRequestSchema.parse(request.body);
  const access = await accessFor(request, body.geo);
  if (!access.allowed) return problem(reply, 403, access.reason ?? 'OUTSIDE_VENUE', 'Please scan the on-site code and allow location access.', request.id);
  const phone = normalizeJordanianMobile(body.phone);
  if (!phone) return problem(reply, 400, 'VALIDATION_ERROR', 'Enter a Jordanian mobile number, e.g. 07X XXX XXXX.', request.id);
  const phoneHash = keyedHash(config.PHONE_PEPPER, phone);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const visitor = await client.query<{id:string}>('INSERT INTO visitors(name,phone_enc,phone_hash,phone_last4,consent_version,consent_at,phone_verified_at,device_hash) VALUES($1,$2,$3,$4,$5,now(),now(),$6) ON CONFLICT(phone_hash) DO UPDATE SET name=EXCLUDED.name,phone_verified_at=now() RETURNING id', [body.name, encryptPii(config, phone), phoneHash, last4(phone), 'DEMO-v1', uaHash(request)]);
    await client.query('COMMIT');
    await issueVisitor(reply, visitor.rows[0].id, request);
    return { ok: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

app.post('/api/auth/otp/resend', async (request, reply) => {
  if (!presenceFor(request)) return problem(reply, 403, 'PRESENCE_REQUIRED', 'Please scan the on-site code again.', request.id);
  const body = z.object({ challengeId: z.string().uuid() }).parse(request.body);
  const found = await db.query<{phone_hash:Buffer}>('SELECT phone_hash FROM otp_challenges WHERE id=$1', [body.challengeId]);
  if (!found.rowCount) return problem(reply, 400, 'OTP_EXPIRED', 'That code is no longer active. Request a new one.', request.id);
  const phoneHash = found.rows[0].phone_hash;
  const code = config.NODE_ENV === 'development' && config.DEMO_OTP_CODE ? config.DEMO_OTP_CODE : String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 5 * 60_000);
  const client = await db.connect();
  let phone: string;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [phoneHash.toString('hex')]);
    const locked = await client.query<{id:string;status:string;last_sent_at:Date;expires_at:Date;phone_enc:Buffer;send_count:number}>('SELECT id,status,last_sent_at,expires_at,phone_enc,send_count FROM otp_challenges WHERE id=$1 FOR UPDATE', [body.challengeId]);
    const challenge = locked.rows[0];
    if (!challenge || challenge.status !== 'PENDING' || challenge.expires_at.getTime() < Date.now()) {
      await client.query('ROLLBACK');
      return problem(reply, 400, 'OTP_EXPIRED', 'That code is no longer active. Request a new one.', request.id);
    }
    const waitMs = 45_000 - (Date.now() - challenge.last_sent_at.getTime());
    if (waitMs > 0) {
      await client.query('ROLLBACK');
      reply.header('Retry-After', String(Math.ceil(waitMs / 1000)));
      return problem(reply, 429, 'OTP_THROTTLED', 'Please wait before requesting another code.', request.id);
    }
    const recent = await client.query<{count:string;retry_after_sec:string}>('SELECT count(*)::text AS count, GREATEST(1,CEIL(EXTRACT(EPOCH FROM (min(sent_at)+interval \'1 hour\'-now()))))::text AS retry_after_sec FROM otp_send_events WHERE phone_hash=$1 AND sent_at>now()-interval \'1 hour\'', [phoneHash]);
    if (Number(recent.rows[0].count) >= 5) {
      await client.query('ROLLBACK');
      reply.header('Retry-After', recent.rows[0].retry_after_sec);
      return problem(reply, 429, 'OTP_THROTTLED', 'This number reached five OTP sends in the last hour. Use “DEMO: Skip OTP and open voting” to continue now, or try again after the wait.', request.id);
    }
    phone = decryptPii(config, challenge.phone_enc);
    await client.query('UPDATE otp_challenges SET last_sent_at=now(),send_count=send_count+1 WHERE id=$1', [challenge.id]);
    await client.query('INSERT INTO otp_send_events(phone_hash,challenge_id,send_number) SELECT $1,$2,send_count FROM otp_challenges WHERE id=$2', [phoneHash, challenge.id]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  try {
    const receipt = await sms.sendOtp(phone, code);
    await db.query('UPDATE otp_challenges SET code_hash=$2,expires_at=$3,provider=$4,provider_message_id=$5 WHERE id=$1', [body.challengeId, otpHash(config, body.challengeId, code), expiresAt, receipt.provider, receipt.messageId ?? null]);
  }
  catch (error) { if (error instanceof SmsDeliveryError) return problem(reply, 503, 'OTP_UNAVAILABLE', 'Verification is taking longer than usual. Please try again shortly.', request.id); throw error; }
  return { challengeId: body.challengeId, expiresAt: expiresAt.toISOString(), resendAfterSec: 45 };
});

app.post('/api/auth/otp/verify', async (request, reply) => {
  const body = z.object({ challengeId: z.string().uuid(), code: z.string().regex(/^\d{6}$/).optional(), skip: z.boolean().optional() }).refine((value) => value.skip === true || !!value.code, {
    message: 'Provide either a six-digit code or a dev bypass flag.',
    path: ['code']
  }).parse(request.body);
  const challenge = await db.query<{id:string;phone_hash:Buffer;phone_enc:Buffer;pending_name:string;consent_version:string;code_hash:Buffer;status:string;attempts:number;max_attempts:number;expires_at:Date}>('SELECT * FROM otp_challenges WHERE id=$1 FOR UPDATE', [body.challengeId]);
  const row = challenge.rows[0]; if (!row || row.status !== 'PENDING' || row.expires_at.getTime() < Date.now()) return problem(reply, 400, 'OTP_EXPIRED', 'That code has expired. Request a new one.', request.id);
  if (row.attempts >= row.max_attempts) return problem(reply, 429, 'OTP_LOCKED', 'Too many attempts. Request a new code.', request.id);
  const isDevBypass = config.NODE_ENV === 'development' && body.skip === true;
  if (!isDevBypass && !safeEqualText(row.code_hash.toString('hex'), otpHash(config, row.id, body.code ?? '').toString('hex'))) {
    await db.query('UPDATE otp_challenges SET attempts=attempts+1, status=CASE WHEN attempts+1>=max_attempts THEN \'LOCKED\'::otp_status ELSE status END WHERE id=$1', [row.id]);
    return problem(reply, 400, 'OTP_INVALID', 'That code is not correct. Please try again.', request.id);
  }
  if (isDevBypass && config.NODE_ENV !== 'development') return problem(reply, 403, 'FORBIDDEN', 'Development-only bypass is unavailable in this environment.', request.id);
  const phone = decryptPii(config, row.phone_enc); const client = await db.connect();
  try {
    await client.query('BEGIN');
    const visitor = await client.query<{id:string}>('INSERT INTO visitors(name,phone_enc,phone_hash,phone_last4,consent_version,consent_at,phone_verified_at,device_hash) VALUES($1,$2,$3,$4,$5,now(),now(),$6) ON CONFLICT(phone_hash) DO UPDATE SET name=EXCLUDED.name,phone_verified_at=now() RETURNING id', [row.pending_name, row.phone_enc, row.phone_hash, last4(phone), row.consent_version, uaHash(request)]);
    await client.query("UPDATE otp_challenges SET status='VERIFIED',verified_at=now() WHERE id=$1", [row.id]); await client.query('COMMIT');
    await issueVisitor(reply, visitor.rows[0].id, request); return { ok: true };
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
});

app.post('/api/auth/logout', async (_request, reply) => { reply.clearCookie('mc_visitor', cookieBase); return { ok: true }; });

app.get('/api/me', async (request, reply) => {
  const visitor = await requireVisitor(request, reply); if (!visitor) return;
  const round = await currentRound(); const votes = round ? await db.query<{category_id:string;exhibitor_id:string}>('SELECT category_id,exhibitor_id FROM votes WHERE round_id=$1 AND visitor_id=$2 AND NOT EXISTS (SELECT 1 FROM vote_voids vv WHERE vv.vote_id=votes.id)', [round.id, visitor.id]) : { rows: [] };
  return { visitor: { name: visitor.name, phoneLast4: visitor.phone_last4 }, castVotes: votes.rows.map(v => ({ categoryId: v.category_id, exhibitorId: v.exhibitor_id })), votingState: isVotingOpen(round) ? 'OPEN' : 'CLOSED' };
});

app.get('/api/categories', async (_request, reply) => {
  const result = await db.query<{category_id:string;slug:string;name_en:string;name_ar:string|null;description_en:string|null;description_ar:string|null;sort_order:number;exhibitor_id:string|null;name:string|null;exhibitor_name_ar:string|null;description:string|null;exhibitor_description_ar:string|null;booth_label:string|null;image_key:string|null}>(`SELECT c.id category_id,c.slug,c.name_en,c.name_ar,c.description_en,c.description_ar,c.sort_order,e.id exhibitor_id,e.name,e.name_ar exhibitor_name_ar,e.description,e.description_ar exhibitor_description_ar,e.booth_label,e.thumb_key image_key FROM categories c LEFT JOIN exhibitor_categories ec ON ec.category_id=c.id LEFT JOIN exhibitors e ON e.id=ec.exhibitor_id AND e.is_active=true WHERE c.is_active=true ORDER BY c.sort_order,e.name`);
  const byId = new Map<string, PublicCategory>();
  for (const row of result.rows) { if (!byId.has(row.category_id)) byId.set(row.category_id, { id:row.category_id,slug:row.slug,nameEn:row.name_en,nameAr:row.name_ar,descriptionEn:row.description_en,descriptionAr:row.description_ar,sortOrder:row.sort_order,exhibitors:[] }); if (row.exhibitor_id) byId.get(row.category_id)!.exhibitors.push({ id:row.exhibitor_id,name:row.name!,nameAr:row.exhibitor_name_ar,description:row.description,descriptionAr:row.exhibitor_description_ar,boothLabel:row.booth_label,imageUrl:row.image_key }); }
  reply.header('Cache-Control', 'private, max-age=30'); return [...byId.values()];
});

app.post('/api/votes', async (request, reply) => {
  const visitor = await requireVisitor(request, reply); if (!visitor) return;
  const body = voteSchema.parse(request.body); const access = await accessFor(request, body.geo);
  if (!access.allowed) return problem(reply, 403, access.reason ?? 'OUTSIDE_VENUE', 'Please return to the venue before voting.', request.id);
  const round = await currentRound(); if (!isVotingOpen(round)) return problem(reply, 409, 'VOTING_NOT_OPEN', 'Voting is not open right now.', request.id);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const eligible = await client.query('SELECT 1 FROM exhibitor_categories ec JOIN exhibitors e ON e.id=ec.exhibitor_id AND e.is_active=true JOIN categories c ON c.id=ec.category_id AND c.is_active=true WHERE ec.exhibitor_id=$1 AND ec.category_id=$2', [body.exhibitorId, body.categoryId]);
    if (!eligible.rowCount) { await client.query('ROLLBACK'); return problem(reply, 400, 'EXHIBITOR_NOT_IN_CATEGORY', 'Choose a maker in this award category.', request.id); }
    const inserted = await client.query<{id:string}>('INSERT INTO votes(round_id,visitor_id,category_id,exhibitor_id,signals,ip_hash,device_hash) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7) ON CONFLICT(round_id,visitor_id,category_id) DO NOTHING RETURNING id', [round!.id,visitor.id,body.categoryId,body.exhibitorId,JSON.stringify(access.signals),hashIp(request),uaHash(request)]);
    if (!inserted.rowCount) { const existing = await client.query<{exhibitor_id:string}>('SELECT exhibitor_id FROM votes WHERE round_id=$1 AND visitor_id=$2 AND category_id=$3', [round!.id,visitor.id,body.categoryId]); await client.query('COMMIT'); if (existing.rows[0].exhibitor_id === body.exhibitorId) return { status: 'ALREADY_RECORDED' }; return problem(reply, 409, 'ALREADY_VOTED', 'You have already voted in this category.', request.id); }
    await client.query("SELECT pg_notify('results_changed',$1)", [round!.id]); await client.query('COMMIT'); events.emit('results_changed');
    return reply.code(201).send({ status: 'RECORDED' });
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
});

async function resultsSnapshot() {
  const round = await currentRound(); if (!round) return { categories: [], totals: { votes: 0, verifiedVisitors: 0 }, votingState: 'CLOSED', serverTime: new Date().toISOString() };
  const rows = await db.query<{category_id:string;name_en:string;name_ar:string|null;exhibitor_id:string;exhibitor_name:string;votes:string}>(`SELECT c.id category_id,c.name_en,c.name_ar,e.id exhibitor_id,e.name exhibitor_name,count(v.id)::text votes FROM categories c JOIN exhibitor_categories ec ON ec.category_id=c.id JOIN exhibitors e ON e.id=ec.exhibitor_id LEFT JOIN votes v ON v.category_id=c.id AND v.exhibitor_id=e.id AND v.round_id=$1 AND NOT EXISTS(SELECT 1 FROM vote_voids vv WHERE vv.vote_id=v.id) WHERE c.is_active=true AND e.is_active=true GROUP BY c.id,c.name_en,c.name_ar,e.id,e.name ORDER BY c.sort_order,count(v.id) DESC,e.name`, [round.id]);
  const categories = new Map<string, {id:string;nameEn:string;nameAr:string|null;entries:{exhibitorId:string;name:string;votes:number;percentage:number;rank:number;isTied:boolean}[]}>();
  for (const row of rows.rows) { if (!categories.has(row.category_id)) categories.set(row.category_id,{id:row.category_id,nameEn:row.name_en,nameAr:row.name_ar,entries:[]}); categories.get(row.category_id)!.entries.push({exhibitorId:row.exhibitor_id,name:row.exhibitor_name,votes:Number(row.votes),percentage:0,rank:0,isTied:false}); }
  for (const category of categories.values()) { const total = category.entries.reduce((sum,entry) => sum + entry.votes,0); category.entries.forEach((entry,index) => { entry.percentage = total ? Math.round(entry.votes / total * 100) : 0; entry.rank = index === 0 ? 1 : (entry.votes === category.entries[index-1].votes ? category.entries[index-1].rank : index+1); entry.isTied = category.entries.filter(other=>other.votes === entry.votes).length > 1 && entry.votes > 0; }); }
  const total = await db.query<{votes:string;visitors:string}>('SELECT count(*)::text votes,count(DISTINCT visitor_id)::text visitors FROM votes WHERE round_id=$1 AND NOT EXISTS(SELECT 1 FROM vote_voids vv WHERE vv.vote_id=votes.id)', [round.id]);
  return { categories:[...categories.values()], totals:{votes:Number(total.rows[0].votes),verifiedVisitors:Number(total.rows[0].visitors)},votingState:isVotingOpen(round)?'OPEN':'CLOSED',serverTime:new Date().toISOString() };
}
async function canSeeResults(request: FastifyRequest) {
  return config.NODE_ENV === 'development' || Boolean(await visitorFor(request)) || Boolean(await adminFor(request)) || Boolean(await displayFor(request));
}
app.get('/api/results', async (request, reply) => { if (!await canSeeResults(request)) return problem(reply, 401, 'UNAUTHENTICATED', 'A verified visitor, display, or admin session is required.', request.id); return resultsSnapshot(); });
app.get('/api/results/stream', async (request, reply) => {
  if (!await canSeeResults(request)) return problem(reply, 401, 'UNAUTHENTICATED', 'A verified visitor, display, or admin session is required.', request.id);
  reply.raw.writeHead(200, { 'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no' });
  const send = async () => reply.raw.write(`event: snapshot\ndata: ${JSON.stringify(await resultsSnapshot())}\n\n`);
  await send(); const onChanged = () => { void send(); }; events.on('results_changed', onChanged); const ping = setInterval(() => reply.raw.write(': ping\n\n'), 20_000);
  request.raw.on('close', () => { clearInterval(ping); events.off('results_changed', onChanged); }); return reply.hijack();
});

app.post('/api/display/session', async (request, reply) => {
  const token = request.headers['x-display-token']; if (typeof token !== 'string') return problem(reply, 401, 'INVALID_DISPLAY_TOKEN', 'A display token is required.', request.id);
  const found = await db.query<{kind:'RESULTS'|'QR'|'BOTH';id:string}>('SELECT id,kind FROM display_tokens WHERE token_hash=$1 AND revoked_at IS NULL', [sha256(token)]); if (!found.rowCount) return problem(reply, 401, 'INVALID_DISPLAY_TOKEN', 'This display token is not valid.', request.id);
  const value = randomToken(); await db.query("INSERT INTO display_sessions(id_hash,kind,expires_at) VALUES($1,$2,now()+interval '8 hours')", [sha256(value), found.rows[0].kind]); await db.query('UPDATE display_tokens SET last_seen_at=now() WHERE id=$1', [found.rows[0].id]); reply.setCookie('mc_display', value, { ...cookieBase, maxAge: 8*60*60, signed:true }); return { ok:true, kind:found.rows[0].kind };
});
app.get('/api/display/qr', async (request, reply) => { const display = await displayFor(request); if ((!display || !['QR','BOTH'].includes(display.kind)) && config.NODE_ENV !== 'development') return problem(reply,401,'UNAUTHENTICATED','A QR display session is required.',request.id); const presence = await setting<{windowSeconds:number}>('presence'); const token = signPresenceToken(config, 'entrance', presence.windowSeconds); const validUntil = (Math.floor(Date.now()/1000/presence.windowSeconds)+1)*presence.windowSeconds*1000; return { url:`${config.PUBLIC_BASE_URL}/p/${token}`,validUntil:new Date(validUntil).toISOString(),nextRefreshInMs:Math.max(0,validUntil-Date.now()),windowSeconds:presence.windowSeconds }; });

app.post('/api/admin/auth/login', async (request, reply) => {
  const body = z.object({ username:z.string().min(1).max(80),password:z.string().min(1).max(256) }).parse(request.body); const found = await db.query<{id:string;username:string;password_hash:string;role:'SUPER_ADMIN'|'ADMIN'|'VIEWER';locked_until:Date|null}>('SELECT id,username,password_hash,role,locked_until FROM admins WHERE username=$1',[body.username]); const admin=found.rows[0];
  if (!admin || (admin.locked_until && admin.locked_until.getTime()>Date.now()) || !await argon2.verify(admin.password_hash,body.password)) { if (admin) await db.query("UPDATE admins SET failed_attempts=failed_attempts+1,locked_until=CASE WHEN failed_attempts+1>=5 THEN now()+interval '15 minutes' ELSE locked_until END WHERE id=$1",[admin.id]); return problem(reply,401,'UNAUTHENTICATED','Those credentials are not correct.',request.id); }
  const value=randomToken(); await db.query("INSERT INTO admin_sessions(id_hash,admin_id,mfa_passed,expires_at,ip_hash,ua_hash) VALUES($1,$2,true,now()+interval '8 hours',$3,$4)",[sha256(value),admin.id,hashIp(request),uaHash(request)]); await db.query('UPDATE admins SET failed_attempts=0,locked_until=NULL,last_login_at=now() WHERE id=$1',[admin.id]); await audit(admin.id,'ADMIN_LOGIN'); reply.setCookie('mc_admin',value,{...cookieBase,maxAge:8*60*60,signed:true}); return {ok:true,admin:{username:admin.username,role:admin.role}};
});
app.post('/api/admin/auth/logout', async (request, reply) => { const admin=await adminFor(request); if(admin) await audit(admin.id,'ADMIN_LOGOUT'); reply.clearCookie('mc_admin',cookieBase); return {ok:true}; });
app.get('/api/admin/me', async (request, reply) => { const admin=await adminFor(request); if(!admin)return problem(reply,401,'UNAUTHENTICATED','Sign in to continue.',request.id); return {admin}; });
app.get('/api/admin/stats', async (request, reply) => { const admin=await requireAdmin(request,reply); if(!admin)return; const snapshot=await resultsSnapshot(); const flags=await db.query<{count:string}>('SELECT count(*)::text FROM visitors WHERE blocked_at IS NOT NULL'); return { ...snapshot.totals, votingState:snapshot.votingState, blockedVisitors:Number(flags.rows[0].count), sseClients:events.listenerCount('results_changed') }; });
app.get('/api/admin/settings', async (request, reply) => { if(!await requireAdmin(request,reply))return; const result=await db.query('SELECT key,value,updated_at FROM settings ORDER BY key'); return result.rows; });
app.put('/api/admin/settings', async (request, reply) => { const admin=await requireAdmin(request,reply,true); if(!admin)return; const body=z.object({key:z.enum(['access.policy','event.public','presence','results','retention']),value:z.record(z.unknown())}).parse(request.body); if(body.key==='access.policy'){const policy=body.value as Partial<AccessSettings>;if(policy.mode==='STRICT' && !policy.ip?.enabled && !policy.geo?.enabled)return problem(reply,400,'VALIDATION_ERROR','STRICT mode requires an IP or geolocation check.',request.id);if(policy.mode==='OFF' && config.NODE_ENV==='production')return problem(reply,400,'VALIDATION_ERROR','OFF is not available in production.',request.id);} await db.query('UPDATE settings SET value=$2::jsonb,updated_by=$3,updated_at=now() WHERE key=$1',[body.key,JSON.stringify(body.value),admin.id]); await audit(admin.id,'SETTINGS_UPDATED','setting',body.key); return {ok:true}; });
app.get('/api/admin/categories', async (request,reply)=>{if(!await requireAdmin(request,reply))return;const result=await db.query('SELECT * FROM categories ORDER BY sort_order');return result.rows;});
app.post('/api/admin/categories', async (request,reply)=>{const admin=await requireAdmin(request,reply);if(!admin)return;const body=z.object({slug:z.string().regex(/^[a-z0-9-]+$/),nameEn:z.string().min(2),nameAr:z.string().optional(),descriptionEn:z.string().optional(),descriptionAr:z.string().optional(),sortOrder:z.number().int().optional()}).parse(request.body);const result=await db.query('INSERT INTO categories(slug,name_en,name_ar,description_en,description_ar,sort_order) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[body.slug,body.nameEn,body.nameAr??null,body.descriptionEn??null,body.descriptionAr??null,body.sortOrder??100]);await audit(admin.id,'CATEGORY_CREATED','category',result.rows[0].id);return reply.code(201).send(result.rows[0]);});
app.put('/api/admin/categories/:id', async (request,reply)=>{const admin=await requireAdmin(request,reply);if(!admin)return;const body=z.object({nameEn:z.string().min(2),nameAr:z.string().nullable().optional(),descriptionEn:z.string().nullable().optional(),descriptionAr:z.string().nullable().optional(),sortOrder:z.number().int(),isActive:z.boolean()}).parse(request.body);const id=(request.params as {id:string}).id;const result=await db.query('UPDATE categories SET name_en=$2,name_ar=$3,description_en=$4,description_ar=$5,sort_order=$6,is_active=$7 WHERE id=$1 RETURNING *',[id,body.nameEn,body.nameAr??null,body.descriptionEn??null,body.descriptionAr??null,body.sortOrder,body.isActive]);await audit(admin.id,'CATEGORY_UPDATED','category',id);return result.rows[0];});
app.get('/api/admin/exhibitors', async (request,reply)=>{if(!await requireAdmin(request,reply))return;const result=await db.query(`SELECT e.*,coalesce(array_agg(ec.category_id) FILTER(WHERE ec.category_id IS NOT NULL),'{}') category_ids FROM exhibitors e LEFT JOIN exhibitor_categories ec ON ec.exhibitor_id=e.id GROUP BY e.id ORDER BY e.name`);return result.rows;});
app.post('/api/admin/exhibitors', async (request,reply)=>{const admin=await requireAdmin(request,reply);if(!admin)return;const body=z.object({name:z.string().min(2),nameAr:z.string().optional(),description:z.string().optional(),descriptionAr:z.string().optional(),boothLabel:z.string().optional(),categoryIds:z.array(z.string().uuid()).min(1)}).parse(request.body);const client=await db.connect();try{await client.query('BEGIN');const created=await client.query<{id:string}>('INSERT INTO exhibitors(name,name_ar,description,description_ar,booth_label,image_key,thumb_key) VALUES($1,$2,$3,$4,$5,$6,$6) RETURNING id',[body.name,body.nameAr??null,body.description??null,body.descriptionAr??null,body.boothLabel??null,'/demo/project.svg']);for(const categoryId of body.categoryIds)await client.query('INSERT INTO exhibitor_categories(exhibitor_id,category_id) VALUES($1,$2)',[created.rows[0].id,categoryId]);await client.query('COMMIT');await audit(admin.id,'EXHIBITOR_CREATED','exhibitor',created.rows[0].id);return reply.code(201).send({id:created.rows[0].id});}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}});
app.put('/api/admin/exhibitors/:id/categories', async (request,reply)=>{const admin=await requireAdmin(request,reply);if(!admin)return;const body=z.object({categoryIds:z.array(z.string().uuid()).min(1)}).parse(request.body);const id=(request.params as {id:string}).id;const client=await db.connect();try{await client.query('BEGIN');await client.query('DELETE FROM exhibitor_categories WHERE exhibitor_id=$1',[id]);for(const categoryId of body.categoryIds)await client.query('INSERT INTO exhibitor_categories(exhibitor_id,category_id) VALUES($1,$2)',[id,categoryId]);await client.query('COMMIT');await audit(admin.id,'EXHIBITOR_ASSIGNMENTS_UPDATED','exhibitor',id);return{ok:true};}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}});
for (const action of ['open','pause','close'] as const) app.post(`/api/admin/voting/${action}`,async(request,reply)=>{const admin=await requireAdmin(request,reply);if(!admin)return;const mode=action==='open'?'FORCE_OPEN':action==='pause'?'PAUSED':'FORCE_CLOSED';await db.query('UPDATE voting_rounds SET mode=$1 WHERE is_current=true',[mode]);await audit(admin.id,`VOTING_${action.toUpperCase()}`);events.emit('results_changed');return{ok:true,mode};});
app.get('/api/admin/visitors',async(request,reply)=>{if(!await requireAdmin(request,reply))return;const result=await db.query('SELECT id,name,phone_last4,phone_verified_at,blocked_at,created_at FROM visitors ORDER BY created_at DESC LIMIT 100');return result.rows;});
app.post('/api/admin/visitors/:id/block',async(request,reply)=>{const admin=await requireAdmin(request,reply);if(!admin)return;const body=z.object({reason:z.string().min(3).max(300)}).parse(request.body);const id=(request.params as {id:string}).id;await db.query('UPDATE visitors SET blocked_at=now(),blocked_reason=$2 WHERE id=$1',[id,body.reason]);await audit(admin.id,'VISITOR_BLOCKED','visitor',id);return{ok:true};});
app.get('/api/admin/results/export',async(request,reply)=>{const admin=await requireAdmin(request,reply);if(!admin)return;const data=await resultsSnapshot();await audit(admin.id,'RESULTS_EXPORTED');const format=(request.query as {format?:string}).format;if(format==='csv'){const lines=['category,exhibitor,votes,percentage'];for(const c of data.categories)for(const e of c.entries)lines.push(`"${c.nameEn}","${e.name.replaceAll('"','""')}",${e.votes},${e.percentage}`);return reply.type('text/csv').send(lines.join('\n'));}return{exportedAt:new Date().toISOString(),sha256:sha256(JSON.stringify(data)).toString('hex'),data};});
app.post('/api/admin/results/reset',async(request,reply)=>{const admin=await requireAdmin(request,reply,true);if(!admin)return;const body=z.object({confirmation:z.literal('RESET MC2026')}).parse(request.body);void body;const client=await db.connect();try{await client.query('BEGIN');await client.query('UPDATE voting_rounds SET is_current=false WHERE is_current=true');const result=await client.query<{id:string}>("INSERT INTO voting_rounds(label,mode,is_current) VALUES('MC2026 reset','FORCE_CLOSED',true) RETURNING id");await client.query('COMMIT');await audit(admin.id,'RESULTS_RESET','round',result.rows[0].id);events.emit('results_changed');return{ok:true,roundId:result.rows[0].id};}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}});

const close = async () => { await app.close(); await db.end(); };
process.on('SIGINT', close); process.on('SIGTERM', close);
await app.listen({ port: config.PORT, host: '0.0.0.0' });
