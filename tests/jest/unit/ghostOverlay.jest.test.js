/**
 * test/unit/ghostOverlay.jest.test.js — Tests unitaires du Ghost Overlay HUD
 *
 * Couvre : exports du module, comportement de sendOverlayEvent sans fenêtre active
 */

import { jest } from '@jest/globals';

// Mock electron via unstable_mockModule (API ESM de Jest)
await jest.unstable_mockModule('electron', () => ({
  default: {},
  BrowserWindow: class MockBrowserWindow {
    constructor() {}
    isDestroyed() { return true; }
    setIgnoreMouseEvents() {}
    loadFile() {}
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
    close() {}
    get webContents() {
      return { executeJavaScript: jest.fn().mockResolvedValue(undefined) };
    }
  },
  screen: {
    getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }),
  },
}));

// Import après le mock pour que Jest intercèpte electron
const mod = await import('../../hud/src/ghost-overlay/ghostOverlay.mjs');

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ghostOverlay — exports', () => {
  test('exporte createGhostOverlay en tant que fonction', () => {
    expect(typeof mod.createGhostOverlay).toBe('function');
  });

  test('exporte toutes les fonctions publiques attendues', () => {
    const expectedExports = [
      'createGhostOverlay',
      'sendOverlayEvent',
      'showElementHighlight',
      'flashAction',
      'showOverlayStatus',
      'clearOverlay',
      'destroyOverlay',
    ];
    for (const name of expectedExports) {
      expect(typeof mod[name]).toBe('function');
    }
  });
});

describe('ghostOverlay — sendOverlayEvent sans fenêtre', () => {
  test('ne lève pas d\'exception si aucune fenêtre overlay n\'est ouverte', () => {
    // Aucune fenêtre créée → _overlayWin est null → doit être silencieux
    expect(() => mod.sendOverlayEvent({ type: 'status', message: 'test' })).not.toThrow();
    expect(() => mod.showOverlayStatus('test')).not.toThrow();
    expect(() => mod.clearOverlay()).not.toThrow();
    expect(() => mod.flashAction(100, 200, true)).not.toThrow();
    expect(() => mod.destroyOverlay()).not.toThrow();
  });
});
