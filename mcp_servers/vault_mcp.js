/**
 * vault_mcp.js — MCP Synapse-Vault
 * storeExperience, findSimilar, getProfile, updateProfile, searchSkills
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import dotenv from "dotenv";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const VAULT_DIR = join(ROOT, "vault");
const PROFILE_PATH = join(ROOT, ".laruche/patron-profile.json");

mkdirSync(VAULT_DIR, { recursive: true });

// Chargement profil patron
function loadProfile() {
  try {
    return JSON.parse(readFileSync(PROFILE_PATH, "utf-8"));
  } catch {
    return { identity: {}, work_style: {}, learned_rules: [], session_count: 0, total_tasks_completed: 0 };
  }
}

function saveProfile(profile) {
  profile.last_updated = new Date().toISOString();
  writeFileSync(PROFILE_PATH, JSON.stringify(profile, null, 2));
}

// Singleton ChromaDB — client et collection initialisés une seule fois
let _chromaClient = null;
let _collection = null;

async function getCollection() {
  if (!_collection) {
    const { ChromaClient } = await import("chromadb");
    _chromaClient = new ChromaClient({ path: VAULT_DIR });
    _collection = await _chromaClient.getOrCreateCollection({ name: "laruche_experiences" });
  }
  return _collection;
}

const server = new McpServer({ name: "laruche-vault", version: "3.0.0" });

server.tool(
  "storeExperience",
  {
    task: z.string(),
    result: z.string(),
    success: z.boolean(),
    skillUsed: z.string().optional(),
    platform: z.string().optional(),
  },
  async ({ task, result, success, skillUsed, platform }) => {
    try {
      const collection = await getCollection();

      const id = `exp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const doc = `Task: ${task} | Result: ${result.substring(0, 200)} | Platform: ${platform || "unknown"}`;

      await collection.add({
        ids: [id],
        documents: [doc],
        metadatas: [{
          timestamp: new Date().toISOString(),
          success,
          skill: skillUsed || "unknown",
          platform: platform || "unknown",
          resolved: success,
        }],
      });

      // Mise à jour profil patron
      if (success) {
        const profile = loadProfile();
        profile.total_tasks_completed = (profile.total_tasks_completed || 0) + 1;
        saveProfile(profile);
      }

      return { content: [{ type: "text", text: JSON.stringify({ success: true, id }) }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ success: false, error: e.message }) }] };
    }
  }
);

server.tool(
  "findSimilar",
  { query: z.string(), k: z.number().optional(), onlySuccess: z.boolean().optional() },
  async ({ query, k = 5, onlySuccess = true }) => {
    try {
      const collection = await getCollection();

      const count = await collection.count();
      if (count === 0) return { content: [{ type: "text", text: JSON.stringify({ results: [] }) }] };

      const where = onlySuccess ? { resolved: true } : undefined;
      const results = await collection.query({
        queryTexts: [query],
        nResults: Math.min(k, count),
        where,
      });

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            results: results.documents[0] || [],
            metadatas: results.metadatas[0] || [],
          }),
        }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ results: [], error: e.message }) }] };
    }
  }
);

server.tool("getProfile", {}, async () => {
  const profile = loadProfile();
  return { content: [{ type: "text", text: JSON.stringify(profile) }] };
});

server.tool(
  "updateProfile",
  { key: z.string(), value: z.unknown() },
  async ({ key, value }) => {
    try {
      const profile = loadProfile();
      profile[key] = value;
      saveProfile(profile);
      return { content: [{ type: "text", text: JSON.stringify({ success: true }) }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ success: false, error: e.message }) }] };
    }
  }
);

server.tool(
  "addRule",
  { rule: z.string() },
  async ({ rule }) => {
    try {
      const profile = loadProfile();
      if (!profile.learned_rules) profile.learned_rules = [];
      if (!profile.learned_rules.includes(rule)) {
        profile.learned_rules.push(rule);
        saveProfile(profile);
      }
      return { content: [{ type: "text", text: JSON.stringify({ success: true, total_rules: profile.learned_rules.length }) }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ success: false, error: e.message }) }] };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
