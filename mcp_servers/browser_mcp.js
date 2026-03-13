/**
 * browser_mcp.js — MCP Macro Browser/OS pour LaRuche
 *
 * Actions haut niveau qui remplacent N tool calls par 1 seul appel.
 * Toutes les actions utilisent osascript (AppleScript) pour fiabilité macOS.
 *
 * Tools exposés:
 *   os.openApp(app)              — Ouvre une app macOS
 *   os.focusApp(app)             — Met le focus sur une app
 *   browser.goto(url)            — Navigation vers une URL (Safari)
 *   browser.typeInFocusedField(text) — Frappe dans le champ actif
 *   browser.pressEnter()         — Appuie sur Entrée
 *   browser.searchYouTube(query) — Macro complète: barre recherche → type → Enter
 *   browser.clickFirstYoutubeResult() — Clique sur le premier résultat vidéo
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execa } from "execa";

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── Réponse standard ─────────────────────────────────────────────────────────

function ok(data = {}) {
  return { content: [{ type: "text", text: JSON.stringify({ success: true, ...data }) }] };
}
function err(message, data = {}) {
  return { content: [{ type: "text", text: JSON.stringify({ success: false, error: message, ...data }) }] };
}

// ─── osascript helper ─────────────────────────────────────────────────────────

async function applescript(script, timeout = 10000) {
  try {
    const { stdout } = await execa("osascript", ["-e", script], { timeout, reject: false });
    return { ok: true, output: stdout.trim() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ─── MCP Server ───────────────────────────────────────────────────────────────

const server = new McpServer({ name: "laruche-browser", version: "1.0.0" });

// ── os.openApp ────────────────────────────────────────────────────────────────
server.tool(
  "os.openApp",
  { app: z.string().describe("Nom de l'application macOS (ex: Safari, Chrome, Music)") },
  async ({ app }) => {
    const r = await applescript(`tell application "${app}" to activate`);
    if (!r.ok) return err(`Impossible d'ouvrir ${app}: ${r.error}`);
    await sleep(1500); // laisser l'app s'ouvrir
    return ok({ app, message: `${app} ouvert` });
  }
);

// ── os.focusApp ───────────────────────────────────────────────────────────────
server.tool(
  "os.focusApp",
  { app: z.string() },
  async ({ app }) => {
    const r = await applescript(`tell application "${app}" to activate`);
    if (!r.ok) return err(`Focus impossible sur ${app}: ${r.error}`);
    await sleep(300);
    return ok({ app });
  }
);

// ── browser.goto ─────────────────────────────────────────────────────────────
server.tool(
  "browser.goto",
  { url: z.string().url() },
  async ({ url }) => {
    // Ouvre l'URL dans Safari (ou le navigateur par défaut si Safari absent)
    const script = `
      tell application "Safari"
        activate
        if (count of windows) is 0 then
          make new document with properties {URL:"${url}"}
        else
          set URL of current tab of front window to "${url}"
        end if
      end tell`;

    const r = await applescript(script, 8000);
    if (!r.ok) {
      // Fallback: open command
      try {
        await execa("open", ["-a", "Safari", url], { timeout: 5000 });
        await sleep(2000);
        return ok({ url, method: "open_fallback" });
      } catch (e2) {
        return err(`Navigation vers ${url} échouée: ${r.error}`);
      }
    }
    await sleep(2500); // attendre le chargement de la page
    return ok({ url });
  }
);

// ── browser.typeInFocusedField ────────────────────────────────────────────────
server.tool(
  "browser.typeInFocusedField",
  { text: z.string() },
  async ({ text }) => {
    // Frappe dans le champ actuellement focalisé via System Events
    const safeText = text.replace(/"/g, '\\"').replace(/\n/g, "\\n");
    const script = `
      tell application "System Events"
        keystroke "${safeText}"
      end tell`;

    const r = await applescript(script);
    if (!r.ok) return err(`Frappe impossible: ${r.error}`);
    await sleep(200);
    return ok({ text });
  }
);

// ── browser.pressEnter ───────────────────────────────────────────────────────
server.tool(
  "browser.pressEnter",
  {},
  async () => {
    const r = await applescript(`tell application "System Events" to key code 36`);
    if (!r.ok) return err(`Enter impossible: ${r.error}`);
    await sleep(500);
    return ok();
  }
);

// ── browser.searchYouTube ─────────────────────────────────────────────────────
// Macro : focus barre recherche → effacer → taper → Enter
server.tool(
  "browser.searchYouTube",
  { query: z.string().describe("Termes de recherche YouTube") },
  async ({ query }) => {
    const safeQuery = query.replace(/"/g, '\\"');

    // 1. Focus barre d'adresse Safari (Cmd+L) → aller sur YouTube search URL directement
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;

    const script = `
      tell application "Safari"
        activate
        if (count of windows) is 0 then
          make new document with properties {URL:"${searchUrl}"}
        else
          set URL of current tab of front window to "${searchUrl}"
        end if
      end tell`;

    const r = await applescript(script, 8000);
    if (!r.ok) return err(`Recherche YouTube impossible: ${r.error}`);

    await sleep(3000); // attendre les résultats
    return ok({ query, url: searchUrl });
  }
);

// ── browser.clickFirstYoutubeResult ──────────────────────────────────────────
// Stratégie hybride: d'abord heuristique position, puis fallback osascript DOM
server.tool(
  "browser.clickFirstYoutubeResult",
  {},
  async () => {
    // Méthode 1: JavaScript DOM dans Safari — clique sur le premier lien de vidéo
    const script = `
      tell application "Safari"
        activate
        do JavaScript "
          var links = document.querySelectorAll('ytd-video-renderer a#video-title, a.ytd-video-renderer');
          if(links.length > 0) {
            links[0].click();
            'clicked:' + links[0].href;
          } else {
            'no_results';
          }
        " in current tab of front window
      end tell`;

    const r = await applescript(script, 8000);

    if (r.ok && r.output && r.output.startsWith("clicked:")) {
      await sleep(2000);
      return ok({ method: "dom_click", url: r.output.replace("clicked:", "") });
    }

    // Méthode 2: clic à position heuristique (premier résultat ~35% x, 40% y en mode plein écran)
    // Récupère la taille de la fenêtre Safari
    const sizeScript = `
      tell application "Safari"
        set b to bounds of front window
        return (item 3 of b) & "," & (item 4 of b) & "," & (item 1 of b) & "," & (item 2 of b)
      end tell`;

    const sizeR = await applescript(sizeScript);
    let clickX = 700, clickY = 380; // valeurs par défaut

    if (sizeR.ok && sizeR.output) {
      const parts = sizeR.output.split(",").map(Number);
      if (parts.length === 4) {
        const [winW, winH, winX, winY] = parts;
        // Le premier résultat YouTube est typiquement à ~20% x, ~38% y de la fenêtre
        clickX = Math.round(winX + winW * 0.35);
        clickY = Math.round(winY + winH * 0.38);
      }
    }

    const clickScript = `
      tell application "System Events"
        tell application "Safari" to activate
        delay 0.3
        click at {${clickX}, ${clickY}}
      end tell`;

    const clickR = await applescript(clickScript, 5000);
    await sleep(2000);

    if (!clickR.ok) return err(`Clic YouTube impossible: ${clickR.error}`);
    return ok({ method: "heuristic_click", x: clickX, y: clickY });
  }
);

// ── browser.pressKey ─────────────────────────────────────────────────────────
server.tool(
  "browser.pressKey",
  {
    key: z.string().describe("Nom de la touche (ex: space, escape, f, return)"),
    modifier: z.enum(["none", "cmd", "ctrl", "alt", "shift"]).optional(),
  },
  async ({ key, modifier = "none" }) => {
    let script;
    if (modifier === "none") {
      script = `tell application "System Events" to keystroke "${key}"`;
    } else {
      const modMap = { cmd: "command", ctrl: "control", alt: "option", shift: "shift" };
      script = `tell application "System Events" to keystroke "${key}" using ${modMap[modifier]} down`;
    }
    const r = await applescript(script);
    if (!r.ok) return err(`Touche ${key} impossible: ${r.error}`);
    return ok({ key, modifier });
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
