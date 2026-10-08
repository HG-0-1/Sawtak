import { createPool } from '../db.js';
import { loadConfig } from '../config.js';
const pool = createPool(loadConfig());
try {
  await pool.query('BEGIN');
  await pool.query('UPDATE voting_rounds SET is_current=false WHERE is_current=true');
  await pool.query("INSERT INTO voting_rounds(label,mode,is_current) VALUES ('MC2026 demo reset', 'FORCE_OPEN', true)");
  await pool.query('COMMIT'); console.log('A fresh voting round was created; historic votes were retained.');
} catch (error) { await pool.query('ROLLBACK'); throw error; } finally { await pool.end(); }
