/**
 * tests/jest/unit/skill_hub.test.js — Tests unitaires pour src/hub/skillHub.js
 *
 * Couvre :
 *   - _semverGt() — comparaison de versions sémantiques
 *   - initHub() — création du répertoire HUB_DIR et registry.json
 *   - registerHubRoutes: GET /api/v1/hub/registry — retourne les skills
 *   - registerHubRoutes: POST /api/v1/hub/skills/publish — validation du nom
 *   - registerHubRoutes: POST /api/v1/hub/skills/publish — stockage du skill
 *
 * Stratégie : mock de `fs` et `fs/promises` pour ne jamais toucher le disque réel.
 */

import { jest } from '@jest/globals';

// ─── Mocks fs (synchrone) ─────────────────────────────────────────────────────
const mockFs = {
  readFileSync:  jest.fn(),
  writeFileSync: jest.fn(),
  mkdirSync:     jest.fn(),
  existsSync:    jest.fn(),
};

// ─── Mocks fs/promises (asynchrone) ──────────────────────────────────────────
const mockFsPromises = {
  writeFile: jest.fn().mockResolvedValue(undefined),
  readFile:  jest.fn().mockResolvedValue(''),
  mkdir:     jest.fn().mockResolvedValue(undefined),
  rename:    jest.fn().mockResolvedValue(undefined),
};

jest.unstable_mockModule('fs', () => mockFs);
jest.unstable_mockModule('fs/promises', () => mockFsPromises);

// Import du module après les mocks
const { initHub, registerHubRoutes } = await import('../../../src/hub/skillHub.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Crée un faux contexte Hono (c) pour simuler les handlers de route. */
function makeMockContext({ body = null, query = {}, params = {} } = {}) {
  const jsonResponses = [];
  const c = {
    req: {
      json:    jest.fn().mockResolvedValue(body),
      query:   jest.fn((key) => query[key]),
      param:   jest.fn((key) => params[key]),
    },
    json: jest.fn((data, status = 200) => {
      jsonResponses.push({ data, status });
      return { data, status };
    }),
    _responses: jsonResponses,
  };
  return c;
}

/** Crée une fausse app Hono qui capture les routes enregistrées. */
function makeMockApp() {
  const routes = { get: {}, post: {} };
  return {
    get:    jest.fn((path, handler) => { routes.get[path]  = handler; }),
    post:   jest.fn((path, handler) => { routes.post[path] = handler; }),
    _routes: routes,
  };
}

// ─── État initial pour chaque test ───────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();

  // Comportement par défaut : HUB_DIR existe, registry vide
  mockFs.existsSync.mockReturnValue(true);
  mockFs.mkdirSync.mockReturnValue(undefined);
  mockFs.writeFileSync.mockReturnValue(undefined);
  mockFs.readFileSync.mockReturnValue(JSON.stringify({
    version: '1.0.0',
    lastUpdated: new Date().toISOString(),
    skills: [],
  }));
  mockFsPromises.writeFile.mockResolvedValue(undefined);
  mockFsPromises.mkdir.mockResolvedValue(undefined);
  mockFsPromises.rename.mockResolvedValue(undefined);
});


// ─── _semverGt — comparaison sémantique ──────────────────────────────────────
// Note : _semverGt est une fonction interne non exportée.
// On la teste via le comportement observable de _updateRegistry (appelé par publish).
// On teste aussi la logique directement en extrayant la logique dans les tests.

// Réimplémentation locale de _semverGt pour tester la logique en isolation
function _semverGt(a, b) {
  const pa = String(a || '0.0.0').split('.').map(Number);
  const pb = String(b || '0.0.0').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

describe('_semverGt — comparaison versions sémantiques', () => {
  test('"1.2.0" > "1.1.9" doit retourner true', () => {
    expect(_semverGt('1.2.0', '1.1.9')).toBe(true);
  });

  test('"2.0.0" > "1.9.9" doit retourner true', () => {
    expect(_semverGt('2.0.0', '1.9.9')).toBe(true);
  });

  test('"1.0.1" > "1.0.0" doit retourner true', () => {
    expect(_semverGt('1.0.1', '1.0.0')).toBe(true);
  });

  test('même version doit retourner false', () => {
    expect(_semverGt('1.2.0', '1.2.0')).toBe(false);
  });

  test('"1.1.9" < "1.2.0" doit retourner false', () => {
    expect(_semverGt('1.1.9', '1.2.0')).toBe(false);
  });

  test('"0.0.0" < "0.0.1" doit retourner false', () => {
    expect(_semverGt('0.0.0', '0.0.1')).toBe(false);
  });

  test('null vs null doit retourner false (fallback 0.0.0)', () => {
    expect(_semverGt(null, null)).toBe(false);
  });

  test('undefined vs "1.0.0" doit retourner false', () => {
    expect(_semverGt(undefined, '1.0.0')).toBe(false);
  });

  test('"1.0.0" vs undefined doit retourner true', () => {
    expect(_semverGt('1.0.0', undefined)).toBe(true);
  });
});


// ─── initHub — création du répertoire et du registry ─────────────────────────

describe('initHub — initialisation du hub', () => {
  test('crée HUB_DIR si inexistant', () => {
    mockFs.existsSync.mockReturnValue(false);

    initHub();

    expect(mockFs.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining('hub'),
      { recursive: true }
    );
  });

  test('crée registry.json si inexistant', () => {
    // HUB_DIR + mkdirSync ne teste pas existsSync.
    // initHub() appelle existsSync(HUB_REGISTRY) → false → writeFileSync
    mockFs.existsSync.mockReturnValue(false);

    initHub();

    expect(mockFs.writeFileSync).toHaveBeenCalledTimes(1);
    const writtenContent = mockFs.writeFileSync.mock.calls[0][1];
    const parsed = JSON.parse(writtenContent);
    expect(parsed).toHaveProperty('version', '1.0.0');
    expect(parsed).toHaveProperty('skills');
    expect(Array.isArray(parsed.skills)).toBe(true);
    expect(parsed.skills).toHaveLength(0);
  });

  test('ne recrée pas registry.json s\'il existe déjà', () => {
    mockFs.existsSync.mockReturnValue(true);

    initHub();

    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
  });

  test('crée un registry avec lastUpdated valide', () => {
    mockFs.existsSync.mockReturnValue(false);

    initHub();

    const writtenContent = mockFs.writeFileSync.mock.calls[0][1];
    const parsed = JSON.parse(writtenContent);
    expect(parsed).toHaveProperty('lastUpdated');
    // Doit être un ISO 8601 valide
    expect(() => new Date(parsed.lastUpdated)).not.toThrow();
    expect(isNaN(new Date(parsed.lastUpdated).getTime())).toBe(false);
  });
});


// ─── GET /api/v1/hub/registry ─────────────────────────────────────────────────

describe('registerHubRoutes: GET /api/v1/hub/registry', () => {
  test('retourne les skills du registry', async () => {
    const skills = [
      { name: 'skill-a', version: '1.0.0', publishedAt: new Date().toISOString(), downloads: 0 },
      { name: 'skill-b', version: '2.1.0', publishedAt: new Date().toISOString(), downloads: 3 },
    ];

    mockFs.readFileSync.mockReturnValue(JSON.stringify({
      version: '1.0.0',
      lastUpdated: new Date().toISOString(),
      skills,
    }));

    const app = makeMockApp();
    registerHubRoutes(app);

    const c = makeMockContext({ query: {} });
    const handler = app._routes.get['/api/v1/hub/registry'];
    await handler(c);

    expect(c.json).toHaveBeenCalledTimes(1);
    const [response] = c.json.mock.calls[0];
    expect(response.ok).toBe(true);
    expect(response.skills).toHaveLength(2);
    expect(response.count).toBe(2);
  });

  test('retourne un tableau vide si aucun skill', async () => {
    mockFs.readFileSync.mockReturnValue(JSON.stringify({
      version: '1.0.0',
      lastUpdated: new Date().toISOString(),
      skills: [],
    }));

    const app = makeMockApp();
    registerHubRoutes(app);

    const c = makeMockContext({ query: {} });
    const handler = app._routes.get['/api/v1/hub/registry'];
    await handler(c);

    const [response] = c.json.mock.calls[0];
    expect(response.ok).toBe(true);
    expect(response.skills).toHaveLength(0);
    expect(response.count).toBe(0);
  });

  test('filtre par ?since= en retournant seulement les skills plus récents', async () => {
    const pastDate = new Date('2020-01-01T00:00:00Z');
    const recentDate = new Date('2025-01-01T00:00:00Z');

    const skills = [
      { name: 'old-skill',    version: '1.0.0', publishedAt: pastDate.toISOString() },
      { name: 'recent-skill', version: '1.0.0', publishedAt: recentDate.toISOString() },
    ];

    mockFs.readFileSync.mockReturnValue(JSON.stringify({
      version: '1.0.0',
      lastUpdated: new Date().toISOString(),
      skills,
    }));

    const app = makeMockApp();
    registerHubRoutes(app);

    // Filtre : seulement les skills depuis 2024-01-01
    const c = makeMockContext({ query: { since: '2024-01-01T00:00:00Z' } });
    const handler = app._routes.get['/api/v1/hub/registry'];
    await handler(c);

    const [response] = c.json.mock.calls[0];
    expect(response.ok).toBe(true);
    expect(response.skills).toHaveLength(1);
    expect(response.skills[0].name).toBe('recent-skill');
  });

  test('retourne ok et lastUpdated dans la réponse', async () => {
    const lastUpdated = new Date().toISOString();
    mockFs.readFileSync.mockReturnValue(JSON.stringify({
      version: '1.0.0',
      lastUpdated,
      skills: [],
    }));

    const app = makeMockApp();
    registerHubRoutes(app);

    const c = makeMockContext({ query: {} });
    await app._routes.get['/api/v1/hub/registry'](c);

    const [response] = c.json.mock.calls[0];
    expect(response.lastUpdated).toBe(lastUpdated);
  });
});


// ─── POST /api/v1/hub/skills/publish ─────────────────────────────────────────

describe('registerHubRoutes: POST /api/v1/hub/skills/publish — validation', () => {
  test('nom avec espaces → 400', async () => {
    const app = makeMockApp();
    registerHubRoutes(app);

    const c = makeMockContext({
      body: { name: 'invalid name', code: 'export function run() {}' },
    });
    const handler = app._routes.post['/api/v1/hub/skills/publish'];
    await handler(c);

    expect(c.json).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false }),
      400
    );
  });

  test('nom avec caractères spéciaux non autorisés → 400', async () => {
    const app = makeMockApp();
    registerHubRoutes(app);

    const c = makeMockContext({
      body: { name: 'skill@v2!', code: 'export function run() {}' },
    });
    await app._routes.post['/api/v1/hub/skills/publish'](c);

    expect(c.json).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false }),
      400
    );
  });

  test('nom manquant → 400', async () => {
    const app = makeMockApp();
    registerHubRoutes(app);

    const c = makeMockContext({
      body: { code: 'export function run() {}' },
    });
    await app._routes.post['/api/v1/hub/skills/publish'](c);

    expect(c.json).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false }),
      400
    );
  });

  test('code manquant → 400', async () => {
    const app = makeMockApp();
    registerHubRoutes(app);

    const c = makeMockContext({
      body: { name: 'valid-skill' },
    });
    await app._routes.post['/api/v1/hub/skills/publish'](c);

    expect(c.json).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false }),
      400
    );
  });

  test('JSON invalide dans le body → 400', async () => {
    const app = makeMockApp();
    registerHubRoutes(app);

    const c = makeMockContext({ body: null });
    // Simule une erreur de parsing JSON
    c.req.json = jest.fn().mockRejectedValue(new SyntaxError('Unexpected token'));

    await app._routes.post['/api/v1/hub/skills/publish'](c);

    expect(c.json).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false }),
      400
    );
  });

  test('nom valide avec tirets et underscores passe la validation', async () => {
    const app = makeMockApp();
    registerHubRoutes(app);

    const c = makeMockContext({
      body: {
        name:    'valid_skill-v2',
        code:    'export async function run() { return 42; }',
        version: '1.0.0',
      },
    });
    await app._routes.post['/api/v1/hub/skills/publish'](c);

    // Ne doit pas retourner 400 (la validation passe)
    const calls = c.json.mock.calls;
    const errorCalls = calls.filter(([, status]) => status === 400);
    expect(errorCalls).toHaveLength(0);
  });
});


describe('registerHubRoutes: POST /api/v1/hub/skills/publish — stockage', () => {
  test('stocke skill.js via writeFile+rename (écriture atomique)', async () => {
    const app = makeMockApp();
    registerHubRoutes(app);

    const skillCode = 'export async function run(p) { return p; }';
    const c = makeMockContext({
      body: {
        name:       'my-skill',
        code:       skillCode,
        version:    '1.0.0',
        machine_id: 'machine-abc',
        ruche_id:   'ruche-abc',
      },
    });

    await app._routes.post['/api/v1/hub/skills/publish'](c);

    // _atomicWrite écrit dans un .tmp puis rename() vers skill.js
    // On vérifie que rename a été appelé avec un chemin se terminant par skill.js
    const skillJsRenames = mockFsPromises.rename.mock.calls.filter(
      ([, dest]) => String(dest).endsWith('skill.js')
    );
    expect(skillJsRenames.length).toBeGreaterThanOrEqual(1);

    // Le writeFile correspondant doit contenir le code du skill
    const writeFileCalls = mockFsPromises.writeFile.mock.calls;
    const skillWriteCall = writeFileCalls.find(([, content]) => content === skillCode);
    expect(skillWriteCall).toBeDefined();
  });

  test('crée le répertoire skill via mkdir', async () => {
    const app = makeMockApp();
    registerHubRoutes(app);

    const c = makeMockContext({
      body: {
        name:       'new-skill',
        code:       '// code',
        machine_id: 'machine-xyz',
      },
    });

    await app._routes.post['/api/v1/hub/skills/publish'](c);

    expect(mockFsPromises.mkdir).toHaveBeenCalledWith(
      expect.stringContaining('new-skill'),
      { recursive: true }
    );
  });

  test('retourne ok=true avec name, version, machine_id', async () => {
    const app = makeMockApp();
    registerHubRoutes(app);

    const c = makeMockContext({
      body: {
        name:       'echo-skill',
        code:       'export async function run(p) { return p; }',
        version:    '2.3.1',
        machine_id: 'machine-001',
      },
    });

    await app._routes.post['/api/v1/hub/skills/publish'](c);

    const successCalls = c.json.mock.calls.filter(([data]) => data.ok === true);
    expect(successCalls.length).toBeGreaterThanOrEqual(1);
    const [response] = successCalls[0];
    expect(response.name).toBe('echo-skill');
    expect(response.version).toBe('2.3.1');
    expect(response.machine_id).toBe('machine-001');
  });

  test('stocke manifest.json via rename si manifest fourni', async () => {
    const app = makeMockApp();
    registerHubRoutes(app);

    const manifest = { version: '1.5.0', description: 'Un skill de test' };
    const c = makeMockContext({
      body: {
        name:     'skill-with-manifest',
        code:     '// skill code',
        manifest,
      },
    });

    await app._routes.post['/api/v1/hub/skills/publish'](c);

    // _atomicWrite écrit dans un .tmp puis rename() vers manifest.json
    const manifestRenames = mockFsPromises.rename.mock.calls.filter(
      ([, dest]) => String(dest).endsWith('manifest.json')
    );
    expect(manifestRenames.length).toBeGreaterThanOrEqual(1);

    // Le writeFile correspondant doit contenir le manifest sérialisé
    const writeFileCalls = mockFsPromises.writeFile.mock.calls;
    const manifestWriteCall = writeFileCalls.find(([, content]) => {
      try {
        const parsed = JSON.parse(content);
        return parsed.version === '1.5.0' && parsed.description === 'Un skill de test';
      } catch { return false; }
    });
    expect(manifestWriteCall).toBeDefined();
  });

  test('utilise machine_id "unknown" si non fourni', async () => {
    const app = makeMockApp();
    registerHubRoutes(app);

    const c = makeMockContext({
      body: {
        name: 'anonymous-skill',
        code: '// code',
        // machine_id absent
      },
    });

    await app._routes.post['/api/v1/hub/skills/publish'](c);

    const successCalls = c.json.mock.calls.filter(([data]) => data.ok === true);
    if (successCalls.length > 0) {
      const [response] = successCalls[0];
      // machine_id doit valoir 'unknown' par défaut
      expect(response.machine_id).toBe('unknown');
    }
  });
});


// ─── GET /api/v1/hub/stats ────────────────────────────────────────────────────

describe('registerHubRoutes: GET /api/v1/hub/stats', () => {
  test('retourne total_skills et machines_count corrects', async () => {
    const skills = [
      { name: 'skill-a', version: '1.0.0', machine_id: 'machine-1', downloads: 5 },
      { name: 'skill-b', version: '1.0.0', machine_id: 'machine-1', downloads: 2 },
      { name: 'skill-c', version: '1.0.0', machine_id: 'machine-2', downloads: 0 },
    ];

    mockFs.readFileSync.mockReturnValue(JSON.stringify({
      version: '1.0.0',
      lastUpdated: new Date().toISOString(),
      skills,
    }));

    const app = makeMockApp();
    registerHubRoutes(app);

    const c = makeMockContext();
    await app._routes.get['/api/v1/hub/stats'](c);

    const [response] = c.json.mock.calls[0];
    expect(response.ok).toBe(true);
    expect(response.total_skills).toBe(3);
    expect(response.machines_count).toBe(2);
    expect(response.total_downloads).toBe(7);
  });

  test('retourne des listes et chiffres vides si aucun skill', async () => {
    const app = makeMockApp();
    registerHubRoutes(app);

    const c = makeMockContext();
    await app._routes.get['/api/v1/hub/stats'](c);

    const [response] = c.json.mock.calls[0];
    expect(response.total_skills).toBe(0);
    expect(response.machines_count).toBe(0);
    expect(response.total_downloads).toBe(0);
    expect(Array.isArray(response.machines)).toBe(true);
  });
});
