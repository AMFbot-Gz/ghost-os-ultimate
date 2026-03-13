/**
 * test/unit/selfdev.jest.test.js — Tests unitaires du self-refactoring engine
 *
 * Couvre : analyzeRepo (stats, issues, hotspots), generateSuggestions
 */

import { jest } from '@jest/globals';
import { analyzeRepo } from '../../src/selfdev/repoAnalyzer.js';
import { generateSuggestions } from '../../src/selfdev/patchGenerator.js';
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Crée un répertoire temporaire avec des fichiers JS de test */
function createTempRepo() {
  const root = mkdtempSync(join(tmpdir(), 'laruche-selfdev-'));

  // Fichier simple (1 console.log)
  writeFileSync(join(root, 'simple.js'), `
function hello() {
  console.log('hello');
  return 42;
}
`);

  // Fichier avec TODO et FIXME
  writeFileSync(join(root, 'debt.js'), `
// TODO: refactoriser ce module
// FIXME: gestion d'erreur manquante
function doSomething() {
  return true;
}
`);

  // Fichier avec trop de console.log (> 3)
  writeFileSync(join(root, 'debug.js'), `
function verbose() {
  console.log('step 1');
  console.log('step 2');
  console.log('step 3');
  console.log('step 4');
  return 'done';
}
`);

  return root;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('analyzeRepo — stats', () => {
  test('retourne totalFiles, totalLines et issues dans stats', () => {
    const root = createTempRepo();
    const result = analyzeRepo(root);

    expect(result).toHaveProperty('stats');
    expect(result.stats).toHaveProperty('totalFiles');
    expect(result.stats).toHaveProperty('totalLines');
    expect(result.stats).toHaveProperty('issues');
    expect(typeof result.stats.totalFiles).toBe('number');
    expect(result.stats.totalFiles).toBeGreaterThanOrEqual(3);
    expect(result.stats.totalLines).toBeGreaterThan(0);
  });
});

describe('analyzeRepo — issues', () => {
  test('détecte les dettes techniques (TODO/FIXME)', () => {
    const root = createTempRepo();
    const result = analyzeRepo(root);

    expect(Array.isArray(result.issues)).toBe(true);
    const debtIssues = result.issues.filter(i => i.type === 'technical_debt');
    expect(debtIssues.length).toBeGreaterThanOrEqual(2);
    expect(debtIssues[0]).toHaveProperty('file');
    expect(debtIssues[0]).toHaveProperty('line');
    expect(debtIssues[0]).toHaveProperty('detail');
  });

  test('détecte les console.log excessifs (> 3)', () => {
    const root = createTempRepo();
    const result = analyzeRepo(root);

    const logIssues = result.issues.filter(i => i.type === 'debug_logs');
    expect(logIssues.length).toBeGreaterThanOrEqual(1);
    expect(logIssues[0].detail).toMatch(/console\.log/);
  });
});

describe('analyzeRepo — hotspots', () => {
  test('hotspots est un tableau (éventuellement vide sur un petit repo)', () => {
    const root = createTempRepo();
    const result = analyzeRepo(root);

    expect(Array.isArray(result.hotspots)).toBe(true);
    // Sur un petit repo de test, pas de fonctions > 100 lignes — tableau vide attendu
    expect(result.hotspots.length).toBe(0);
  });
});

describe('generateSuggestions', () => {
  test('produit une suggestion par issue avec file, type, suggestion, priority', () => {
    const fakeAnalysis = {
      issues: [
        { file: 'a.js', line: 10, type: 'complex_function', detail: 'Fonction de 120 lignes' },
        { file: 'b.js', line: 5,  type: 'technical_debt',   detail: 'TODO: fix this' },
        { file: 'c.js',            type: 'debug_logs',        detail: '5 console.log non supprimés' },
      ],
    };

    const suggestions = generateSuggestions(fakeAnalysis);
    expect(suggestions).toHaveLength(3);

    expect(suggestions[0].type).toBe('refactor');
    expect(suggestions[0].priority).toBe('medium');

    expect(suggestions[1].type).toBe('debt');
    expect(suggestions[1].priority).toBe('low');
    expect(suggestions[1].suggestion).toContain('TODO: fix this');

    expect(suggestions[2].type).toBe('cleanup');
    expect(suggestions[2].suggestion).toMatch(/logger\.debug/);
  });
});
