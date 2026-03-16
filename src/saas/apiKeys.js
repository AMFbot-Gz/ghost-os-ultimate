/**
 * src/saas/apiKeys.js — Gestion des API Keys SaaS Ghost OS
 *
 * Chaque utilisateur a une clé API unique (sk-ghost-XXXX).
 * Les clés sont stockées dans SQLite (.laruche/api_keys.db).
 *
 * Schema: id, key_hash, tenant_id, name, plan, created_at, last_used,
 *         requests_today, requests_total, is_active
 */
import { createHash, randomBytes } from 'crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const DB_DIR = join(ROOT, '.laruche');

// Lazy SQLite import
let _db = null;
function getDb() {
  if (_db) return _db;
  mkdirSync(DB_DIR, { recursive: true });
  try {
    const Database = (await import('better-sqlite3')).default;
    _db = new Database(join(DB_DIR, 'api_keys.db'));
    _db.exec(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        key_hash    TEXT UNIQUE NOT NULL,
        key_prefix  TEXT NOT NULL,
        tenant_id   TEXT NOT NULL,
        name        TEXT,
        plan        TEXT DEFAULT 'free',
        created_at  TEXT DEFAULT (datetime('now')),
        last_used   TEXT,
        requests_today  INTEGER DEFAULT 0,
        requests_total  INTEGER DEFAULT 0,
        reset_date  TEXT DEFAULT (date('now')),
        is_active   INTEGER DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS usage_logs (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id   TEXT NOT NULL,
        endpoint    TEXT,
        status      INTEGER,
        tokens_used INTEGER DEFAULT 0,
        duration_ms INTEGER,
        created_at  TEXT DEFAULT (datetime('now'))
      );
    `);
  } catch {
    // Fallback: in-memory Map si better-sqlite3 pas disponible
    _db = { _map: new Map(), exec() {}, prepare: () => ({ get: () => null, run: () => {}, all: () => [] }) };
  }
  return _db;
}

// Plans et limites
export const PLANS = {
  free:       { requests_per_day: 100,   missions_per_day: 10,  label: 'Free' },
  starter:    { requests_per_day: 1000,  missions_per_day: 100, label: 'Starter' },
  pro:        { requests_per_day: 10000, missions_per_day: 1000, label: 'Pro' },
  enterprise: { requests_per_day: -1,    missions_per_day: -1,  label: 'Enterprise' },
};

/**
 * Génère une nouvelle API key au format sk-ghost-XXXXXXXXXXXXXXXX
 */
export function generateApiKey() {
  const raw = randomBytes(24).toString('base64url');
  return `sk-ghost-${raw}`;
}

/**
 * Hash une API key pour stockage sécurisé (SHA-256)
 */
export function hashKey(key) {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Crée une nouvelle API key pour un tenant
 */
export async function createKey({ tenantId, name = 'Default', plan = 'free' }) {
  const db = await Promise.resolve(getDb());
  const key = generateApiKey();
  const hash = hashKey(key);
  const prefix = key.slice(0, 16); // "sk-ghost-XXXXXXX"

  try {
    db.prepare(`
      INSERT INTO api_keys (key_hash, key_prefix, tenant_id, name, plan)
      VALUES (?, ?, ?, ?, ?)
    `).run(hash, prefix, tenantId, name, plan);
  } catch {
    // Fallback in-memory
    if (db._map) db._map.set(hash, { tenantId, name, plan, is_active: 1, requests_today: 0, requests_total: 0 });
  }

  return { key, prefix, tenantId, name, plan };
}

/**
 * Valide une API key et retourne les infos du tenant
 * Retourne null si invalide
 */
export async function validateKey(rawKey) {
  if (!rawKey) return null;

  // Vérifier format sk-ghost-XXXX
  if (!rawKey.startsWith('sk-ghost-') && !rawKey.startsWith('sk-ant-')) {
    // Aussi accepter CHIMERA_SECRET pour compatibilité rétrocompatible
    const chimera = process.env.CHIMERA_SECRET;
    if (chimera && rawKey === chimera) {
      return { tenantId: 'admin', plan: 'enterprise', name: 'Admin' };
    }
    return null;
  }

  const hash = hashKey(rawKey);
  const db = await Promise.resolve(getDb());

  try {
    const row = db.prepare(`
      SELECT * FROM api_keys WHERE key_hash = ? AND is_active = 1
    `).get(hash);

    if (!row) return null;

    // Reset compteur journalier si nouveau jour
    const today = new Date().toISOString().slice(0, 10);
    if (row.reset_date !== today) {
      db.prepare(`UPDATE api_keys SET requests_today = 0, reset_date = ? WHERE key_hash = ?`)
        .run(today, hash);
      row.requests_today = 0;
    }

    // Vérifier limite plan
    const plan = PLANS[row.plan] || PLANS.free;
    if (plan.requests_per_day > 0 && row.requests_today >= plan.requests_per_day) {
      return { ...row, rate_limited: true };
    }

    // Incrémenter compteurs
    db.prepare(`
      UPDATE api_keys
      SET last_used = datetime('now'), requests_today = requests_today + 1, requests_total = requests_total + 1
      WHERE key_hash = ?
    `).run(hash);

    return { tenantId: row.tenant_id, plan: row.plan, name: row.name, requests_today: row.requests_today };
  } catch {
    if (db._map) {
      const entry = db._map.get(hash);
      return entry ? { tenantId: entry.tenantId, plan: entry.plan, name: entry.name } : null;
    }
    return null;
  }
}

/**
 * Liste les clés d'un tenant
 */
export async function listKeys(tenantId) {
  const db = await Promise.resolve(getDb());
  try {
    return db.prepare(`
      SELECT id, key_prefix, name, plan, created_at, last_used,
             requests_today, requests_total, is_active
      FROM api_keys WHERE tenant_id = ? ORDER BY created_at DESC
    `).all(tenantId);
  } catch { return []; }
}

/**
 * Révoque une API key
 */
export async function revokeKey(keyId, tenantId) {
  const db = await Promise.resolve(getDb());
  try {
    db.prepare(`UPDATE api_keys SET is_active = 0 WHERE id = ? AND tenant_id = ?`)
      .run(keyId, tenantId);
    return true;
  } catch { return false; }
}

/**
 * Log d'utilisation
 */
export async function logUsage({ tenantId, endpoint, status, tokens_used = 0, duration_ms = 0 }) {
  const db = await Promise.resolve(getDb());
  try {
    db.prepare(`
      INSERT INTO usage_logs (tenant_id, endpoint, status, tokens_used, duration_ms)
      VALUES (?, ?, ?, ?, ?)
    `).run(tenantId, endpoint, status, tokens_used, duration_ms);
  } catch { /* silent */ }
}
