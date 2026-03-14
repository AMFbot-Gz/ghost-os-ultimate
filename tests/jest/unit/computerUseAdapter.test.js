/**
 * tests/jest/unit/computerUseAdapter.test.js
 * Tests unitaires pour ComputerUseAdapter, DaemonClientAdapter,
 * machine_registry et propagation machine_id dans les missions.
 *
 * Stratégie : tests directs sur les classes (pas de unstable_mockModule
 * qui cause des TDZ sur l'héritage ESM). Les méthodes I/O sont spyées.
 */

import { jest } from '@jest/globals';
import { ComputerUseAdapter } from '../../../src/computer_use/adapter.js';
import { ACTION_TYPES, WAIT_TYPES } from '../../../src/computer_use/types.js';
import { DaemonClientAdapter } from '../../../src/computer_use/adapters/daemon_client.js';
import { createMissionEntry } from '../../../src/api/missions.js';

// ─── ComputerUseAdapter (classe de base) ──────────────────────────────────────

describe('ComputerUseAdapter — classe de base', () => {
  test('constructeur requiert machineId', () => {
    expect(() => new ComputerUseAdapter('')).toThrow('machineId');
    expect(() => new ComputerUseAdapter(null)).toThrow();
  });

  test('stocke machineId et config', () => {
    const a = new ComputerUseAdapter('test-id', { foo: 'bar' });
    expect(a.machineId).toBe('test-id');
    expect(a.config.foo).toBe('bar');
  });

  test('toutes les méthodes abstraites lèvent une erreur', async () => {
    const a = new ComputerUseAdapter('x');
    await expect(a.health()).rejects.toThrow('non implémenté');
    await expect(a.observe()).rejects.toThrow('non implémenté');
    await expect(a.act({})).rejects.toThrow('non implémenté');
    await expect(a.screenshot()).rejects.toThrow('non implémenté');
    await expect(a.waitFor({})).rejects.toThrow('non implémenté');
  });
});

// ─── ACTION_TYPES ──────────────────────────────────────────────────────────────

describe('ACTION_TYPES', () => {
  test('tous les types requis sont définis', () => {
    const required = ['click', 'type_text', 'press_key', 'open_app', 'goto_url',
                      'smart_click', 'find_element', 'scroll', 'drag', 'wait'];
    for (const t of required) {
      expect(Object.values(ACTION_TYPES)).toContain(t);
    }
  });

  test('est immutable (Object.freeze)', () => {
    expect(() => { ACTION_TYPES.NEW = 'x'; }).toThrow();
  });
});

// ─── WAIT_TYPES ────────────────────────────────────────────────────────────────

describe('WAIT_TYPES', () => {
  test('contient les types de base', () => {
    expect(WAIT_TYPES.ELEMENT_VISIBLE).toBeDefined();
    expect(WAIT_TYPES.SCREEN_STABLE).toBeDefined();
  });
});

// ─── DaemonClientAdapter ──────────────────────────────────────────────────────

describe('DaemonClientAdapter', () => {
  let adapter;
  let fetchSpy;

  function mockFetch(data, status = 200) {
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: status < 400,
      status,
      json: async () => ({ success: true, data, machine_id: 'remote-mac', ...data }),
    });
  }

  afterEach(() => { fetchSpy?.mockRestore(); });

  test('constructeur requiert daemonUrl', () => {
    expect(() => new DaemonClientAdapter('x', {})).toThrow('daemonUrl');
  });

  test('constructeur stocke machineId et daemonUrl', () => {
    const a = new DaemonClientAdapter('remote-mac', { daemonUrl: 'http://10.0.0.1:9000' });
    expect(a.machineId).toBe('remote-mac');
    expect(a.daemonUrl).toBe('http://10.0.0.1:9000');
  });

  test('daemonUrl trailing slash supprimé', () => {
    const a = new DaemonClientAdapter('x', { daemonUrl: 'http://10.0.0.1:9000/' });
    expect(a.daemonUrl).toBe('http://10.0.0.1:9000');
  });

  test('health() fait GET /health', async () => {
    mockFetch({ machine_id: 'remote-mac', platform: 'darwin' });
    const a = new DaemonClientAdapter('remote-mac', { daemonUrl: 'http://10.0.0.1:9000' });
    const result = await a.health();
    expect(fetchSpy).toHaveBeenCalledWith('http://10.0.0.1:9000/health', expect.any(Object));
    expect(result.success).toBe(true);
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });

  test('observe() fait POST /observe avec options', async () => {
    mockFetch({ app: 'Safari', elements: [] });
    const a = new DaemonClientAdapter('remote-mac', { daemonUrl: 'http://10.0.0.1:9000' });
    await a.observe({ app: 'Safari' });
    const call = fetchSpy.mock.calls[0];
    expect(call[0]).toBe('http://10.0.0.1:9000/observe');
    expect(call[1].method).toBe('POST');
    const body = JSON.parse(call[1].body);
    expect(body.machine_id).toBe('remote-mac');
    expect(body.options.app).toBe('Safari');
  });

  test('act() fait POST /act avec type et params', async () => {
    mockFetch({ clicked: 'OK' });
    const a = new DaemonClientAdapter('remote-mac', { daemonUrl: 'http://10.0.0.1:9000' });
    await a.act({ type: ACTION_TYPES.SMART_CLICK, params: { query: 'OK' } });
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.action.type).toBe(ACTION_TYPES.SMART_CLICK);
    expect(body.action.params.query).toBe('OK');
  });

  test('screenshot() fait POST /screenshot', async () => {
    mockFetch({ path: '/tmp/shot.png' });
    const a = new DaemonClientAdapter('remote-mac', { daemonUrl: 'http://10.0.0.1:9000' });
    const result = await a.screenshot({ path: '/tmp/shot.png' });
    expect(fetchSpy.mock.calls[0][0]).toBe('http://10.0.0.1:9000/screenshot');
    expect(result.success).toBe(true);
  });

  test('waitFor() fait POST /wait avec condition et timeout', async () => {
    mockFetch({ found: true });
    const a = new DaemonClientAdapter('remote-mac', { daemonUrl: 'http://10.0.0.1:9000' });
    await a.waitFor({ type: WAIT_TYPES.ELEMENT_VISIBLE, params: { query: 'OK' } }, 5000);
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.timeout_ms).toBe(5000);
    expect(body.condition.type).toBe(WAIT_TYPES.ELEMENT_VISIBLE);
  });

  test('erreur réseau → success:false avec message d\'erreur', async () => {
    fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const a = new DaemonClientAdapter('net-err-test', { daemonUrl: 'http://10.0.0.1:9000' });
    const result = await a._get('/health');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  test('secret envoyé dans X-Ghost-Secret', async () => {
    mockFetch({});
    const a = new DaemonClientAdapter('x', { daemonUrl: 'http://10.0.0.1:9000', secret: 'tok123' });
    await a.health();
    expect(fetchSpy.mock.calls[0][1].headers['X-Ghost-Secret']).toBe('tok123');
  });

  test('pas de secret → pas de header X-Ghost-Secret', async () => {
    mockFetch({});
    // s'assure que DAEMON_SECRET n'est pas défini
    const origSecret = process.env.DAEMON_SECRET;
    delete process.env.DAEMON_SECRET;
    const a = new DaemonClientAdapter('x', { daemonUrl: 'http://10.0.0.1:9000' });
    await a.health();
    expect(fetchSpy.mock.calls[0][1].headers['X-Ghost-Secret']).toBeUndefined();
    if (origSecret) process.env.DAEMON_SECRET = origSecret;
  });
});

// ─── Propagation machine_id dans createMissionEntry ──────────────────────────

describe('createMissionEntry — machine_id', () => {
  test('inclut machine_id explicite', () => {
    const entry = createMissionEntry('liste les fichiers', 'mac-bureau');
    expect(entry.machine_id).toBe('mac-bureau');
    expect(entry.command).toBe('liste les fichiers');
    expect(entry.status).toBe('pending');
    expect(entry.id).toMatch(/^m-\d+-[a-f0-9]{8}$/);
    expect(entry.startedAt).toBeDefined();
    expect(entry.timeoutAt).toBeDefined();
  });

  test('utilise mac-local comme défaut si pas de machine_id ni MACHINE_ID', () => {
    const origMachineId = process.env.MACHINE_ID;
    delete process.env.MACHINE_ID;
    const entry = createMissionEntry('test');
    expect(entry.machine_id).toBe('mac-local');
    if (origMachineId) process.env.MACHINE_ID = origMachineId;
  });

  test('l\'entrée a les champs requis', () => {
    const entry = createMissionEntry('test mission', 'my-machine');
    expect(entry).toMatchObject({
      status: 'pending',
      result: null,
      error: null,
      events: [],
      machine_id: 'my-machine',
    });
  });

  test('ids distincts pour 2 missions simultanées', () => {
    const a = createMissionEntry('mission A', 'mac');
    const b = createMissionEntry('mission B', 'mac');
    expect(a.id).not.toBe(b.id);
  });
});
