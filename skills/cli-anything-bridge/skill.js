/**
 * skills/cli-anything-bridge/skill.js
 *
 * Permet d'utiliser CLI-Anything depuis Telegram.
 * Détecte les packages cli-anything-* installés via pip.
 * Pour chaque package trouvé : crée automatiquement un skill dans skills/
 * Si aucun package : retourne les instructions + apps /Applications/ disponibles.
 *
 * Exemples Telegram :
 *   "rends LibreOffice agent-native"
 *   "génère un cli pour /Applications/GIMP.app"
 *   "cli-anything status"
 *   "quelles apps peuvent devenir des skills ?"
 */

import { execSync, spawnSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(__dirname, '..');

export async function run({ action = 'status', app = '', timeout = 15000 } = {}) {
  switch (action) {

    // ── Lister les packages cli-anything installés ─────────────────────────
    case 'status':
    case 'list': {
      let installed = [];
      try {
        const out = execSync('pip3 list 2>/dev/null | grep -i cli-anything-', {
          encoding: 'utf-8',
          timeout: 8000,
        });
        installed = out.trim().split('\n')
          .filter(Boolean)
          .map(l => l.split(/\s+/)[0].toLowerCase());
      } catch { /* pip3 non disponible ou aucun package */ }

      // Lister les apps /Applications/
      let appsInstalled = [];
      try {
        appsInstalled = readdirSync('/Applications')
          .filter(f => f.endsWith('.app'))
          .map(f => f.replace('.app', ''));
      } catch { /* /Applications non lisible */ }

      // Lister les skills déjà générés
      const generatedSkills = [];
      try {
        for (const d of readdirSync(SKILLS_DIR, { withFileTypes: true })) {
          if (d.isDirectory() && d.name.startsWith('cli-') && d.name !== 'cli-anything-bridge') {
            generatedSkills.push(d.name);
          }
        }
      } catch { /* non-fatal */ }

      return {
        success: true,
        pip_packages: installed,
        apps_available: appsInstalled.slice(0, 15),
        generated_skills: generatedSkills,
        instructions: installed.length === 0
          ? 'Aucun CLI-Anything installé.\n\nPour générer un CLI :\n' +
            '1. Installe l\'app cible dans /Applications/\n' +
            '2. Dans Claude Code: /plugin marketplace add HKUDS/CLI-Anything\n' +
            '3. /cli-anything /Applications/LibreOffice.app\n' +
            '4. pip3 install cli-anything-libreoffice\n' +
            '5. "génère les skills cli-anything" depuis Telegram'
          : `${installed.length} package(s) trouvé(s). Lance "génère les skills" pour les activer.`,
      };
    }

    // ── Générer les skills depuis les packages installés ──────────────────
    case 'generate': {
      let installed = [];
      try {
        const out = execSync('pip3 list 2>/dev/null | grep -i cli-anything-', {
          encoding: 'utf-8',
          timeout: 8000,
        });
        installed = out.trim().split('\n')
          .filter(Boolean)
          .map(l => l.split(/\s+/)[0].toLowerCase())
          .filter(p => p.startsWith('cli-anything-'));
      } catch { /* aucun */ }

      if (installed.length === 0) {
        return { success: false, error: 'Aucun package cli-anything-* installé via pip3' };
      }

      const created = [];
      for (const pkg of installed) {
        const appName = pkg.replace('cli-anything-', '');
        const skillDir = join(SKILLS_DIR, `cli-${appName}`);

        if (existsSync(skillDir)) {
          created.push({ name: `cli-${appName}`, status: 'already_exists' });
          continue;
        }

        mkdirSync(skillDir, { recursive: true });

        // skill.js générique qui appelle le CLI pip en --json mode
        writeFileSync(join(skillDir, 'skill.js'), `/**
 * Skill auto-généré par CLI-Anything pour ${appName}
 * Package pip : ${pkg}
 */
import { spawnSync } from 'child_process';

export async function run({ command = 'help', args = [], json = true, timeout = 30000 } = {}) {
  const fullArgs = json ? ['--json', command, ...args] : [command, ...args];
  const result = spawnSync('${pkg}', fullArgs, { encoding: 'utf-8', timeout });
  if (result.error) return { success: false, error: result.error.message };
  let parsed = result.stdout || '';
  if (json) { try { parsed = JSON.parse(parsed); } catch { /* keep string */ } }
  return { success: result.status === 0, command, result: parsed, error: result.stderr?.slice(0, 300) };
}
`);

        // manifest.json
        writeFileSync(join(skillDir, 'manifest.json'), JSON.stringify({
          name: `cli-${appName}`,
          description: `Contrôle ${appName} via CLI-Anything`,
          version: '1.0.0',
          category: 'cli-anything',
          tier: 'community',
          tags: [appName, 'cli-anything', 'app-control'],
          triggers: [appName, `ouvre ${appName}`, `utilise ${appName}`, `lance ${appName}`],
          cliPackage: pkg,
          generated: new Date().toISOString(),
        }, null, 2));

        created.push({ name: `cli-${appName}`, status: 'created' });
      }

      // Recharger le registry dynamiquement
      try {
        const { default: reg } = await import('../src/skill-registry.js');
        await reg.autoload(SKILLS_DIR);
      } catch { /* registry optionnel */ }

      return {
        success: true,
        created,
        message: `${created.filter(c => c.status === 'created').length} skill(s) créé(s)`,
      };
    }

    // ── Appeler un CLI-Anything spécifique ─────────────────────────────────
    case 'run': {
      if (!app) return { success: false, error: 'app requis pour run (ex: libreoffice)' };
      const pkg = `cli-anything-${app.toLowerCase()}`;
      const result = spawnSync(pkg, ['--json', 'help'], { encoding: 'utf-8', timeout });
      return {
        success: result.status === 0,
        app,
        output: result.stdout?.slice(0, 500) || result.stderr?.slice(0, 300) || 'Aucune sortie',
      };
    }

    default:
      return { success: false, error: `Action inconnue: ${action}. Valides: status, list, generate, run` };
  }
}
