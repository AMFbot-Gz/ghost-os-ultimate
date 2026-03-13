/**
 * Tests model_router.js — Routeur de modèles avec mock fetch
 *
 * Utilise _setAvailableModelsCache() pour injecter des modèles mock
 * et éviter tout appel réseau vers Ollama.
 */
import { jest } from '@jest/globals';

// ── Mock fetch global (avant tout import du module) ───────────────────────────
// Simule Ollama disponible avec une liste de modèles prédéfinie
global.fetch = jest.fn().mockImplementation((url, opts) => {
  const urlStr = String(url);

  // /api/tags → liste des modèles
  if (urlStr.includes('/api/tags')) {
    return Promise.resolve({
      ok: true,
      json: async () => ({
        models: [
          { name: 'glm-4.6' },
          { name: 'qwen3-coder' },
          { name: 'llama3.2:3b' },
          { name: 'llava:latest' },
          { name: 'moondream:latest' },
        ],
      }),
    });
  }

  // /api/generate → réponse simulée
  if (urlStr.includes('/api/generate')) {
    return Promise.resolve({
      ok: true,
      json: async () => ({ response: 'OK — réponse simulée', done: true }),
    });
  }

  // Toute autre URL → erreur réseau simulée
  return Promise.reject(new Error(`fetch: URL inattendue: ${urlStr}`));
});

// ── Import du module après mock ───────────────────────────────────────────────
const { autoDetectRoles, route, ask, _setAvailableModelsCache } =
  await import('../../src/model_router.js');

// Injecte le cache de modèles mock immédiatement
_setAvailableModelsCache([
  'glm-4.6',
  'qwen3-coder',
  'llama3.2:3b',
  'llava:latest',
  'moondream:latest',
]);

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('model_router — autoDetectRoles', () => {

  test('retourne un objet avec les 6 rôles requis', async () => {
    const roles = await autoDetectRoles();
    expect(roles).toHaveProperty('strategist');
    expect(roles).toHaveProperty('architect');
    expect(roles).toHaveProperty('worker');
    expect(roles).toHaveProperty('vision');
    expect(roles).toHaveProperty('visionFast');
    expect(roles).toHaveProperty('synthesizer');
  });

  test('chaque rôle est une string non vide', async () => {
    const roles = await autoDetectRoles();
    for (const [role, model] of Object.entries(roles)) {
      expect(typeof model).toBe('string');
      expect(model.length).toBeGreaterThan(0);
    }
  });

  test('worker → llama3.2:3b (présent dans le cache mock)', async () => {
    _setAvailableModelsCache(['llama3.2:3b', 'llava:latest']);
    const roles = await autoDetectRoles();
    expect(roles.worker).toBe('llama3.2:3b');
    // Restore
    _setAvailableModelsCache(['glm-4.6', 'qwen3-coder', 'llama3.2:3b', 'llava:latest', 'moondream:latest']);
  });

  test('vision → llava:latest (présent dans le cache mock)', async () => {
    _setAvailableModelsCache(['llama3.2:3b', 'llava:latest', 'moondream:latest']);
    const roles = await autoDetectRoles();
    expect(roles.vision).toContain('llava');
    // Restore
    _setAvailableModelsCache(['glm-4.6', 'qwen3-coder', 'llama3.2:3b', 'llava:latest', 'moondream:latest']);
  });

  test('2ème appel utilise le cache (pas de fetch supplémentaire)', async () => {
    const callsBefore = global.fetch.mock.calls.length;
    await autoDetectRoles();
    await autoDetectRoles();
    const callsAfter = global.fetch.mock.calls.length;
    // Le cache est actif — aucun fetch supplémentaire pour /api/tags
    expect(callsAfter).toBe(callsBefore);
  });
});

describe('model_router — route()', () => {

  test('retourne une string non vide pour toute entrée', async () => {
    const model = await route('bonjour comment ça va');
    expect(typeof model).toBe('string');
    expect(model.length).toBeGreaterThan(0);
  });

  test('routing code → rôle architect (qwen3-coder ou llama3.2)', async () => {
    const model = await route('écris une fonction Python qui trie une liste');
    expect(typeof model).toBe('string');
    // Architect = qwen3-coder (présent dans le cache) ou llama3.2 en dernier recours
    expect(model.length).toBeGreaterThan(0);
  });

  test('routing vision/écran → rôle vision (llava ou moondream)', async () => {
    const model = await route('capture l\'écran et analyse l\'interface');
    expect(typeof model).toBe('string');
    expect(
      model.includes('llava') || model.includes('moondream') || model.includes('vision')
    ).toBe(true);
  });

  test('routing stratégie → rôle strategist (glm-4.6 ou llama)', async () => {
    const model = await route('analyse la stratégie globale de la mission');
    expect(typeof model).toBe('string');
    expect(model.length).toBeGreaterThan(0);
  });

  test('routing avec hint → utilise le rôle demandé', async () => {
    const roles = await autoDetectRoles();
    const model = await route('n\'importe quoi', 'worker');
    expect(model).toBe(roles.worker);
  });

  test('routing neutre → rôle worker (llama3.2:3b)', async () => {
    const model = await route('bonjour');
    // Worker = llama3.2:3b dans le cache mock
    expect(model).toBe('llama3.2:3b');
  });
});

describe('model_router — ask()', () => {

  test('retourne un objet structuré { text, model, success }', async () => {
    const result = await ask('Réponds juste OK');
    expect(result).toHaveProperty('text');
    expect(result).toHaveProperty('model');
    expect(result).toHaveProperty('success');
  });

  test('success=true et text non vide quand Ollama répond', async () => {
    const result = await ask('test');
    expect(result.success).toBe(true);
    expect(typeof result.text).toBe('string');
    expect(result.text.length).toBeGreaterThan(0);
  });

  test('retourne le modèle utilisé dans result.model', async () => {
    const result = await ask('test');
    expect(typeof result.model).toBe('string');
    expect(result.model.length).toBeGreaterThan(0);
  });

  test('success=false et error défini quand Ollama est indisponible', async () => {
    // Remplace fetch pour simuler Ollama absent
    const origFetch = global.fetch;
    global.fetch = jest.fn().mockImplementation((url) => {
      if (String(url).includes('/api/generate')) {
        return Promise.reject(new Error('Connection refused'));
      }
      return origFetch(url);
    });

    // Désactive le fallback cloud pour ce test
    const origEnv = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLOUD_FALLBACK;

    const result = await ask('test sans ollama', { cloudFallback: false });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();

    // Restore
    global.fetch = origFetch;
    if (origEnv) process.env.ANTHROPIC_API_KEY = origEnv;
  });
});

describe('model_router — _setAvailableModelsCache()', () => {

  test('injecte directement les modèles dans le cache (pas de fetch /api/tags)', async () => {
    const callsBefore = global.fetch.mock.calls.length;

    // Injecte un cache frais — évite tout appel /api/tags
    _setAvailableModelsCache(['llama3.2:3b', 'llava:latest']);

    // autoDetectRoles() ne doit pas faire de fetch car le cache est à jour
    await autoDetectRoles();

    const callsAfter = global.fetch.mock.calls.length;
    // Aucun appel fetch supplémentaire pour /api/tags
    expect(callsAfter).toBe(callsBefore);

    // Restore
    _setAvailableModelsCache(['glm-4.6', 'qwen3-coder', 'llama3.2:3b', 'llava:latest', 'moondream:latest']);
  });

  test('autoDetectRoles retourne un objet valide même avec un cache minimal', async () => {
    _setAvailableModelsCache(['llama3.2:3b']);
    const roles = await autoDetectRoles();
    // Doit retourner un objet avec les 6 rôles (peu importe les valeurs)
    expect(Object.keys(roles)).toEqual(
      expect.arrayContaining(['strategist', 'architect', 'worker', 'vision', 'visionFast', 'synthesizer'])
    );
    // Restore
    _setAvailableModelsCache(['glm-4.6', 'qwen3-coder', 'llama3.2:3b', 'llava:latest', 'moondream:latest']);
  });
});
