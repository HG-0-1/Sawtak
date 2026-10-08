import argon2 from 'argon2';
import { createPool } from '../db.js';
import { encryptPii, keyedHash, randomToken, sha256 } from '../crypto.js';
import { loadConfig } from '../config.js';

const config = loadConfig(); const pool = createPool(config);
const categories = [
  ['community-impact', 'Community Impact', 'أثر مجتمعي', 'Ideas that create a positive ripple beyond their booth.'],
  ['emerging-maker', 'Emerging Maker', 'صانع ناشئ', 'A fresh practice with a clear point of view.'],
  ['peoples-choice', "People’s Choice", 'اختيار الجمهور', 'The project that made the room stop and look.']
];
const exhibitors = [
  ['Loom Lab', 'مختبر النول', 'Textile offcuts remade into locally crafted insulation.', 'A12', ['community-impact', 'peoples-choice']],
  ['Re:Grow', 'ري-غرو', 'Compact growing systems for dense urban neighbourhoods.', 'B03', ['community-impact', 'emerging-maker']],
  ['Orbit Craft', 'أوربت كرافت', 'Open electronics kits made for curious young makers.', 'C18', ['emerging-maker', 'peoples-choice']],
  ['Noor Studio', 'استوديو نور', 'Light objects exploring warm, human-scale spaces.', 'C08', ['emerging-maker']],
  ['Desert / Dust', 'صحراء / غبار', 'Material research rooted in the landscapes around us.', 'A01', ['community-impact', 'peoples-choice']],
  ['Harf & Form', 'حرف وفورم', 'Expressive Arabic lettering made tangible through objects.', 'B14', ['peoples-choice']],
  ['Kinetic Clay', 'طين حركي', 'Small ceramic mechanisms that respond to touch.', 'D06', ['emerging-maker']],
  ['Sadda', 'صدّى', 'A sound bench that turns gathering into an instrument.', 'D11', ['community-impact', 'peoples-choice']],
  ['Sun Thread', 'خيط الشمس', 'Solar wearable accessories for everyday movement.', 'A19', ['emerging-maker']],
  ['Tinker Cart', 'عربة ابتكار', 'A mobile workshop for young people across Jordan.', 'B08', ['community-impact']],
  ['Aqaba Algae', 'طحالب العقبة', 'Bio-material studies with a coastal point of view.', 'C04', ['emerging-maker', 'peoples-choice']],
  ['Wadi Wool', 'صوف الوادي', 'Natural-fibre objects made in collaboration with local makers.', 'A16', ['community-impact']]
];
try {
  await pool.query('BEGIN');
  await pool.query("INSERT INTO voting_rounds(label, mode, is_current) VALUES ('MC2026 Community Awards', 'FORCE_OPEN', true) ON CONFLICT DO NOTHING");
  for (let i = 0; i < categories.length; i++) {
    const [slug, en, ar, description] = categories[i];
    await pool.query('INSERT INTO categories(slug,name_en,name_ar,description_en,sort_order) VALUES($1,$2,$3,$4,$5) ON CONFLICT(slug) DO UPDATE SET name_en=EXCLUDED.name_en', [slug, en, ar, description, i + 1]);
  }
  const categoryRows = await pool.query<{id:string;slug:string}>('SELECT id,slug FROM categories'); const categoryMap = new Map(categoryRows.rows.map(row => [row.slug, row.id]));
  for (const [name, nameAr, description, booth, slugs] of exhibitors) {
    const result = await pool.query<{id:string}>('INSERT INTO exhibitors(name,name_ar,description,booth_label,image_key,thumb_key) VALUES($1,$2,$3,$4,$5,$5) ON CONFLICT(name) DO UPDATE SET description=EXCLUDED.description RETURNING id', [name, nameAr, description, booth, '/demo/project.svg']);
    for (const slug of slugs) await pool.query('INSERT INTO exhibitor_categories(exhibitor_id,category_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [result.rows[0].id, categoryMap.get(slug)]);
  }
  const passwordHash = await argon2.hash(config.DEMO_ADMIN_PASSWORD, { type: argon2.argon2id });
  await pool.query("INSERT INTO admins(username,password_hash,role) VALUES($1,$2,'SUPER_ADMIN') ON CONFLICT(username) DO UPDATE SET password_hash=EXCLUDED.password_hash", [config.DEMO_ADMIN_USERNAME, passwordHash]);
  const defaults: Record<string, unknown> = {
    'event.public': { name: 'Maker Collective 2026', timezone: 'Asia/Amman', languages: ['en', 'ar'], consentVersion: 'DEMO-v1', consentText: 'I consent to the use of my details for voting and future Maker Collective outreach.' },
    'access.policy': { mode: config.NODE_ENV === 'development' ? 'OFF' : 'STRICT', ip: { enabled: false, allowlist: [] }, geo: { enabled: true, lat: 31.9539, lng: 35.9106, radiusM: 250, maxAccuracyM: 120 } },
    'presence': { windowSeconds: 60, sessionMinutes: 30, locations: ['entrance', 'hall'] },
    'results': { visibility: 'TV_ONLY', topN: 5, rotateSeconds: 12 },
    'retention': { piiDays: 90 }
  };
  for (const [key, value] of Object.entries(defaults)) await pool.query('INSERT INTO settings(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO NOTHING', [key, JSON.stringify(value)]);
  const token = randomToken();
  await pool.query("INSERT INTO display_tokens(token_hash,label,kind) VALUES($1,'DEMO display token','BOTH') ON CONFLICT DO NOTHING", [sha256(token)]);
  await pool.query('COMMIT');
  console.log('Seed complete. Demo display token is intentionally not printed; create one through admin for a display device.');
} catch (error) { await pool.query('ROLLBACK'); throw error; } finally { await pool.end(); }
