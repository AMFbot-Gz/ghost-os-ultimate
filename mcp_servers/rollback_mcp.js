/**
 * rollback_mcp.js — MCP Rollback
 * createSnapshot, listSnapshots, restore, purgeOldSnapshots
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, statSync } from "fs";
import { execa } from "execa";
import dotenv from "dotenv";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ROLLBACK_DIR = join(ROOT, ".laruche/rollback");

mkdirSync(ROLLBACK_DIR, { recursive: true });

async function alertTelegram(msg) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.ADMIN_TELEGRAM_ID) return;
  try {
    await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: process.env.ADMIN_TELEGRAM_ID,
          text: `⏪ *Rollback*: ${msg}`,
          parse_mode: "Markdown",
        }),
      }
    );
  } catch {}
}

const server = new McpServer({ name: "laruche-rollback", version: "3.0.0" });

server.tool(
  "createSnapshot",
  { missionId: z.string(), reason: z.string() },
  async ({ missionId, reason }) => {
    try {
      const snapshotId = `${missionId}_${Date.now()}`;
      const snapshotDir = join(ROLLBACK_DIR, snapshotId);
      mkdirSync(snapshotDir, { recursive: true });

      await execa("rsync", [
        "-av",
        "--checksum",
        `${ROOT}/src/`,
        `${snapshotDir}/src/`,
        "--exclude=node_modules",
        "--exclude=.git",
      ], { reject: false });

      const manifest = {
        id: snapshotId,
        missionId,
        reason,
        timestamp: new Date().toISOString(),
        files: ["src/"],
      };

      writeFileSync(join(snapshotDir, "manifest.json"), JSON.stringify(manifest, null, 2));

      return { content: [{ type: "text", text: JSON.stringify({ success: true, snapshotId }) }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ success: false, error: e.message }) }] };
    }
  }
);

server.tool("listSnapshots", {}, async () => {
  try {
    const dirs = readdirSync(ROLLBACK_DIR).filter((d) => {
      try { return statSync(join(ROLLBACK_DIR, d)).isDirectory(); } catch { return false; }
    });
    const snapshots = await Promise.all(
      dirs.map(async (d) => {
        try { return JSON.parse(readFileSync(join(ROLLBACK_DIR, d, "manifest.json"), "utf-8")); }
        catch { return null; }
      })
    );
    return { content: [{ type: "text", text: JSON.stringify({ success: true, snapshots: snapshots.filter(Boolean).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)) }) }] };
  } catch (e) {
    return { content: [{ type: "text", text: JSON.stringify({ success: false, error: e.message }) }] };
  }
});

server.tool(
  "restore",
  { snapshotId: z.string() },
  async ({ snapshotId }) => {
    try {
      const snapshotDir = join(ROLLBACK_DIR, snapshotId);
      await execa("rsync", [
        "-av",
        "--checksum",
        `${snapshotDir}/src/`,
        `${ROOT}/src/`,
      ], { reject: false });

      await alertTelegram(`Rollback effectué vers snapshot ${snapshotId}. État restauré avec succès.`);
      return { content: [{ type: "text", text: JSON.stringify({ success: true, snapshotId }) }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ success: false, error: e.message }) }] };
    }
  }
);

server.tool(
  "purgeOldSnapshots",
  { keepDays: z.number().optional() },
  async ({ keepDays = 7 }) => {
    try {
      const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
      const dirs = readdirSync(ROLLBACK_DIR);

      const purgePromises = dirs.map(async (dir) => {
        const fullPath = join(ROLLBACK_DIR, dir);
        try {
          const stat = statSync(fullPath);
          if (stat.isDirectory() && stat.mtimeMs < cutoff) {
            rmSync(fullPath, { recursive: true });
            return 1;
          }
        } catch {}
        return 0;
      });
      const results = await Promise.all(purgePromises);
      const purged = results.reduce((a, b) => a + b, 0);

      return { content: [{ type: "text", text: JSON.stringify({ success: true, purged }) }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ success: false, error: e.message }) }] };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
