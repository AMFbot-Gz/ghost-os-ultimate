#!/usr/bin/env node
/**
 * laruche-skill-runner.js — Exécuteur de skill standalone
 * Usage: laruche-skill-runner <skill-name> [--args '{"key":"value"}']
 */

import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, readFileSync } from "fs";
import chalk from "chalk";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const skillName = process.argv[2];
const argsIdx = process.argv.indexOf("--args");
const argsRaw = argsIdx >= 0 ? process.argv[argsIdx + 1] : "{}";

if (!skillName) {
  console.log(chalk.red("Usage: laruche-skill-runner <skill-name> [--args '{...}']"));
  process.exit(1);
}

const skillDir = join(ROOT, "skills", skillName);
const skillFile = join(skillDir, "skill.js");

if (!existsSync(skillFile)) {
  console.log(chalk.red(`Skill non trouvé: ${skillName}`));
  console.log(chalk.dim(`Cherché dans: ${skillDir}`));
  process.exit(1);
}

let args = {};
try { args = JSON.parse(argsRaw); } catch { args = {}; }

const manifest = existsSync(join(skillDir, "manifest.json"))
  ? JSON.parse(readFileSync(join(skillDir, "manifest.json"), "utf-8"))
  : {};

console.log(chalk.hex("#F5A623")(`🐝 LaRuche Skill Runner`));
console.log(chalk.dim(`Skill: ${skillName} v${manifest.version || "1.0.0"}`));
console.log(chalk.dim(`Args:  ${JSON.stringify(args)}\n`));

try {
  const { run } = await import(skillFile);
  const result = await run(args);
  console.log(chalk.green("✓ Résultat:"), result);
} catch (e) {
  console.log(chalk.red("✗ Erreur:"), e.message);
  process.exit(1);
}
