/**
 * playwright_mcp.js — MCP Playwright pour LaRuche
 * Contrôle de navigateur fiable via DOM — remplace AppleScript pour les sites modernes
 *
 * Tools:
 *   pw.launch(browser?)              — Ouvre Chromium/Firefox/Safari
 *   pw.goto(url)                     — Navigation avec attente réseau
 *   pw.click(selector)               — Clic par sélecteur CSS/XPath
 *   pw.fill(selector, text)          — Remplir un champ
 *   pw.press(key)                    — Appuyer sur une touche
 *   pw.select(selector, value)       — Sélectionner dans un <select>
 *   pw.waitFor(selector, timeout?)   — Attendre qu'un élément apparaisse
 *   pw.extract(selector)             — Extraire le texte d'éléments
 *   pw.screenshot(path?)             — Capture d'écran
 *   pw.evaluate(script)              — Exécuter JS dans la page
 *   pw.close()                       — Fermer le navigateur
 *   pw.searchYouTube(query)          — Macro YouTube complète
 *   pw.fillForm(fields)              — Remplir un formulaire complet
 *   pw.getPageState()                — Résumé structuré de la page actuelle
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { mkdirSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SCREENSHOTS_DIR = join(ROOT, ".laruche/temp/screenshots");
mkdirSync(SCREENSHOTS_DIR, { recursive: true });

// ─── Réponses standard ────────────────────────────────────────────────────────
const ok  = (d = {}) => ({ content: [{ type: "text", text: JSON.stringify({ success: true,  ...d }) }] });
const err = (msg, d={}) => ({ content: [{ type: "text", text: JSON.stringify({ success: false, error: msg, ...d }) }] });

// ─── Instance Playwright (singleton) ─────────────────────────────────────────
let _browser = null;
let _page    = null;
let _pw      = null;

async function getBrowser(browserType = "chromium") {
  if (_browser) return { browser: _browser, page: _page };
  const { chromium, firefox, webkit } = await import("playwright");
  const engines = { chromium, firefox, safari: webkit, webkit };
  const engine  = engines[browserType] || chromium;

  _pw      = engine;
  _browser = await engine.launch({ headless: false, args: ["--no-sandbox"] });
  _page    = await _browser.newPage();

  // Listener auto-close
  _browser.on("disconnected", () => { _browser = null; _page = null; _pw = null; });

  return { browser: _browser, page: _page };
}

async function getPage() {
  if (!_page) await getBrowser();
  return _page;
}

// ─── MCP Server ───────────────────────────────────────────────────────────────
const server = new McpServer({ name: "laruche-playwright", version: "1.0.0" });

// pw.launch
server.tool("pw.launch",
  { browser: z.enum(["chromium", "firefox", "webkit", "safari"]).optional() },
  async ({ browser = "chromium" }) => {
    try {
      await getBrowser(browser);
      return ok({ browser, message: `${browser} lancé` });
    } catch (e) { return err(`Launch failed: ${e.message}`); }
  }
);

// pw.goto
server.tool("pw.goto",
  { url: z.string(), waitUntil: z.enum(["load","domcontentloaded","networkidle"]).optional() },
  async ({ url, waitUntil = "domcontentloaded" }) => {
    try {
      const page = await getPage();
      const response = await page.goto(url, { waitUntil, timeout: 30000 });
      return ok({ url, status: response?.status(), title: await page.title() });
    } catch (e) { return err(`Navigation failed: ${e.message}`, { url }); }
  }
);

// pw.click
server.tool("pw.click",
  { selector: z.string(), timeout: z.number().optional() },
  async ({ selector, timeout = 10000 }) => {
    try {
      const page = await getPage();
      await page.waitForSelector(selector, { timeout });
      await page.click(selector);
      return ok({ selector });
    } catch (e) { return err(`Click failed: ${e.message}`, { selector }); }
  }
);

// pw.fill
server.tool("pw.fill",
  { selector: z.string(), text: z.string(), clear: z.boolean().optional() },
  async ({ selector, text, clear = true }) => {
    try {
      const page = await getPage();
      await page.waitForSelector(selector, { timeout: 10000 });
      if (clear) await page.fill(selector, "");
      await page.fill(selector, text);
      return ok({ selector, text });
    } catch (e) { return err(`Fill failed: ${e.message}`, { selector }); }
  }
);

// pw.press
server.tool("pw.press",
  { key: z.string(), selector: z.string().optional() },
  async ({ key, selector }) => {
    try {
      const page = await getPage();
      if (selector) {
        await page.press(selector, key);
      } else {
        await page.keyboard.press(key);
      }
      return ok({ key });
    } catch (e) { return err(`Press failed: ${e.message}`); }
  }
);

// pw.waitFor
server.tool("pw.waitFor",
  { selector: z.string(), timeout: z.number().optional(), state: z.enum(["visible","hidden","attached","detached"]).optional() },
  async ({ selector, timeout = 15000, state = "visible" }) => {
    try {
      const page = await getPage();
      await page.waitForSelector(selector, { timeout, state });
      return ok({ selector, state });
    } catch (e) { return err(`WaitFor timeout: ${selector}`, { selector }); }
  }
);

// pw.extract
server.tool("pw.extract",
  { selector: z.string(), attribute: z.string().optional(), limit: z.number().optional() },
  async ({ selector, attribute, limit = 10 }) => {
    try {
      const page = await getPage();
      const elements = await page.$$(selector);
      const results  = [];
      for (const el of elements.slice(0, limit)) {
        const text = attribute
          ? await el.getAttribute(attribute)
          : await el.innerText();
        if (text?.trim()) results.push(text.trim());
      }
      return ok({ selector, count: results.length, results });
    } catch (e) { return err(`Extract failed: ${e.message}`, { selector }); }
  }
);

// pw.screenshot
server.tool("pw.screenshot",
  { path: z.string().optional(), fullPage: z.boolean().optional() },
  async ({ fullPage = false }) => {
    try {
      const page = await getPage();
      const ts   = Date.now();
      const path = join(SCREENSHOTS_DIR, `pw_${ts}.png`);
      await page.screenshot({ path, fullPage });
      return ok({ path, ts });
    } catch (e) { return err(`Screenshot failed: ${e.message}`); }
  }
);

// pw.evaluate
server.tool("pw.evaluate",
  { script: z.string() },
  async ({ script }) => {
    try {
      const page   = await getPage();
      const result = await page.evaluate(script);
      return ok({ result: JSON.stringify(result).slice(0, 2000) });
    } catch (e) { return err(`Evaluate failed: ${e.message}`); }
  }
);

// pw.close
server.tool("pw.close", {}, async () => {
  try {
    if (_browser) { await _browser.close(); _browser = null; _page = null; }
    return ok({ message: "Browser fermé" });
  } catch (e) { return err(`Close failed: ${e.message}`); }
});

// pw.getPageState — résumé structuré de la page
server.tool("pw.getPageState", {}, async () => {
  try {
    const page = await getPage();
    const state = await page.evaluate(() => ({
      url:     location.href,
      title:   document.title,
      inputs:  [...document.querySelectorAll("input,textarea,select")].slice(0, 20).map(el => ({
        tag: el.tagName, type: el.type, id: el.id, name: el.name,
        placeholder: el.placeholder, value: el.value?.slice(0, 50),
        visible: el.offsetParent !== null,
      })),
      buttons: [...document.querySelectorAll("button,[role=button],a[href]")].slice(0, 20).map(el => ({
        tag: el.tagName, text: el.innerText?.slice(0, 50)?.trim(), href: el.href,
      })),
      headings: [...document.querySelectorAll("h1,h2,h3")].slice(0, 5).map(h => h.innerText?.slice(0, 80)),
    }));
    return ok(state);
  } catch (e) { return err(`getPageState failed: ${e.message}`); }
});

// pw.searchYouTube — macro complète YouTube (plus fiable qu'AppleScript)
server.tool("pw.searchYouTube",
  { query: z.string() },
  async ({ query }) => {
    try {
      const page = await getPage();
      const url  = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;

      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForSelector("ytd-video-renderer", { timeout: 15000 });

      const videos = await page.evaluate(() => {
        const renderers = document.querySelectorAll("ytd-video-renderer a#video-title");
        return [...renderers].slice(0, 5).map(a => ({ title: a.textContent?.trim(), href: a.href }));
      });

      return ok({ query, url, videos });
    } catch (e) { return err(`searchYouTube failed: ${e.message}`); }
  }
);

// pw.clickFirstYoutubeResult
server.tool("pw.clickFirstYoutubeResult", {}, async () => {
  try {
    const page = await getPage();
    const sel  = "ytd-video-renderer a#video-title";
    await page.waitForSelector(sel, { timeout: 10000 });
    const href = await page.$eval(sel, a => a.href);
    await page.click(sel);
    await page.waitForTimeout(2000);
    return ok({ href, message: "Vidéo lancée" });
  } catch (e) { return err(`clickFirstResult failed: ${e.message}`); }
});

// pw.fillForm — remplir plusieurs champs d'un coup
server.tool("pw.fillForm",
  { fields: z.array(z.object({ selector: z.string(), value: z.string() })) },
  async ({ fields }) => {
    try {
      const page    = await getPage();
      const results = [];
      for (const { selector, value } of fields) {
        try {
          await page.waitForSelector(selector, { timeout: 5000 });
          await page.fill(selector, value);
          results.push({ selector, ok: true });
        } catch (e) {
          results.push({ selector, ok: false, error: e.message });
        }
      }
      return ok({ filled: results.filter(r => r.ok).length, total: fields.length, results });
    } catch (e) { return err(`fillForm failed: ${e.message}`); }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
