/**
 * skillLoader.js — Chargeur de skills runtime (version JS) v4.1
 * 4 niveaux de priorité: workspace/skills/ > .laruche/skills/ > skills/ > builtins
 * Cache 30s, scoring de pertinence par mots-clés/tags/description
 */
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

// ─── Builtins (priorité 4 — fallback) ─────────────────────────────────────────────────
const BUILTIN_SKILLS = [
  { name: 'open_safari',       description: "Ouvre l'application Safari sur macOS",             tags: ['browser','macos','navigation'] },
  { name: 'open_browser',      description: 'Ouvre un navigateur web (Safari ou Chrome)',        tags: ['browser','navigation'] },
  { name: 'go_to_youtube',     description: 'Navigue vers YouTube dans le navigateur ouvert',    tags: ['browser','youtube','music'] },
  { name: 'search_youtube',    description: 'Recherche une vidéo ou playlist sur YouTube',       tags: ['youtube','search','music'] },
  { name: 'play_first_result', description: 'Clique sur le premier résultat YouTube pour jouer', tags: ['youtube','play','music'] },
  { name: 'open_app',          description: 'Ouvre une application macOS par son nom',           tags: ['macos','apps'] },
  { name: 'focus_app',         description: 'Met le focus sur une application déjà ouverte',     tags: ['macos','apps'] },
  { name: 'goto_url',          description: 'Navigue vers une URL dans le navigateur',           tags: ['browser','navigation'] },
  { name: 'click_element',     description: 'Clique sur un élément de la page web',             tags: ['browser','interaction'] },
  { name: 'fill_field',        description: 'Remplit un champ de formulaire web',               tags: ['browser','form'] },
  { name: 'press_key',         description: 'Appuie sur une touche clavier',                    tags: ['keyboard','interaction'] },
  { name: 'take_screenshot',   description: "Prend une capture d'écran",                        tags: ['vision','screenshot'] },
  { name: 'extract_text',      description: "Extrait le texte visible d'une page web",          tags: ['browser','extraction'] },
  { name: 'run_command',       description: 'Exécute une commande terminal',                    tags: ['terminal','devops'] },
  { name: 'type_text',         description: 'Tape du texte dans le champ actif',                tags: ['keyboard','input'] },
  { name: 'press_enter',       description: 'Appuie sur la touche Entrée',                     tags: ['keyboard'] },
  { name: 'open_vscode',       description: 'Ouvre Visual Studio Code',                        tags: ['dev','ide','vscode'] },
  { name: 'google_search',     description: 'Effectue une recherche Google',                    tags: ['browser','search','google'] },
  { name: 'code_generation',   description: 'Génère du code selon une description',             tags: ['dev','code','generation'] },
  { name: 'run_code',          description: 'Exécute du code dans un terminal',                 tags: ['dev','terminal','execution'] },
  { name: 'close_app',         description: 'Ferme une application macOS',                      tags: ['macos','apps'] },
  { name: 'devops_logs',       description: "Consulte les logs d'un service ou d'une app",      tags: ['devops','logs','monitoring'] },
  { name: 'manage_projects',   description: 'Gère les projets et dossiers de développement',    tags: ['dev','projects','files'] },
];

// ─── Cache ────────────────────────────────────────────────────────────────────────────
let _cache = null;
let _cacheTs = 0;
const CACHE_TTL_MS = 300_000 // 5 min;

// ─── Parser YAML frontmatter minimaliste ─────────────────────────────────────────────────
function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const lines = match[1].split('\n');
  const result = {};
  for (const line of lines) {
    const [key, ...rest] = line.split(':');
    if (!key?.trim()) continue;
    const val = rest.join(':').trim();
    if (val.startsWith('[') && val.endsWith(']')) {
      result[key.trim()] = val.slice(1, -1).split(',').map(t => t.trim().replace(/['"]/g, ''));
    } else {
      result[key.trim()] = val.replace(/^['"]|['"]$/g, '');
    }
  }
  return result;
}

// ─── Scanner d'un répertoire skills ────────────────────────────────────────────────────
function scanSkillsDir(dir, priority) {
  if (!existsSync(dir)) return [];
  const skills = [];
  for (const name of readdirSync(dir)) {
    const mdPath = join(dir, name, 'SKILL.md');
    const indexPath = join(dir, name, 'index.js');
    if (!existsSync(mdPath)) continue;
    try {
      const raw = readFileSync(mdPath, 'utf-8');
      const fm = parseFrontmatter(raw);
      skills.push({
        name: fm.name || name,
        description: fm.description || name,
        tags: Array.isArray(fm.tags) ? fm.tags : [],
        version: fm.version || '1.0.0',
        priority,
        indexPath: existsSync(indexPath) ? indexPath : null,
        mdPath,
      });
    } catch { /* skip */ }
  }
  return skills;
}

// ─── Chargement complet ────────────────────────────────────────────────────────────
function loadAllSkills() {
  if (_cache && Date.now() - _cacheTs < CACHE_TTL_MS) return _cache;

  const p1 = scanSkillsDir(join(ROOT, 'workspace/skills'), 1);
  const p2 = scanSkillsDir(join(ROOT, '.laruche/skills'), 2);
  const p3 = scanSkillsDir(join(ROOT, 'skills'), 3);

  // Builtins priorité 4 — seulement si pas déjà définis par les niveaux supérieurs
  const seen = new Set([...p1, ...p2, ...p3].map(s => s.name));
  const p4 = BUILTIN_SKILLS
    .filter(b => !seen.has(b.name))
    .map(b => ({ ...b, priority: 4, indexPath: null, mdPath: null }));

  _cache = [...p1, ...p2, ...p3, ...p4];
  _cacheTs = Date.now();
  return _cache;
}

// ─── Scoring de pertinence ─────────────────────────────────────────────────────────────
function scoreSkill(skill, intentWords) {
  let score = 0;
  const name = skill.name.toLowerCase();
  const desc = skill.description.toLowerCase();
  const tags = skill.tags.map(t => t.toLowerCase());
  for (const word of intentWords) {
    if (tags.includes(word)) score += 3;       // +3 tag exact
    if (name.includes(word)) score += 2;       // +2 dans le nom
    if (desc.includes(word)) score += 1;       // +1 dans la description
  }
  score += (5 - (skill.priority || 4));        // bonus priorité (p1 > p4)
  return score;
}

// ─── API publique ─────────────────────────────────────────────────────────────────────

/** Retourne tous les skills chargés. */
export function getAllSkills() {
  return loadAllSkills();
}

/** Retourne un skill par son nom. */
export function getSkill(name) {
  return loadAllSkills().find(s => s.name === name) || null;
}

/**
 * Retourne les N skills les plus pertinents pour une intention.
 * @param {string} intent
 * @param {number} [max=15]
 */
export function getRelevantSkills(intent, max = 15) {
  const words = intent.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  return loadAllSkills()
    .map(s => ({ ...s, _score: scoreSkill(s, words) }))
    .sort((a, b) => b._score - a._score)
    .slice(0, max);
}

/** Invalide le cache (force rechargement). */
export function reloadSkills() {
  _cache = null;
  _cacheTs = 0;
  return loadAllSkills();
}

/**
 * Formate les skills en liste pour un prompt LLM.
 * @param {object[]} skills
 * @returns {string}
 */
export function formatSkillsForPrompt(skills) {
  return skills
    .map(s => `- ${s.name}: ${s.description}${s.tags.length ? ` [${s.tags.join(', ')}]` : ''}`)
    .join('\n');
}
