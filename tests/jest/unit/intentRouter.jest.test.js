/**
 * Tests intentRouter.js — Routeur déterministe d'intentions
 *
 * Vérifie que les règles regex matchent correctement sans appel LLM.
 */
import { jest } from '@jest/globals';
import { routeByRules, isActionIntent } from '../../src/agents/intentRouter.js';

describe('intentRouter — routeur déterministe', () => {

  // ── Screenshot ────────────────────────────────────────────────────────────────
  test('screenshot → take_screenshot', () => {
    const r = routeByRules('prends un screenshot');
    expect(r.matched).toBe(true);
    expect(r.plan.steps[0].skill).toBe('take_screenshot');
    expect(r.plan.source).toBe('rules');
    expect(r.plan.confidence).toBe(1.0);
  });

  test('capture écran → take_screenshot', () => {
    const r = routeByRules("prends une capture d'écran");
    expect(r.matched).toBe(true);
    expect(r.plan.steps[0].skill).toBe('take_screenshot');
  });

  // ── Ouvrir application ────────────────────────────────────────────────────────
  test('ouvre Safari → open_app', () => {
    const r = routeByRules('ouvre safari');
    expect(r.matched).toBe(true);
    expect(r.plan.steps[0].skill).toBe('open_app');
    expect(r.plan.steps[0].params.app).toBe('Safari');
  });

  test('lance terminal → open_app Terminal', () => {
    // La règle spécifique Terminal matche "lance terminal" (sans article)
    const r = routeByRules('lance terminal');
    expect(r.matched).toBe(true);
    expect(r.plan.steps[0].skill).toBe('open_app');
    expect(r.plan.steps[0].params.app).toBe('Terminal');
  });

  test('ouvre vscode → open_app Visual Studio Code', () => {
    const r = routeByRules('ouvre vscode');
    expect(r.matched).toBe(true);
    expect(r.plan.steps[0].skill).toBe('open_app');
    expect(r.plan.steps[0].params.app).toBe('Visual Studio Code');
  });

  // ── Liste des skills disponibles ───────────────────────────────────────────────
  test('liste les skills → http_fetch /api/skills', () => {
    const r = routeByRules('liste les skills disponibles');
    expect(r.matched).toBe(true);
    expect(r.plan.steps[0].skill).toBe('http_fetch');
    expect(r.plan.steps[0].params.url).toContain('/api/skills');
  });

  test('skills dispo → http_fetch /api/skills', () => {
    const r = routeByRules('skills disponibles');
    expect(r.matched).toBe(true);
    expect(r.plan.steps[0].skill).toBe('http_fetch');
    expect(r.plan.steps[0].params.url).toContain('/api/skills');
  });

  // ── État du système ────────────────────────────────────────────────────────────
  test('état du système → http_fetch /api/status', () => {
    const r = routeByRules('état du système');
    expect(r.matched).toBe(true);
    expect(r.plan.steps[0].skill).toBe('http_fetch');
    expect(r.plan.steps[0].params.url).toContain('/api/status');
  });

  test('status du serveur → http_fetch /api/status', () => {
    const r = routeByRules('status du serveur');
    expect(r.matched).toBe(true);
    expect(r.plan.steps[0].skill).toBe('http_fetch');
    expect(r.plan.steps[0].params.url).toContain('/api/status');
  });

  // ── Git ───────────────────────────────────────────────────────────────────────
  test('git status → run_command git status', () => {
    const r = routeByRules('git status');
    expect(r.matched).toBe(true);
    expect(r.plan.steps[0].skill).toBe('run_command');
    expect(r.plan.steps[0].params.command).toContain('git status');
  });

  test('git log → run_command git log', () => {
    const r = routeByRules('git log');
    expect(r.matched).toBe(true);
    expect(r.plan.steps[0].skill).toBe('run_command');
    expect(r.plan.steps[0].params.command).toContain('git log');
  });

  // ── Naviguer vers URL ─────────────────────────────────────────────────────────
  test('va sur github.com → goto_url', () => {
    const r = routeByRules('va sur github.com');
    expect(r.matched).toBe(true);
    expect(r.plan.steps[0].skill).toBe('goto_url');
    expect(r.plan.steps[0].params.url).toContain('github.com');
  });

  test('ouvre https://example.com → goto_url', () => {
    const r = routeByRules('ouvre https://example.com');
    expect(r.matched).toBe(true);
    expect(r.plan.steps[0].skill).toBe('goto_url');
    expect(r.plan.steps[0].params.url).toBe('https://example.com');
  });

  // ── Commande inconnue ─────────────────────────────────────────────────────────
  test('commande inconnue → pas de match', () => {
    const r = routeByRules('xyz absurdité quelconque 12345');
    expect(r.matched).toBe(false);
    expect(r.plan).toBeNull();
  });

  test('texte vide → pas de match', () => {
    const r = routeByRules('   ');
    expect(r.matched).toBe(false);
  });

  // ── Structure du plan ─────────────────────────────────────────────────────────
  test('plan a une structure valide (goal, steps, confidence, source)', () => {
    const r = routeByRules('prends un screenshot');
    expect(r.plan).toHaveProperty('goal');
    expect(r.plan).toHaveProperty('steps');
    expect(r.plan).toHaveProperty('confidence');
    expect(r.plan).toHaveProperty('source');
    expect(Array.isArray(r.plan.steps)).toBe(true);
    expect(r.plan.steps.length).toBeGreaterThan(0);
  });

  // ── isActionIntent ────────────────────────────────────────────────────────────
  test('isActionIntent retourne true pour une commande connue', () => {
    expect(isActionIntent('prends un screenshot')).toBe(true);
  });

  test('isActionIntent retourne false pour une commande inconnue', () => {
    expect(isActionIntent('xyz absurdité quelconque 12345')).toBe(false);
  });
});
