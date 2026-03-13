/**
 * agentBridge.js - Bridge between JS queen/CLI and TS agentLoop
 * Loads agentLoop dynamically, handles missing TypeScript gracefully.
 */

import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../../");

/**
 * Tries to load the agentLoop. Supports:
 * 1. Compiled JS (dist/)
 * 2. Raw TS (src/) via tsx
 * 3. Fallback stub (ask model_router directly)
 */
async function loadAgentLoop() {
  const paths = [
    join(ROOT, "dist/agents/agentLoop.js"), // compiled
    join(ROOT, "src/agents/agentLoop.ts"),  // source (requires tsx)
  ];

  for (const p of paths) {
    if (existsSync(p)) {
      try {
        // Dynamic import supports both .js and .ts (if loader is registered)
        return await import(p);
      } catch (e) {
        console.warn(`[AgentBridge] Could not load ${p}: ${e.message}`);
      }
    }
  }

  // Fallback Stub Implementation
  return {
    runAgentLoop: async (opts) => {
      const { ask } = await import("../model_router.js");
      const result = await ask(opts.userInput, {
        role: opts.agentName === "builder" ? "architect" : "worker",
        timeout: 60000
      });

      opts.onToken?.(result.text);

      return {
        sessionId: `stub_${Date.now()}`,
        response: result.text,
        iterations: 1,
        tool_calls_count: 0,
        status: "completed",
      };
    },
  };
}

let _agentLoop = null;

/**
 * Runs the agent loop for a given task.
 */
export async function runAgent(opts) {
  if (!_agentLoop) {
    _agentLoop = await loadAgentLoop();
  }
  return await _agentLoop.runAgentLoop(opts);
}

/**
 * Checks if the agentLoop is available in either source or compiled form.
 */
export async function isAgentLoopAvailable() {
  const paths = [
    join(ROOT, "dist/agents/agentLoop.js"),
    join(ROOT, "src/agents/agentLoop.ts"),
  ];
  return paths.some(p => existsSync(p));
}
