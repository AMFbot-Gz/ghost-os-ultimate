export { analyzeRepo } from './repoAnalyzer.js';
export { generateSuggestions } from './patchGenerator.js';

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));

export async function runSelfAnalysis() {
  const { analyzeRepo } = await import('./repoAnalyzer.js');
  const { generateSuggestions } = await import('./patchGenerator.js');
  const root = join(__dirname, '../../');
  const analysis = analyzeRepo(root);
  const suggestions = generateSuggestions(analysis);
  return { analysis, suggestions, timestamp: new Date().toISOString() };
}
