/**
 * smart_click — Clique sur un élément UI par description sémantique
 * Combine find_element (AX tree) + pyautogui.click
 */
import { execFile } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const execFileAsync = promisify(execFile);

export async function run({ query = "", app = "", double = false } = {}) {
  if (!query) {
    return { success: false, error: "Paramètre 'query' requis — ex: 'bouton Envoyer'" };
  }

  const args = [
    "src/accessibility.py", "smart_click",
    "--query", query,
  ];
  if (app) args.push("--app", app);
  if (double) args.push("--double");

  try {
    const { stdout, stderr } = await execFileAsync("python3", args, {
      cwd: ROOT,
      timeout: 15000,
      env: { ...process.env },
    });

    const raw = stdout.trim();
    if (!raw) {
      return { success: false, error: stderr?.trim() || "Pas de réponse" };
    }

    const data = JSON.parse(raw);

    if (data.success) {
      return {
        success: true,
        clicked: data.clicked,
        role: data.role,
        x: data.x,
        y: data.y,
        confidence: data.confidence,
        message: `Cliqué sur "${data.clicked}" (${data.role}) à (${data.x}, ${data.y})`,
      };
    }

    // Fallback: si query ressemble à un nom d'app, tenter open_app via AppleScript
    const APP_NAMES = new Set(['safari','chrome','firefox','terminal','finder','spotify','slack','discord','zoom','mail','notes','calendar','photos','music','xcode','figma','sketch','vscode','vs code']);
    const queryLower = query.toLowerCase().trim();
    const looksLikeApp = APP_NAMES.has(queryLower) || /^[A-Z][a-zA-Z\s]+$/.test(query.trim());

    if (looksLikeApp) {
      try {
        const appMap = { safari:'Safari', chrome:'Google Chrome', firefox:'Firefox', terminal:'Terminal', finder:'Finder', spotify:'Spotify', slack:'Slack', discord:'Discord', zoom:'Zoom', mail:'Mail', notes:'Notes', calendar:'Calendar', photos:'Photos', music:'Music', xcode:'Xcode', figma:'Figma', sketch:'Sketch', vscode:'Visual Studio Code', 'vs code':'Visual Studio Code' };
        const appName = appMap[queryLower] || query.trim();
        await execFileAsync('osascript', ['-e', `tell application "${appName}" to activate`], { timeout: 5000 });
        return { success: true, clicked: appName, role: 'application', x: 0, y: 0, confidence: 0.9, message: `Application "${appName}" activée`, source: 'open_app_fallback' };
      } catch (appErr) {
        // ignore, fall through to error
      }
    }

    return {
      success: false,
      error: data.error || `Impossible de cliquer sur "${query}"`,
      closest: data.closest?.best_match || null,
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
