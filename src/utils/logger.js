/**
 * logger.js — Logger centralisé LaRuche v4.2
 * Format JSON Winston avec rotation + child loggers corrélés par mission/agent/skill
 *
 * v4.2 (Wave 1 — logs corrélés) :
 * - createLogger(context) : logger enfant avec contexte fixe (missionId, agent, skill)
 * - Format console affiche [missionId(12)] [agent] {skill} pour corrélation immédiate
 * - Symlink /tmp/queen.log → .laruche/logs/queen.log pour compat API /api/logs
 */
import { createLogger as winstonCreateLogger, format, transports } from 'winston';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, symlinkSync, existsSync, unlinkSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '../..');
const LOG_DIR   = join(ROOT, '.laruche/logs');
mkdirSync(LOG_DIR, { recursive: true });

// Symlink /tmp/queen.log → fichier réel (compatibilité GET /api/logs)
const LOG_FILE   = join(LOG_DIR, 'queen.log');
const TMP_SYMLINK = '/tmp/queen.log';
try {
  if (existsSync(TMP_SYMLINK)) unlinkSync(TMP_SYMLINK);
  symlinkSync(LOG_FILE, TMP_SYMLINK);
} catch { /* ignoré si /tmp inaccessible ou fichier déjà correct */ }

const { combine, timestamp, printf, colorize, errors } = format;

// ─── Format console lisible avec corrélation mission/agent/skill ──────────────
const consoleFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ timestamp: ts, level, message, component, mission_id, missionId, step_id, agent, skill, stack }) => {
    // Accepte mission_id (interne) ET missionId (API)
    const mid = missionId || mission_id;
    const ctx = [
      mid        && `[${mid.slice(0, 12)}]`,
      agent      && `[${agent}]`,
      skill      && `{${skill}}`,
      component  && !agent && `[${component}]`,
      step_id    && `<${step_id}>`,
    ].filter(Boolean).join(' ');
    return `${ts} ${level}${ctx ? ' ' + ctx : ''} ${stack || message}`;
  })
);

// ─── Format JSON pour fichiers ────────────────────────────────────────────────
const jsonFormat = combine(
  timestamp(),
  errors({ stack: true }),
  format.json()
);

// ─── Logger de base ───────────────────────────────────────────────────────────
const baseLogger = winstonCreateLogger({
  level: process.env.LOG_LEVEL || 'info',
  defaultMeta: { service: 'laruche' },
  transports: [
    new transports.Console({ format: consoleFormat }),
    new transports.File({
      filename: LOG_FILE,
      format: jsonFormat,
      maxsize: parseInt(process.env.LOG_MAX_SIZE_MB || '10') * 1024 * 1024,
      maxFiles: 3,
      tailable: true,
    }),
    new transports.File({
      filename: join(LOG_DIR, 'errors.log'),
      format: jsonFormat,
      level: 'error',
      maxsize: 5 * 1024 * 1024,
      maxFiles: 2,
    }),
  ],
});

/**
 * Crée un logger enfant avec contexte fixe (corrélation missions/agents).
 * Compatible avec la spec Wave 1 : createLogger({ missionId, agent, skill })
 *
 * @param {object} context - { missionId?, agent?, skill?, component?, mission_id?, step_id? }
 * @returns {import('winston').Logger} child logger
 */
export function createLogger(context = {}) {
  return baseLogger.child(context);
}

/**
 * Crée un child logger avec contexte fixe (component, mission_id, step_id)
 * Alias conservé pour rétrocompatibilité interne.
 * @param {string} component
 * @param {string} [mission_id]
 * @param {string} [step_id]
 */
export function createContextLogger(component, mission_id, step_id) {
  return baseLogger.child({
    component,
    ...(mission_id && { mission_id }),
    ...(step_id    && { step_id }),
  });
}

export const logger = baseLogger;
export default baseLogger;
