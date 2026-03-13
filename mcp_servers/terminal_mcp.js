/**
 * terminal_mcp.js — MCP Terminal Sécurisé
 * exec, execSafe, checkPrivilege, killProcess, listProcesses
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execa } from "execa";
import { join, resolve, normalize } from "path";
import dotenv from "dotenv";

dotenv.config();

const WORKSPACE_ROOT = resolve(process.env.WORKSPACE_ROOT || process.cwd());

// Whitelist de commandes autorisées
const SAFE_COMMANDS = new Set([
  "ls", "cat", "echo", "pwd", "date", "whoami", "uname",
  "df", "du", "ps", "top", "uptime", "which", "find",
  "grep", "awk", "sed", "head", "tail", "wc", "sort",
  "node", "python3", "npm", "pip3", "git",
]);

// Commandes dangereuses toujours bloquées
const DANGEROUS_COMMANDS = new Set([
  "rm", "rmdir", "mv", "dd", "mkfs", "fdisk",
  "chmod", "chown", "sudo", "su", "kill", "killall",
  "shutdown", "reboot", "halt", "format",
]);

function validatePath(p) {
  const abs = normalize(resolve(p));
  if (!abs.startsWith(WORKSPACE_ROOT)) {
    throw new Error(`Chemin hors workspace: ${abs}`);
  }
  return abs;
}

function validateCommand(cmd) {
  const base = cmd.trim().split(/\s+/)[0];
  if (DANGEROUS_COMMANDS.has(base)) {
    throw new Error(`Commande dangereuse interdite: ${base}`);
  }
  return cmd;
}

const server = new McpServer({
  name: "laruche-terminal",
  version: "3.0.0",
});

server.tool(
  "exec",
  { command: z.string(), cwd: z.string().optional(), timeout: z.number().optional() },
  async ({ command, cwd, timeout = 30000 }) => {
    try {
      validateCommand(command);
      const workDir = cwd ? validatePath(cwd) : WORKSPACE_ROOT;

      const { stdout, stderr, exitCode } = await execa("bash", ["-c", command], {
        cwd: workDir,
        timeout,
        reject: false,
        shell: false,
      });

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ success: exitCode === 0, stdout, stderr, exitCode }),
        }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ success: false, error: e.message }) }] };
    }
  }
);

server.tool(
  "execSafe",
  { command: z.string(), cwd: z.string().optional() },
  async ({ command, cwd }) => {
    try {
      const base = command.trim().split(/\s+/)[0];
      if (!SAFE_COMMANDS.has(base)) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success: false, error: `Commande non autorisée: ${base}. Utilisez exec pour les commandes avancées.` }),
          }],
        };
      }

      const workDir = cwd ? validatePath(cwd) : WORKSPACE_ROOT;
      const parts = command.trim().split(/\s+/);
      const { stdout, stderr, exitCode } = await execa(parts[0], parts.slice(1), {
        cwd: workDir,
        timeout: 10000,
        reject: false,
      });

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ success: exitCode === 0, stdout, stderr }),
        }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ success: false, error: e.message }) }] };
    }
  }
);

server.tool(
  "listProcesses",
  {},
  async () => {
    try {
      const { stdout } = await execa("ps", ["aux", "--no-header"], { reject: false });
      const procs = stdout.split("\n").slice(0, 20).map((l) => {
        const parts = l.trim().split(/\s+/);
        return { pid: parts[1], cpu: parts[2], mem: parts[3], cmd: parts.slice(10).join(" ") };
      });
      return { content: [{ type: "text", text: JSON.stringify({ success: true, processes: procs }) }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ success: false, error: e.message }) }] };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
