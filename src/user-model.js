/**
 * src/user-model.js — Modèle utilisateur persistant
 *
 * Jarvis apprend qui est Wiaam à chaque interaction.
 * Le profil est enrichi automatiquement et injecté dans chaque prompt.
 *
 * Stockage : data/user-model.json
 * Rechargé à chaque lecture (fichier comme source de vérité).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PATH = resolve(__dirname, '../data/user-model.json');

const DEFAULT = {
  name: 'Wiaam',
  language: 'fr',
  timezone: 'Europe/Paris',
  preferences: {
    report_style: 'concis',
    response_length: 'court',
    notification_hours: { start: 8, end: 22 },
  },
  projects: ['ghost-os-ultimate', 'LaRuche'],
  priorities: [],
  patterns: {},      // { "mot_clé": { count, skill, success_rate } }
  updated_at: null,
};

let _model = null;

// ─── Lecture/Écriture ─────────────────────────────────────────────────────────

export function load() {
  try {
    if (existsSync(PATH)) {
      const raw = JSON.parse(readFileSync(PATH, 'utf-8'));
      _model = { ...DEFAULT, ...raw, preferences: { ...DEFAULT.preferences, ...raw.preferences } };
    } else {
      _model = { ...DEFAULT };
    }
  } catch {
    _model = { ...DEFAULT };
  }
  return _model;
}

export function save() {
  try {
    mkdirSync(resolve(__dirname, '../data'), { recursive: true });
    if (!_model) _model = { ...DEFAULT };
    _model.updated_at = new Date().toISOString();
    writeFileSync(PATH, JSON.stringify(_model, null, 2), 'utf-8');
  } catch { /* non critique */ }
}

function getModel() {
  if (!_model) load();
  return _model;
}

// ─── Apprentissage ─────────────────────────────────────────────────────────────

/**
 * Apprend d'une interaction réussie.
 * Incrémente les patterns pour accélérer les futures décisions.
 *
 * @param {string} input - commande utilisateur
 * @param {string} skill - skill utilisé
 * @param {boolean} success
 * @param {number} durationMs
 */
export function learn(input, skill, success, durationMs) {
  const m = getModel();
  // Clé : 3 premiers mots normalisés
  const key = input.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .trim()
    .split(' ')
    .slice(0, 3)
    .join('_');

  if (!key || key.length < 3) return;

  if (!m.patterns[key]) {
    m.patterns[key] = { count: 0, skill: skill || 'unknown', success_rate: 0, avg_ms: 0 };
  }
  const p = m.patterns[key];
  p.count++;
  p.success_rate = ((p.success_rate * (p.count - 1)) + (success ? 1 : 0)) / p.count;
  p.avg_ms = ((p.avg_ms * (p.count - 1)) + (durationMs || 0)) / p.count;
  if (skill) p.skill = skill;

  // Garder max 200 patterns
  const entries = Object.entries(m.patterns);
  if (entries.length > 200) {
    const sorted = entries.sort(([, a], [, b]) => a.count - b.count);
    m.patterns = Object.fromEntries(sorted.slice(-200));
  }

  save();
}

// ─── Mise à jour manuelle ─────────────────────────────────────────────────────

/**
 * Met à jour des champs du profil utilisateur.
 * @param {Partial<typeof DEFAULT>} data
 */
export function update(data) {
  const m = getModel();
  Object.assign(m, data);
  save();
}

// ─── Contexte pour injection dans les prompts ────────────────────────────────

/**
 * Retourne une ligne de contexte compacte à injecter dans les prompts Queen.
 * Ex: "Wiaam | Projets: ghost-os,LaRuche | Habitudes: screenshot(12x→take_screenshot)"
 *
 * @returns {string}
 */
export function toContext() {
  const m = getModel();
  const parts = [];

  if (m.name) parts.push(`Utilisateur: ${m.name}`);
  if (m.priorities?.length) parts.push(`Priorités: ${m.priorities.slice(0, 3).join(', ')}`);
  if (m.projects?.length)   parts.push(`Projets: ${m.projects.slice(0, 3).join(', ')}`);

  // Top 5 patterns par fréquence
  const top = Object.entries(m.patterns)
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 5)
    .map(([k, v]) => `${k}(${v.count}x→${v.skill})`);
  if (top.length) parts.push(`Habitudes: ${top.join(', ')}`);

  return parts.join(' | ');
}

// ─── Init ─────────────────────────────────────────────────────────────────────

// Charger au démarrage du module
load();
