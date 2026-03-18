/**
 * src/skill-registry.js — Registry dynamique de skills (inspiré OpenJarvis)
 *
 * Remplace le chargement statique de skills/registry.json.
 * Auto-découverte au démarrage : scanne skills/, charge chaque dossier
 * qui contient skill.js + manifest.json. Index les triggers en Map O(1).
 * Persistance sur disque après chaque autoload.
 *
 * Usage :
 *   import registry from './skill-registry.js';
 *   await registry.autoload('./skills');
 *   const skill = registry.match('trie mes emails'); // { name, manifest, path }
 *   console.log(registry.count());
 */

import { readdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── État interne ─────────────────────────────────────────────────────────────

/** @type {Map<string, {name, manifest, path, module?: object}>} */
const _skills = new Map();

/**
 * Index des triggers → nom du skill.
 * Clé : trigger normalisé (lowercase, sans accents).
 * Valeur : nom du skill.
 * @type {Map<string, string>}
 */
const _triggerIndex = new Map();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalize(s) {
  return s.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['']/g, ' ')
    .trim();
}

function indexSkill(name, manifest) {
  const triggers = manifest.triggers || [];
  for (const t of triggers) {
    _triggerIndex.set(normalize(t), name);
  }
  // Indexe aussi le nom lui-même
  _triggerIndex.set(normalize(name), name);
  // Indexe les tags
  for (const tag of (manifest.tags || [])) {
    _triggerIndex.set(normalize(tag), name);
  }
}

// ─── API publique ─────────────────────────────────────────────────────────────

const registry = {
  /**
   * Scanne un répertoire de skills et charge tous les skills valides.
   * Un skill valide = dossier contenant skill.js + manifest.json.
   * Persist registry.json sur disque après chargement.
   *
   * @param {string} skillsDir — chemin absolu ou relatif vers skills/
   * @returns {Promise<number>} nombre de skills chargés
   */
  async autoload(skillsDir) {
    const dir = resolve(process.cwd(), skillsDir);
    if (!existsSync(dir)) {
      console.warn(`[Registry] Dossier introuvable: ${dir}`);
      return 0;
    }

    let loaded = 0;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return 0;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillDir  = join(dir, entry.name);
      const skillPath = join(skillDir, 'skill.js');
      const manifestPath = join(skillDir, 'manifest.json');

      // Vérifie la présence des deux fichiers requis
      if (!existsSync(skillPath) || !existsSync(manifestPath)) continue;

      let manifest;
      try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      } catch {
        continue; // manifest corrompu → skip
      }

      const name = manifest.name || entry.name;
      _skills.set(name, { name, manifest, path: skillDir });
      indexSkill(name, manifest);
      loaded++;
    }

    console.log(`[Registry] ${loaded} skills chargés depuis ${dir}`);
    this._persist(dir);
    return loaded;
  },

  /**
   * Recherche le skill le plus pertinent pour un texte.
   * Stratégie : exact > contains. O(n) sur les triggers, O(1) sur les exactes.
   *
   * @param {string} text
   * @returns {{ name: string, manifest: object, path: string } | null}
   */
  match(text) {
    const msg = normalize(text);

    // 1. Exact match sur l'index
    if (_triggerIndex.has(msg)) {
      const name = _triggerIndex.get(msg);
      return _skills.get(name) || null;
    }

    // 2. Contains : cherche quel trigger est contenu dans le message
    let bestMatch = null;
    let bestLen = 0;
    for (const [trigger, skillName] of _triggerIndex) {
      if (trigger.length > bestLen && msg.includes(trigger)) {
        bestLen = trigger.length;
        bestMatch = skillName;
      }
    }
    return bestMatch ? (_skills.get(bestMatch) || null) : null;
  },

  /**
   * Retourne un skill par son nom exact.
   * @param {string} name
   * @returns {{ name, manifest, path } | undefined}
   */
  get(name) {
    return _skills.get(name);
  },

  /**
   * Retourne la liste de tous les skills chargés.
   * @returns {Array<{name, manifest, path}>}
   */
  list() {
    return Array.from(_skills.values());
  },

  /** Nombre de skills chargés. */
  count() {
    return _skills.size;
  },

  /**
   * Ajoute ou met à jour un skill dynamiquement (après création CLI-Anything).
   * @param {string} name
   * @param {object} manifest
   * @param {string} skillPath
   */
  register(name, manifest, skillPath) {
    _skills.set(name, { name, manifest, path: skillPath });
    indexSkill(name, manifest);
  },

  /**
   * Persiste l'état courant dans skills/registry.json.
   * @param {string} [skillsDir]
   */
  _persist(skillsDir) {
    try {
      const registryPath = join(skillsDir || resolve(process.cwd(), 'skills'), 'registry.json');
      const data = {
        version: '2.0.0',
        generated: new Date().toISOString(),
        count: _skills.size,
        skills: Array.from(_skills.values()).map(({ name, manifest }) => ({
          name,
          description: manifest.description || '',
          version:     manifest.version || '1.0.0',
          category:    manifest.category || manifest.tier || 'core',
          tags:        manifest.tags || [],
          triggers:    manifest.triggers || [],
        })),
      };
      writeFileSync(registryPath, JSON.stringify(data, null, 2));
    } catch { /* non-fatal */ }
  },
};

export default registry;
