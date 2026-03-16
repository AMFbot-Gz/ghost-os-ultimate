/**
 * Tests src/evolution/ — failureDetector + skillRegistry
 */
import { jest } from '@jest/globals';

describe('failureDetector', () => {
  let detectFailureType, analyzeFailedMission, FailureType;

  beforeAll(async () => {
    const mod = await import('../../../src/evolution/failureDetector.js');
    detectFailureType = mod.detectFailureType;
    analyzeFailedMission = mod.analyzeFailedMission;
    FailureType = mod.FailureType;
  });

  // ── detectFailureType ─────────────────────────────────────────────────────────

  test('detectFailureType identifie TIMEOUT', () => {
    expect(detectFailureType('Operation timeout after 5000ms')).toBe(FailureType.TIMEOUT);
    expect(detectFailureType('Request timedout')).toBe(FailureType.TIMEOUT);
  });

  test('detectFailureType identifie ELEMENT_NOT_FOUND', () => {
    expect(detectFailureType('Element not found in DOM')).toBe(FailureType.ELEMENT_NOT_FOUND);
    expect(detectFailureType('bouton introuvable sur la page')).toBe(FailureType.ELEMENT_NOT_FOUND);
  });

  test('detectFailureType identifie LLM_PARSE_ERROR', () => {
    expect(detectFailureType('JSON parse error at position 42')).toBe(FailureType.LLM_PARSE_ERROR);
    expect(detectFailureType('SyntaxError: unexpected token')).toBe(FailureType.LLM_PARSE_ERROR);
  });

  test('detectFailureType retourne UNKNOWN pour erreur non reconnue', () => {
    expect(detectFailureType('Quelque chose a mal tourné de manière inattendue')).toBe(FailureType.UNKNOWN);
    expect(detectFailureType('')).toBe(FailureType.UNKNOWN);
    expect(detectFailureType()).toBe(FailureType.UNKNOWN);
  });

  // ── analyzeFailedMission ──────────────────────────────────────────────────────

  test('analyzeFailedMission retourne null si aucun step échoué', () => {
    const result = analyzeFailedMission({
      command: 'prends un screenshot',
      steps: [
        { success: true, result: { success: true } },
        { success: true, result: { success: true } },
      ],
      status: 'success',
    });
    expect(result).toBeNull();
  });

  test('analyzeFailedMission analyse les steps échoués et calcule semanticGapScore', () => {
    const result = analyzeFailedMission({
      command: 'effectue une tâche complexe inconnue',
      steps: [
        {
          success: false,
          error: 'Skill "skill_xyz" non trouvé dans le registre',
          step: { skill: 'skill_xyz' },
          result: { success: false, error: 'Skill "skill_xyz" non trouvé dans le registre' },
        },
        {
          success: false,
          error: 'Quelque chose a mal tourné de manière mystérieuse',
          step: { skill: 'skill_abc' },
          result: { success: false, error: 'Quelque chose a mal tourné de manière mystérieuse' },
        },
      ],
      status: 'failed',
    });

    expect(result).not.toBeNull();
    expect(result.command).toBe('effectue une tâche complexe inconnue');
    expect(result.failedSteps).toHaveLength(2);
    expect(Array.isArray(result.errors)).toBe(true);
    expect(Array.isArray(result.failureTypes)).toBe(true);
    expect(typeof result.semanticGapScore).toBe('number');
    expect(result.semanticGapScore).toBeGreaterThanOrEqual(0);
    expect(result.semanticGapScore).toBeLessThanOrEqual(1);
    expect(typeof result.shouldGenerateSkill).toBe('boolean');
    expect(typeof result.missingCapability).toBe('string');
  });
});

describe('skillRegistry', () => {
  let trackUsage, shouldImprove, bumpVersion, getAllStats;

  beforeAll(async () => {
    const mod = await import('../../../src/evolution/skillRegistry.js');
    trackUsage = mod.trackUsage;
    shouldImprove = mod.shouldImprove;
    bumpVersion = mod.bumpVersion;
    getAllStats = mod.getAllStats;
  });

  // ── trackUsage ────────────────────────────────────────────────────────────────

  test('trackUsage crée une entrée et incrémente usageCount', () => {
    const skillName = `test_skill_track_${Date.now()}`;
    trackUsage(skillName, { success: true, latencyMs: 100 });

    const stats = getAllStats();
    const entry = stats.find(s => s.skill === skillName);
    expect(entry).toBeDefined();
    expect(entry.usageCount).toBe(1);
    expect(entry.successCount).toBe(1);
    expect(entry.successRate).toBe(1.0);
  });

  test('trackUsage calcule successRate correctement après succès et échecs mixtes', () => {
    const skillName = `test_skill_mixed_${Date.now()}`;
    trackUsage(skillName, { success: true, latencyMs: 50 });
    trackUsage(skillName, { success: true, latencyMs: 60 });
    trackUsage(skillName, { success: false, latencyMs: 200 });
    trackUsage(skillName, { success: false, latencyMs: 210 });

    const stats = getAllStats();
    const entry = stats.find(s => s.skill === skillName);
    expect(entry).toBeDefined();
    expect(entry.usageCount).toBe(4);
    expect(entry.successCount).toBe(2);
    expect(entry.successRate).toBeCloseTo(0.5, 5);
  });

  test('shouldImprove retourne true si usage élevé et taux succès faible', () => {
    const skillName = `test_skill_improve_${Date.now()}`;
    // Simule 10 usages avec seulement 2 succès (20% < 50%)
    for (let i = 0; i < 8; i++) trackUsage(skillName, { success: false, latencyMs: 300 });
    for (let i = 0; i < 2; i++) trackUsage(skillName, { success: true, latencyMs: 100 });

    const result = shouldImprove(skillName, 10, 0.5);
    expect(result).toBe(true);
  });

  test('shouldImprove retourne false si skill inconnu', () => {
    expect(shouldImprove('skill_jamais_vu_xyz_99999')).toBe(false);
  });

  test('bumpVersion incrémente la version du skill', () => {
    const skillName = `test_skill_bump_${Date.now()}`;
    trackUsage(skillName, { success: true, latencyMs: 100 });

    const statsBefore = getAllStats().find(s => s.skill === skillName);
    expect(statsBefore.version).toBe(1);

    bumpVersion(skillName);

    const statsAfter = getAllStats().find(s => s.skill === skillName);
    expect(statsAfter.version).toBe(2);
    expect(statsAfter.lastImproved).toBeDefined();
  });
});
