/**
 * screen_elements — Analyse sémantique complète de l'écran
 * AX tree + infos système + groupement par rôle
 */
import { execFile } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const execFileAsync = promisify(execFile);

export async function run({ app = "" } = {}) {
  const args = ["src/accessibility.py", "screen_elements"];
  if (app) args.push("--app", app);

  try {
    const { stdout, stderr } = await execFileAsync("python3", args, {
      cwd: ROOT,
      timeout: 20000,
      env: { ...process.env },
    });

    const raw = stdout.trim();
    if (!raw) {
      return { success: false, error: stderr?.trim() || "Pas de réponse" };
    }

    const data = JSON.parse(raw);
    return { ...data, success: data.success !== false };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
