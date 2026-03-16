/**
 * Tests Jest pour src/utils.js — safeParseJSON
 */

let safeParseJSON;
beforeAll(async () => {
  const m = await import("../../../src/utils.js");
  safeParseJSON = m.safeParseJSON;
});

describe("safeParseJSON", () => {
  test("parse JSON simple", () => {
    expect(safeParseJSON('{"a":1}', null)).toEqual({ a: 1 });
  });

  test("JSON après texte", () => {
    const r = safeParseJSON('voici: {"mission":"test"}', null);
    expect(r?.mission).toBe("test");
  });

  test("JSON invalide → fallback", () => {
    expect(safeParseJSON("pas du JSON", "default")).toBe("default");
  });

  test("chaîne vide → fallback", () => {
    expect(safeParseJSON("", null)).toBeNull();
  });

  test("JSON avec backticks", () => {
    const r = safeParseJSON('```json\n{"tasks":[1,2]}\n```', null);
    expect(r?.tasks).toEqual([1, 2]);
  });
});
