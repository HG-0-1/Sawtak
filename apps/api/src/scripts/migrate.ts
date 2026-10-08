import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createPool } from '../db.js';
import { loadConfig } from '../config.js';

const file = fileURLToPath(new URL('../../../../infra/postgres/001_init.sql', import.meta.url));
const pool = createPool(loadConfig());
try { await pool.query(await fs.readFile(file, 'utf8')); console.log('Migration 001_init.sql applied.'); }
finally { await pool.end(); }
