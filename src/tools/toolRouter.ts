/**
 * toolRouter.ts - LaRuche Tool Router
 *
 * Routes tool calls (name + args) to:
 * 1. MCP servers (via stdio for now)
 * 2. Local scripts
 * 3. Direct module calls
 */

import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execa } from "execa";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../../");

// --- MCP endpoint registry ---

const MCP_SERVERS: Record<string, { command: string; args: string[] }> = {
  "mcp-os-control": { command: "node", args: ["mcp_servers/os_control_mcp.js"] },
  "mcp-terminal": { command: "node", args: ["mcp_servers/terminal_mcp.js"] },
  "mcp-vision": { command: "node", args: ["mcp_servers/vision_mcp.js"] },
  "mcp-vault": { command: "node", args: ["mcp_servers/vault_mcp.js"] },
  "mcp-playwright": { command: "node", args: ["mcp_servers/playwright_mcp.js"] },
};

// Map tool names to their respective MCP server and function name
const TOOL_MAP: Record<string, { mcp: string; fn: string }> = {
  // OS Control
  "hid.click": { mcp: "mcp-os-control", fn: "click" },
  "hid.type": { mcp: "mcp-os-control", fn: "typeText" },
  "hid.screenshot": { mcp: "mcp-os-control", fn: "screenshot" },
  // Terminal
  "terminal.run": { mcp: "mcp-terminal", fn: "exec" },
  // Vision
  "vision.analyze": { mcp: "mcp-vision", fn: "analyzeScreen" },
};

export class ToolRouter {
  private allowed: Set<string>;
  private refused: Set<string>;

  constructor(opts: { allowed: string[]; refused: string[] }) {
    this.allowed = new Set(opts.allowed);
    this.refused = new Set(opts.refused);
  }

  async call(toolName: string, args: any = {}): Promise<any> {
    if (this.refused.has(toolName)) {
      return { success: false, error: `Tool is blacklisted: ${toolName}` };
    }
    if (this.allowed.size > 0 && !this.allowed.has(toolName) && !this.allowed.has("*")) {
      return { success: false, error: `Tool not allowed: ${toolName}` };
    }

    const mapping = TOOL_MAP[toolName];
    if (!mapping) {
      return { success: false, error: `No mapping for tool: ${toolName}` };
    }

    const server = MCP_SERVERS[mapping.mcp];
    if (!server) {
      return { success: false, error: `MCP server not found: ${mapping.mcp}` };
    }

    try {
      const rpcRequest = JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "tools/call",
        params: { name: mapping.fn, arguments: args },
      });

      const { stdout, stderr } = await execa(server.command, [join(ROOT, ...server.args)], {
        input: rpcRequest,
        cwd: ROOT,
        timeout: 30000,
        reject: false,
      });

      if (stderr) console.error(`[ToolRouter] ${toolName} stderr: ${stderr}`);
      if (!stdout) return { success: false, error: "Empty response from MCP server" };

      const response = JSON.parse(stdout);
      if (response.error) return { success: false, error: response.error.message };

      return response.result;
    } catch (e: any) {
      return { success: false, error: `Execution failed: ${e.message}` };
    }
  }
}
