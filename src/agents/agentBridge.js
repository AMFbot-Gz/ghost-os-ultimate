/**
 * agentBridge.js - Bridge between JS queen/CLI and agentLoop
 * Charge agentLoop.js directement (ESM pur, pas de compilation TypeScript requise).
 */

import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { runAgentLoop } from "./agentLoop.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../../");

/**
 * Runs the agent loop for a given task.
 */
export async function runAgent(opts) {
  return await runAgentLoop(opts);
}

/**
 * Checks if agentLoop.js is available.
 */
export async function isAgentLoopAvailable() {
  return existsSync(join(ROOT, "src/agents/agentLoop.js"));
}
