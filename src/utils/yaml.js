/**
 * yaml.js — Parser YAML minimaliste pour LaRuche
 * Couvre uniquement le format frontmatter clé: valeur utilisé dans config/agents/*.yaml
 */

export function parse(str) {
  const result = {};
  const lines = str.split('\n');
  let currentKey = null;
  let inBlock = false;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line || line.startsWith('#')) continue;

    const idx = line.indexOf(':');
    if (idx === -1) {
      // Ligne de continuation pour block scalars ou liste
      if (currentKey && line.trim().startsWith('- ')) {
        if (!Array.isArray(result[currentKey])) result[currentKey] = [];
        result[currentKey].push(line.trim().slice(2).replace(/^['"]|['"]$/g, ''));
      }
      continue;
    }

    const key = line.slice(0, idx).trim();
    const rawVal = line.slice(idx + 1).trim();
    currentKey = key;

    if (!rawVal) {
      // Valeur sur les lignes suivantes (liste YAML avec tirets)
      result[key] = [];
      inBlock = true;
      continue;
    }
    inBlock = false;

    // Listes inline [a, b, c]
    if (rawVal.startsWith('[') && rawVal.endsWith(']')) {
      result[key] = rawVal.slice(1, -1)
        .split(',')
        .map(v => v.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    } else if (rawVal === 'true') {
      result[key] = true;
    } else if (rawVal === 'false') {
      result[key] = false;
    } else if (rawVal === 'null' || rawVal === '~') {
      result[key] = null;
    } else if (!isNaN(rawVal) && rawVal !== '') {
      result[key] = Number(rawVal);
    } else {
      result[key] = rawVal.replace(/^['"]|['"]$/g, '');
    }
  }

  return result;
}

export default { parse };
