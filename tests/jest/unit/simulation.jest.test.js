/**
 * Tests simulation — riskEstimator + actionSimulator + desktopModel
 *
 * Vérifie le calcul de risque, les probabilités de succès,
 * les flags requiresConfirmation et la simulation de plans.
 */
import { jest } from '@jest/globals';
import { estimateRisk, RiskLevel } from '../../../src/simulation/riskEstimator.js';
import { simulate, simulatePlan } from '../../../src/simulation/actionSimulator.js';
import { updateDesktopState, getDesktopState, predictStateAfter } from '../../../src/simulation/desktopModel.js';

// ─── estimateRisk ──────────────────────────────────────────────────────────────

describe('estimateRisk', () => {
  test('take_screenshot → risque LOW avec score faible', () => {
    const r = estimateRisk('take_screenshot');
    expect(r.level).toBe(RiskLevel.LOW);
    expect(r.score).toBeLessThan(0.2);
    expect(r.requiresConfirmation).toBe(false);
  });

  test('run_shell → risque HIGH, requiresConfirmation=true', () => {
    const r = estimateRisk('run_shell');
    expect(r.level).toBe(RiskLevel.HIGH);
    expect(r.score).toBeGreaterThanOrEqual(0.7);
    expect(r.requiresConfirmation).toBe(true);
  });

  test('aggrave le score si params contiennent "rm "', () => {
    const safe    = estimateRisk('run_shell', { cmd: 'ls -la' });
    const danger  = estimateRisk('run_shell', { cmd: 'rm -rf /tmp/test' });
    expect(danger.score).toBeGreaterThan(safe.score);
  });

  test('aggrave le score si params contiennent "sudo"', () => {
    const safe   = estimateRisk('run_command', { cmd: 'echo hello' });
    const sudoed = estimateRisk('run_command', { cmd: 'sudo chmod 777 /etc' });
    expect(sudoed.score).toBeGreaterThan(safe.score);
  });

  test('skill inconnu → niveau MEDIUM par défaut', () => {
    const r = estimateRisk('skill_inconnu_xyz');
    expect(r.level).toBe(RiskLevel.MEDIUM);
    expect(r.sideEffects).toContain('unknown');
  });

  test('retourne sideEffects attendus pour open_app', () => {
    const r = estimateRisk('open_app');
    expect(r.sideEffects).toContain('app_launch');
  });
});

// ─── simulate ──────────────────────────────────────────────────────────────────

describe('simulate', () => {
  test('retourne tous les champs attendus', () => {
    const result = simulate({ skill: 'take_screenshot' });
    expect(result).toHaveProperty('skill');
    expect(result).toHaveProperty('successProbability');
    expect(result).toHaveProperty('riskLevel');
    expect(result).toHaveProperty('riskScore');
    expect(result).toHaveProperty('sideEffects');
    expect(result).toHaveProperty('estimatedDurationMs');
    expect(result).toHaveProperty('requiresConfirmation');
    expect(result).toHaveProperty('predictedState');
  });

  test('successProbability est plus élevée pour les skills safe', () => {
    const safe    = simulate({ skill: 'take_screenshot' });
    const risky   = simulate({ skill: 'run_shell' });
    expect(safe.successProbability).toBeGreaterThan(risky.successProbability);
  });

  test('successProbability >= 0.1 même pour un skill très risqué', () => {
    const r = simulate({ skill: 'run_shell', params: { cmd: 'rm -rf /' } });
    expect(r.successProbability).toBeGreaterThanOrEqual(0.1);
  });

  test('requiresConfirmation=true pour run_command', () => {
    const r = simulate({ skill: 'run_command' });
    expect(r.requiresConfirmation).toBe(true);
  });

  test('estimatedDurationMs > 0 pour tout skill', () => {
    const skills = ['take_screenshot', 'open_app', 'goto_url', 'type_text', 'run_shell'];
    for (const skill of skills) {
      const r = simulate({ skill });
      expect(r.estimatedDurationMs).toBeGreaterThan(0);
    }
  });
});

// ─── simulatePlan ──────────────────────────────────────────────────────────────

describe('simulatePlan', () => {
  test('retourne un rapport par étape', () => {
    const steps = [
      { skill: 'take_screenshot' },
      { skill: 'open_app', params: { app: 'Safari' } },
      { skill: 'goto_url', params: { url: 'https://example.com' } },
    ];
    const results = simulatePlan(steps);
    expect(results).toHaveLength(3);
    expect(results[0].skill).toBe('take_screenshot');
    expect(results[1].skill).toBe('open_app');
    expect(results[2].skill).toBe('goto_url');
  });
});
