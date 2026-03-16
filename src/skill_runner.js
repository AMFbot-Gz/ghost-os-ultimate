/**
 * skill_runner.js — Runner de Skills LaRuche
 * Exécute un skill et peut en générer un nouveau si manquant
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "fs";
import { join, dirname, resolve } from "path";
import { pathToFileURL, fileURLToPath } from "url";
import { ask } from "./model_router.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SKILLS_DIR = join(ROOT, "skills");

/**
 * Import dynamique avec cache busting par mtime.
 * Garantit que les skills mis à jour (auto-évolution) sont rechargés sans redémarrage.
 */
async function importFresh(filePath) {
  const mtime = statSync(filePath).mtimeMs;
  const url = `${pathToFileURL(resolve(filePath)).href}?v=${mtime}`;
  return import(url);
}

export async function runSkill(skillName, params = {}) {
  const skillDir = join(SKILLS_DIR, skillName);
  const skillFile = join(skillDir, "skill.js");

  if (!existsSync(skillFile)) {
    throw new Error(`Skill "${skillName}" introuvable. Créez-le: laruche skill create "${skillName}"`);
  }

  const { run } = await importFresh(skillFile);
  return await run(params);
}

export async function generateAndRun(description, params = {}) {
  // Générer le skill à la volée
  const skillName = description.toLowerCase().replace(/[^a-z0-9]+/g, "_").substring(0, 25);
  const skillDir = join(SKILLS_DIR, skillName);

  if (!existsSync(skillDir)) {
    mkdirSync(skillDir, { recursive: true });

    const result = await ask(
      `Génère un skill JavaScript pour: ${description}\n\nexport async function run(params) { ... }`,
      { role: "architect", temperature: 0.1 }
    );

    writeFileSync(join(skillDir, "skill.js"), result.text);
    writeFileSync(join(skillDir, "manifest.json"), JSON.stringify({
      name: skillName, description, version: "1.0.0",
      model: result.model, created: new Date().toISOString(), auto_generated: true,
    }, null, 2));
  }

  return runSkill(skillName, params);
}

export function listSkills() {
  if (!existsSync(SKILLS_DIR)) return [];
  return readdirSync(SKILLS_DIR)
    .filter((d) => { try { return statSync(join(SKILLS_DIR, d)).isDirectory(); } catch { return false; } })
    .map((d) => {
      try { return JSON.parse(readFileSync(join(SKILLS_DIR, d, "manifest.json"), "utf-8")); }
      catch { return { name: d }; }
    });
}
