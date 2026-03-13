import { readdirSync, statSync, readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';

export function analyzeRepo(rootPath) {
  const jsFiles = [];
  function walk(dir) {
    try {
      for (const f of readdirSync(dir)) {
        if (['node_modules', '.git', 'dist', 'coverage'].includes(f)) continue;
        const full = join(dir, f);
        const stat = statSync(full);
        if (stat.isDirectory()) { walk(full); }
        else if (['.js', '.mjs'].includes(extname(f))) { jsFiles.push(full); }
      }
    } catch {}
  }
  walk(rootPath);

  const issues = [];
  const stats = { totalFiles: jsFiles.length, totalLines: 0, issues: 0 };

  for (const file of jsFiles) {
    try {
      const content = readFileSync(file, 'utf8');
      const lines = content.split('\n');
      stats.totalLines += lines.length;

      // Détecte fonctions > 100 lignes (complexité)
      let fnStart = -1; let braceDepth = 0;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].match(/(?:function|=>)\s*\{/) || lines[i].match(/(?:async\s+)?function\s+\w+/)) fnStart = i;
        braceDepth += (lines[i].match(/\{/g) || []).length - (lines[i].match(/\}/g) || []).length;
        if (fnStart >= 0 && braceDepth === 0 && i > fnStart) {
          if (i - fnStart > 100) issues.push({ file, line: fnStart + 1, type: 'complex_function', detail: `Fonction de ${i - fnStart} lignes` });
          fnStart = -1;
        }
      }

      // Détecte TODO/FIXME
      lines.forEach((l, i) => {
        if (l.match(/TODO|FIXME|HACK/i)) issues.push({ file, line: i + 1, type: 'technical_debt', detail: l.trim().slice(0, 80) });
      });

      // Détecte console.log non supprimés
      const consoleLogs = lines.filter(l => l.match(/console\.log/) && !l.includes('//'));
      if (consoleLogs.length > 3) issues.push({ file, type: 'debug_logs', detail: `${consoleLogs.length} console.log non supprimés` });

    } catch {}
  }

  stats.issues = issues.length;
  return { stats, issues: issues.slice(0, 50), hotspots: issues.filter(i => i.type === 'complex_function').map(i => i.file) };
}
