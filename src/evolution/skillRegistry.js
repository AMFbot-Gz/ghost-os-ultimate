import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY_FILE = join(__dirname, '../../data/skill_evolution_registry.json');

let _registry = null;
let _dirty = false;

function load() {
  if (_registry) return _registry;
  try { if (existsSync(REGISTRY_FILE)) { _registry = JSON.parse(readFileSync(REGISTRY_FILE, 'utf8')); return _registry; } } catch {}
  _registry = {};
  return _registry;
}

function flush() {
  if (!_dirty) return;
  try { writeFileSync(REGISTRY_FILE, JSON.stringify(_registry, null, 2), 'utf8'); _dirty = false; } catch {}
}

setInterval(flush, 60000).unref();

export function trackUsage(skillName, { success, latencyMs = 0 } = {}) {
  const r = load();
  if (!r[skillName]) r[skillName] = { skill: skillName, version: 1, usageCount: 0, successCount: 0, avgLatencyMs: 0, lastUsed: null, lastImproved: null };
  const s = r[skillName];
  s.usageCount++;
  if (success) s.successCount++;
  s.successRate = s.successCount / s.usageCount;
  s.avgLatencyMs = Math.round(0.8 * (s.avgLatencyMs || latencyMs) + 0.2 * latencyMs);
  s.lastUsed = new Date().toISOString();
  _dirty = true;
}

export function shouldImprove(skillName, minUsage = 10, minSuccessRate = 0.5) {
  const r = load();
  const s = r[skillName];
  if (!s) return false;
  return s.usageCount >= minUsage && s.successRate < minSuccessRate;
}

export function bumpVersion(skillName) {
  const r = load();
  if (r[skillName]) { r[skillName].version++; r[skillName].lastImproved = new Date().toISOString(); _dirty = true; flush(); }
}

export function getAllStats() { return Object.values(load()); }
