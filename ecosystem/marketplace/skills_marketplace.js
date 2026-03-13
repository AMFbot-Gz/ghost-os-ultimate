/**
 * ecosystem/marketplace/skills_marketplace.js
 * Ghost OS Ultimate — Marketplace de skills
 *
 * Recherche, validation, installation et publication de skills.
 * Compatible avec le format manifest.json des skills PICO-RUCHE/LaRuche.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, cpSync } from 'fs';
import { join, basename } from 'path';
import { execSync } from 'child_process';

const REGISTRY_FILE = '.laruche/registry.json';

export class SkillsMarketplace {
  constructor(options = {}) {
    this.skills_dir    = options.skills_dir    || 'skills';
    this.registry_file = options.registry_file || REGISTRY_FILE;
    this._registry     = this._loadRegistry();
    this._validator    = new SkillValidator();
  }

  // ─── Recherche ─────────────────────────────────────────────────────────────

  search(query, filters = {}) {
    const q = query.toLowerCase();
    let results = this._registry.skills || [];

    // Filtre par texte
    if (q) {
      results = results.filter(s =>
        s.name.toLowerCase().includes(q) ||
        (s.description || '').toLowerCase().includes(q)
      );
    }

    // Filtre par tier
    if (filters.tier) {
      results = results.filter(s => s.tier === filters.tier);
    }

    // Filtre par version min
    if (filters.version_min) {
      results = results.filter(s => this._versionGte(s.version, filters.version_min));
    }

    return results.map(s => ({ ...s, _installed: this._isInstalled(s.name) }));
  }

  listInstalled() {
    if (!existsSync(this.skills_dir)) return [];
    return readdirSync(this.skills_dir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => {
        const manifest_path = join(this.skills_dir, d.name, 'manifest.json');
        if (!existsSync(manifest_path)) return null;
        try {
          return JSON.parse(readFileSync(manifest_path, 'utf-8'));
        } catch { return { name: d.name }; }
      })
      .filter(Boolean);
  }

  // ─── Installation / suppression ────────────────────────────────────────────

  async install(skill_id, source = null) {
    // Validation de sécurité
    const validation = this._validator.validate({ name: skill_id, source });
    if (!validation.valid) {
      return { success: false, errors: validation.errors };
    }

    // Vérifie si déjà installé
    if (this._isInstalled(skill_id)) {
      return { success: true, message: `${skill_id} déjà installé`, skipped: true };
    }

    const target_dir = join(this.skills_dir, skill_id);

    try {
      if (source && existsSync(source)) {
        // Copie locale
        mkdirSync(target_dir, { recursive: true });
        cpSync(source, target_dir, { recursive: true });
      } else {
        // Stub — dans une vraie implémentation, téléchargerait depuis le registry
        mkdirSync(target_dir, { recursive: true });
        writeFileSync(join(target_dir, 'manifest.json'), JSON.stringify({
          name: skill_id, version: '0.0.1', description: 'Skill installé depuis marketplace',
        }, null, 2));
        writeFileSync(join(target_dir, 'skill.js'),
          `export async function run(params) {\n  return { success: true, skill: '${skill_id}' };\n}\n`
        );
      }

      // Met à jour le registry
      this._addToRegistry(skill_id);

      return { success: true, skill: skill_id, path: target_dir };
    } catch (err) {
      return { success: false, skill: skill_id, error: err.message };
    }
  }

  uninstall(skill_id) {
    const skill_dir = join(this.skills_dir, skill_id);
    if (!existsSync(skill_dir)) {
      return { success: false, error: `Skill ${skill_id} non trouvé` };
    }

    try {
      execSync(`rm -rf "${skill_dir}"`, { timeout: 10_000 });
      this._removeFromRegistry(skill_id);
      return { success: true, skill: skill_id };
    } catch (err) {
      return { success: false, skill: skill_id, error: err.message };
    }
  }

  // ─── Publication ──────────────────────────────────────────────────────────

  publish(skill_dir) {
    const manifest_path = join(skill_dir, 'manifest.json');
    const skill_js_path = join(skill_dir, 'skill.js');

    if (!existsSync(manifest_path)) {
      return { success: false, error: 'manifest.json manquant' };
    }
    if (!existsSync(skill_js_path)) {
      return { success: false, error: 'skill.js manquant' };
    }

    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifest_path, 'utf-8'));
    } catch (err) {
      return { success: false, error: `manifest.json invalide: ${err.message}` };
    }

    const validation = this._validator.validateManifest(manifest);
    if (!validation.valid) {
      return { success: false, errors: validation.errors };
    }

    // Enregistrement local (dans une vraie implémentation, publierait vers le registry central)
    this._addToRegistry(manifest.name, manifest);

    return { success: true, skill: manifest.name, version: manifest.version };
  }

  // ─── Stats ────────────────────────────────────────────────────────────────

  getStats() {
    const installed = this.listInstalled();
    return {
      total_registered: (this._registry.skills || []).length,
      installed:        installed.length,
      registry_version: this._registry.version || '1.0.0',
      last_updated:     this._registry.lastUpdated,
    };
  }

  // ─── Helpers privés ───────────────────────────────────────────────────────

  _loadRegistry() {
    if (existsSync(this.registry_file)) {
      try { return JSON.parse(readFileSync(this.registry_file, 'utf-8')); }
      catch { /* corrupted */ }
    }
    // Fallback : charge depuis skills/registry.json
    const local = 'skills/registry.json';
    if (existsSync(local)) {
      try { return JSON.parse(readFileSync(local, 'utf-8')); }
      catch { /* corrupted */ }
    }
    return { version: '1.0.0', skills: [], lastUpdated: new Date().toISOString() };
  }

  _saveRegistry() {
    const dir = this.registry_file.split('/').slice(0, -1).join('/');
    if (dir) mkdirSync(dir, { recursive: true });
    writeFileSync(this.registry_file, JSON.stringify(this._registry, null, 2));
  }

  _addToRegistry(name, manifest = null) {
    if (!this._registry.skills) this._registry.skills = [];
    const existing = this._registry.skills.findIndex(s => s.name === name);
    const entry = manifest || { name, added_at: new Date().toISOString() };
    if (existing >= 0) {
      this._registry.skills[existing] = entry;
    } else {
      this._registry.skills.push(entry);
    }
    this._registry.lastUpdated = new Date().toISOString();
    this._saveRegistry();
  }

  _removeFromRegistry(name) {
    this._registry.skills = (this._registry.skills || []).filter(s => s.name !== name);
    this._registry.lastUpdated = new Date().toISOString();
    this._saveRegistry();
  }

  _isInstalled(name) {
    return existsSync(join(this.skills_dir, name));
  }

  _versionGte(v1, v2) {
    const p1 = (v1 || '0.0.0').split('.').map(Number);
    const p2 = (v2 || '0.0.0').split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if ((p1[i] || 0) > (p2[i] || 0)) return true;
      if ((p1[i] || 0) < (p2[i] || 0)) return false;
    }
    return true;
  }
}

// ─── SkillValidator ─────────────────────────────────────────────────────────

class SkillValidator {
  validate(skill) {
    const errors = [];
    if (!skill.name || !/^[a-z0-9_]+$/.test(skill.name)) {
      errors.push('name doit être snake_case alphanumérique');
    }
    return { valid: errors.length === 0, errors };
  }

  validateManifest(manifest) {
    const errors = [];
    if (!manifest.name)        errors.push('name requis');
    if (!manifest.version)     errors.push('version requise (format x.y.z)');
    if (!manifest.description) errors.push('description requise');

    // Vérifie le format semver simplifié
    if (manifest.version && !/^\d+\.\d+\.\d+/.test(manifest.version)) {
      errors.push('version doit être au format semver (ex: 1.0.0)');
    }

    return { valid: errors.length === 0, errors };
  }
}
