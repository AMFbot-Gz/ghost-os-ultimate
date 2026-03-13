/**
 * modes.js — LaRuche run modes
 * Headless (VPS) | Balanced (default) | Full (desktop) | Dev
 */

import { execa } from "execa";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

export const MODES = {
  headless: {
    description: "Core + MCP only (no HUD/Dashboard)",
    apps: ["laruche-queen", "laruche-watcher"],
    ram: "~100MB",
    forVPS: true,
  },
  balanced: {
    description: "Core + Dashboard (default)",
    apps: ["laruche-queen", "laruche-watcher", "laruche-dashboard"],
    ram: "~300MB",
    forVPS: false,
  },
  full: {
    description: "Core + Dashboard + HUD Electron",
    apps: ["laruche-queen", "laruche-watcher", "laruche-dashboard", "laruche-hud"],
    ram: "~450MB",
    forVPS: false,
  },
};

export async function startMode(modeName, env = "production") {
  const mode = MODES[modeName] || MODES.balanced;
  const eco = join(ROOT, "ecosystem.config.js");

  // Start only the apps for this mode
  for (const app of mode.apps) {
    try {
      await execa("npx", ["pm2", "start", eco, "--only", app, "--env", env], {
        cwd: ROOT,
        reject: false,
      });
    } catch { /* app may already be running */ }
  }

  // Stop apps not needed for this mode
  const allApps = ["laruche-queen", "laruche-watcher", "laruche-dashboard", "laruche-hud"];
  for (const app of allApps) {
    if (!mode.apps.includes(app)) {
      try {
        await execa("npx", ["pm2", "stop", app], { cwd: ROOT, reject: false });
      } catch { /* may not be running */ }
    }
  }
}
