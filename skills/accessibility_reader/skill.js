/**
 * accessibility_reader — Lit l'arbre AX macOS via accessibility.py
 * Open Source: macOS AXUIElement API (System Events osascript)
 */
import { execFile } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const execFileAsync = promisify(execFile);

export async function run({ app = "", roles = [] } = {}) {
  const args = ["src/accessibility.py", "read_elements"];
  if (app) args.push("--app", app);

  try {
    const { stdout, stderr } = await execFileAsync("python3", args, {
      cwd: ROOT,
      timeout: 15000,
      env: { ...process.env },
    });

    const raw = stdout.trim();
    if (!raw) {
      return { success: false, error: stderr?.trim() || "Pas de réponse AX" };
    }

    const data = JSON.parse(raw);
    if (data.error) {
      return { success: false, error: data.error, app: data.app };
    }

    // Filtrer par rôle si demandé
    const elements = roles.length > 0
      ? data.elements.filter(e => roles.includes(e.role))
      : data.elements;

    return {
      success: true,
      app: data.app,
      elements,
      elements_count: elements.length,
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
