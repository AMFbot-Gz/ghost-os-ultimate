/**
 * janitor_mcp.js — MCP Janitor Pro
 * purgeTemp, rotateLogs, deleteExpiredSkills, gcRAM
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { readdirSync, rmSync, mkdirSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const TEMP_DIR = join(ROOT, ".laruche/temp");
mkdirSync(TEMP_DIR, { recursive: true });

const server = new McpServer({ name: "laruche-janitor", version: "3.0.0" });

server.tool("purgeTemp", {}, async () => {
  try {
    const files = readdirSync(TEMP_DIR).filter((f) => f !== ".gitkeep");
    files.forEach((f) => { try { rmSync(join(TEMP_DIR, f), { recursive: true }); } catch {} });
    return { content: [{ type: "text", text: JSON.stringify({ success: true, purged: files.length }) }] };
  } catch (e) {
    return { content: [{ type: "text", text: JSON.stringify({ success: false, error: e.message }) }] };
  }
});

server.tool("gcRAM", {}, async () => {
  const before = process.memoryUsage().heapUsed;
  if (global.gc) global.gc();
  const after = process.memoryUsage().heapUsed;
  const freedMB = ((before - after) / (1024 * 1024)).toFixed(1);
  return { content: [{ type: "text", text: JSON.stringify({ success: true, freed_mb: freedMB }) }] };
});

server.tool(
  "getStats",
  {},
  async () => {
    const mem = process.memoryUsage();
    const tempFiles = readdirSync(TEMP_DIR).filter((f) => f !== ".gitkeep").length;
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          heap_mb: (mem.heapUsed / 1024 / 1024).toFixed(1),
          rss_mb: (mem.rss / 1024 / 1024).toFixed(1),
          temp_files: tempFiles,
        }),
      }],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
