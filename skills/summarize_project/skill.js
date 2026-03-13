// Skill: summarize_project — Génère un résumé de la structure d'un projet
import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { resolve, join } from "path";

export async function run({ dir = "." }) {
  const abs = resolve(dir);
  const lines = [];

  // Arbre de fichiers (profondeur 2)
  try {
    const tree = execSync(`find ${abs} -maxdepth 2 -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*"`, { encoding: "utf-8", timeout: 5000 });
    lines.push("=== Structure ===");
    lines.push(tree.trim().split("\n").slice(0, 40).join("\n"));
  } catch {}

  // package.json
  const pkg = join(abs, "package.json");
  if (existsSync(pkg)) {
    try {
      const p = JSON.parse(readFileSync(pkg, "utf-8"));
      lines.push(`\n=== Package ===\nNom: ${p.name} v${p.version}\nDescription: ${p.description || "N/A"}\nScripts: ${Object.keys(p.scripts || {}).join(", ")}`);
    } catch {}
  }

  // README résumé
  const readme = join(abs, "README.md");
  if (existsSync(readme)) {
    try {
      const r = readFileSync(readme, "utf-8");
      lines.push(`\n=== README (extrait) ===\n${r.slice(0, 1000)}`);
    } catch {}
  }

  return { success: true, result: lines.join("\n").slice(0, 5000) };
}
