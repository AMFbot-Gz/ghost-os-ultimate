export const FailureType = {
  TIMEOUT: 'timeout',
  ELEMENT_NOT_FOUND: 'element_not_found',
  LLM_PARSE_ERROR: 'llm_parse_error',
  SKILL_MISSING: 'skill_missing',
  PERMISSION_DENIED: 'permission_denied',
  NETWORK_ERROR: 'network_error',
  UNKNOWN: 'unknown',
};

export function detectFailureType(error = '', stepResult = {}) {
  const e = (error || '').toLowerCase();
  if (e.includes('timeout') || e.includes('timedout')) return FailureType.TIMEOUT;
  if (e.includes('not found') || e.includes('introuvable') || e.includes('element')) return FailureType.ELEMENT_NOT_FOUND;
  if (e.includes('json') || e.includes('parse') || e.includes('syntax')) return FailureType.LLM_PARSE_ERROR;
  if (e.includes('skill') && e.includes('non trouvé')) return FailureType.SKILL_MISSING;
  if (e.includes('permission') || e.includes('denied')) return FailureType.PERMISSION_DENIED;
  if (e.includes('econnrefused') || e.includes('network') || e.includes('fetch')) return FailureType.NETWORK_ERROR;
  return FailureType.UNKNOWN;
}

export function analyzeFailedMission({ command, steps = [], status }) {
  const failedSteps = steps.filter(s => !s.success || s.result?.success === false);
  if (failedSteps.length === 0) return null;

  const errors = failedSteps.map(s => s.result?.error || s.error || '').filter(Boolean);
  const failureTypes = errors.map(e => detectFailureType(e));

  // Score de gap sémantique — haut si beaucoup de skills manquants ou inconnus
  const missingSkills = failureTypes.filter(t => t === FailureType.SKILL_MISSING).length;
  const unknownErrors = failureTypes.filter(t => t === FailureType.UNKNOWN).length;
  const semanticGapScore = Math.min(1.0, (missingSkills * 0.4 + unknownErrors * 0.2) / Math.max(failedSteps.length, 1));

  return {
    command, failedSteps, errors, failureTypes,
    semanticGapScore,
    shouldGenerateSkill: semanticGapScore > 0.4,
    missingCapability: failedSteps.map(s => s.step?.skill).filter(Boolean).join(', '),
  };
}
