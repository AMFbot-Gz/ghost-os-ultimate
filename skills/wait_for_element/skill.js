/**
 * wait_for_element — Attend l'apparition d'un élément UI (polling AX tree)
 */
import { execFile } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const execFileAsync = promisify(execFile);

export async function run({ query = "", timeout = 10, interval = 0.5, app = "" } = {}) {
  if (!query) {
    return { success: false, error: "Paramètre 'query' requis" };
  }

  const args = [
    "src/accessibility.py", "wait_for_element",
    "--query", query,
    "--timeout", String(timeout),
  ];
  if (app) args.push("--app", app);

  try {
    const { stdout, stderr } = await execFileAsync("python3", args, {
      cwd: ROOT,
      timeout: (timeout + 5) * 1000,  // timeout JS légèrement supérieur
      env: { ...process.env },
    });

    const raw = stdout.trim();
    if (!raw) {
      return { success: false, error: stderr?.trim() || "Pas de réponse" };
    }

    const data = JSON.parse(raw);
    return {
      success: data.success === true && data.found === true,
      found: data.found,
      query,
      element: data.element || null,
      elapsed: data.elapsed || null,
      message: data.found
        ? `Élément "${query}" trouvé en ${data.elapsed?.toFixed(1)}s`
        : `Timeout: "${query}" non apparu après ${timeout}s`,
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
