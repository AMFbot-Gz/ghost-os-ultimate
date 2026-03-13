// Skill: read_file — Lit un fichier et retourne son contenu
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

export async function run({ path, maxChars = 8000 }) {
  if (!path) return { success: false, error: "path requis" };
  const abs = resolve(path);
  if (!existsSync(abs)) return { success: false, error: `Fichier introuvable: ${abs}` };
  try {
    const content = readFileSync(abs, "utf-8");
    return { success: true, result: content.slice(0, maxChars), truncated: content.length > maxChars };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
