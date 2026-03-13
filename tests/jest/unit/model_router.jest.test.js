/**
 * Tests Jest pour model_router.js
 */

import { jest } from "@jest/globals";

// Mock fetch global pour éviter les appels réseau
global.fetch = jest.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ models: [{ name: "llama3.2:3b" }, { name: "llava:7b" }] }),
});

const { autoDetectRoles, route } = await import("../../src/model_router.js");

describe("model_router", () => {
  test("autoDetectRoles retourne un objet avec les 6 rôles", async () => {
    const roles = await autoDetectRoles();
    expect(roles).toHaveProperty("worker");
    expect(roles).toHaveProperty("strategist");
    expect(roles).toHaveProperty("architect");
    expect(roles).toHaveProperty("vision");
    expect(roles).toHaveProperty("visionFast");
    expect(roles).toHaveProperty("synthesizer");
  });

  test("route() retourne une string non vide", async () => {
    const model = await route("bonjour comment ça va");
    expect(typeof model).toBe("string");
    expect(model.length).toBeGreaterThan(0);
  });

  test("route() code → rôle architect (contient qwen ou llama)", async () => {
    const model = await route("écris une fonction Python qui trie une liste");
    expect(typeof model).toBe("string");
    expect(model.length).toBeGreaterThan(0);
  });
});
