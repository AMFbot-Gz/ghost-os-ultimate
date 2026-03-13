/**
 * vision_mcp.js — MCP Vision Engine
 * analyzeScreen, findElement, identifyCursorTarget, watchChange
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execa } from "execa";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

async function callVisionPy(fn, args = {}) {
  const { stdout } = await execa("python3", [
    join(ROOT, "src/vision.py"),
    "--fn", fn,
    "--args", JSON.stringify(args),
  ], { reject: false, timeout: 60000 });
  try { return JSON.parse(stdout); } catch { return { success: false, error: stdout }; }
}

const server = new McpServer({ name: "laruche-vision", version: "3.0.0" });

server.tool(
  "analyzeScreen",
  { question: z.string(), region: z.string().optional() },
  async ({ question, region }) => {
    const result = await callVisionPy("analyze_screen", { question, region });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.tool(
  "findElement",
  { description: z.string() },
  async ({ description }) => {
    const result = await callVisionPy("find_element", { description });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.tool(
  "identifyCursorTarget",
  {},
  async () => {
    const result = await callVisionPy("analyze_screen", {
      question: "Qu'est-ce qui se trouve sous le curseur de la souris ? Identifie l'élément UI (bouton, champ, lien, etc.)."
    });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
