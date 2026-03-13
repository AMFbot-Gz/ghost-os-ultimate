/**
 * find_element — Trouve un élément UI par description sémantique
 *
 * Stratégie à 2 couches :
 * 1. AX Tree (accessibility.py) — rapide, 100% fiable pour apps natives macOS
 * 2. Fallback LLaVA (vision.py) — pour apps web, canvas, jeux, UI non-standard
 */
import { execFile } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const execFileAsync = promisify(execFile);

async function findViaAX(query, app, threshold) {
  const args = [
    "src/accessibility.py", "find_element",
    "--query", query,
    "--threshold", String(threshold),
  ];
  if (app) args.push("--app", app);

  const { stdout } = await execFileAsync("python3", args, {
    cwd: ROOT, timeout: 12000, env: { ...process.env },
  });
  return JSON.parse(stdout.trim());
}

async function findViaVision(query) {
  // Fallback LLaVA : analyse l'écran pour trouver l'élément visuellement
  const args = [
    "src/vision.py",
    "--fn", "find_element",
    "--args", JSON.stringify({ description: query }),
  ];
  const { stdout } = await execFileAsync("python3", args, {
    cwd: ROOT, timeout: 30000, env: { ...process.env },
  });
  const raw = stdout.trim();
  if (!raw) return null;
  const data = JSON.parse(raw);
  if (data.found && data.x != null && data.y != null) {
    return {
      found: true,
      title: query,
      role: "vision",
      x: data.x,
      y: data.y,
      confidence: data.confidence || 0.7,
      source: "llava",
    };
  }
  return null;
}

export async function run({ query = "", app = "", threshold = 0.3, vision_fallback = true } = {}) {
  if (!query) {
    return { success: false, error: "Paramètre 'query' requis" };
  }

  // 1. Tentative via AX tree (rapide, 0 GPU)
  try {
    const data = await findViaAX(query, app, threshold);

    if (data.found === true) {
      return {
        success: true,
        found: true,
        title: data.title,
        role: data.role,
        x: data.x,
        y: data.y,
        bounds: data.bounds,
        confidence: data.confidence,
        app: data.app,
        source: "ax_tree",
      };
    }

    // AX tree ne trouve rien → fallback LLaVA si activé
    if (vision_fallback) {
      try {
        const visionResult = await findViaVision(query);
        if (visionResult) {
          return { success: true, ...visionResult };
        }
      } catch {
        // LLaVA indisponible ou timeout — on continue
      }
    }

    return {
      success: true,
      found: false,
      query,
      closest: data.best_match || null,
      closest_score: data.best_score || 0,
      message: `"${query}" non trouvé via AX tree${vision_fallback ? " ni LLaVA" : ""}. Plus proche: "${data.best_match || "aucun"}"`,
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
