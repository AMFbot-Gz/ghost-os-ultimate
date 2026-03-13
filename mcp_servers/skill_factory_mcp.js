/**
 * skill_factory_mcp.js — MCP Skill Factory
 * createSkill, testSkill, registerSkill, evolveSkill, listSkills
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createSkill, evolveSkill, listSkills } from "../src/skill_evolution.js";

const server = new McpServer({ name: "laruche-skill-factory", version: "3.0.0" });

server.tool(
  "createSkill",
  { description: z.string(), ttl: z.number().optional() },
  async ({ description, ttl }) => {
    try {
      const result = await createSkill(description);
      return { content: [{ type: "text", text: JSON.stringify({ success: true, ...result }) }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ success: false, error: e.message }) }] };
    }
  }
);

server.tool(
  "evolveSkill",
  { skillName: z.string(), error: z.string(), stack: z.string().optional() },
  async ({ skillName, error, stack }) => {
    try {
      const result = await evolveSkill(skillName, { error, stack });
      return { content: [{ type: "text", text: JSON.stringify({ success: true, ...result }) }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ success: false, error: e.message }) }] };
    }
  }
);

server.tool("listSkills", {}, async () => {
  try {
    const skills = listSkills();
    return { content: [{ type: "text", text: JSON.stringify({ success: true, skills }) }] };
  } catch (e) {
    return { content: [{ type: "text", text: JSON.stringify({ success: false, error: e.message }) }] };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
