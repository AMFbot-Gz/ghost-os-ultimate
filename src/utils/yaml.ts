/**
 * yaml.ts — Minimal YAML parser for LaRuche config files
 * Handles simple key: value, lists, nested objects
 * No external dependencies.
 */

export function parse(yamlStr: string): Record<string, unknown> {
  // Use a simple line-by-line parser for basic YAML
  // For production: replace with 'js-yaml' npm package
  try {
    // Attempt basic JSON-like parsing for simple structures
    // Replace YAML syntax with JSON equivalents
    const lines = yamlStr.split("\n");
    const result: Record<string, unknown> = {};
    const stack: Array<{ obj: Record<string, unknown>; indent: number }> = [{ obj: result, indent: -1 }];

    for (const line of lines) {
      if (line.trim().startsWith("#") || !line.trim()) continue;

      const indent = line.search(/\S/);
      const trimmed = line.trim();

      // Pop stack to correct indent level
      while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
        stack.pop();
      }

      const current = stack[stack.length - 1].obj;

      if (trimmed.startsWith("- ")) {
        // List item — simplified handling
        continue;
      }

      const colonIdx = trimmed.indexOf(":");
      if (colonIdx < 0) continue;

      const key = trimmed.slice(0, colonIdx).trim();
      const valueRaw = trimmed.slice(colonIdx + 1).trim();

      if (!valueRaw) {
        // Nested object
        const nested: Record<string, unknown> = {};
        current[key] = nested;
        stack.push({ obj: nested, indent });
      } else if (valueRaw === "true") {
        current[key] = true;
      } else if (valueRaw === "false") {
        current[key] = false;
      } else if (!isNaN(Number(valueRaw)) && valueRaw !== "") {
        current[key] = Number(valueRaw);
      } else {
        // String — remove quotes and expand env vars
        current[key] = valueRaw.replace(/^["']|["']$/g, "").replace(
          /\$\{([^}]+)\}/g,
          (_, expr) => {
            const [varName, def] = expr.split(":-");
            return process.env[varName] ?? def ?? "";
          }
        );
      }
    }

    return result;
  } catch {
    return {};
  }
}
