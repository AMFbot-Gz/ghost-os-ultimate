/**
 * src/simulation/desktopModel.js — Modèle simplifié de l'état du bureau macOS
 *
 * Maintient un snapshot de l'état courant du bureau en RAM et permet
 * de prédire l'état résultant d'une action sans l'exécuter réellement.
 * Utilisé par actionSimulator.js pour enrichir les simulations de plan.
 */

// ─── État interne du bureau ────────────────────────────────────────────────────

let _desktopState = {
  activeApp:      null,  // Application active (string ou null)
  openWindows:    [],    // Fenêtres ouvertes [{ app, title }]
  lastScreenshot: null,  // Chemin vers le dernier screenshot (string ou null)
  updatedAt:      null,  // ISO timestamp de la dernière mise à jour
};

// ─── API publique ──────────────────────────────────────────────────────────────

/**
 * Met à jour partiellement l'état du bureau.
 * Fusionne le patch avec l'état existant (Object.assign).
 *
 * @param {Partial<typeof _desktopState>} patch
 */
export function updateDesktopState(patch) {
  Object.assign(_desktopState, patch, { updatedAt: new Date().toISOString() });
}

/**
 * Retourne une copie de l'état courant du bureau.
 * @returns {object}
 */
export function getDesktopState() {
  return { ..._desktopState };
}

/**
 * Prédit l'état du bureau après l'exécution d'une action.
 * Ne modifie PAS l'état courant — retourne un état hypothétique.
 *
 * Actions reconnues :
 *   - open_app   → met à jour activeApp
 *   - close_app  → retire la fenêtre de openWindows
 *   - goto_url   → activeApp devient 'Safari'
 *
 * @param {{ type: string, params?: object }} action
 * @returns {object} État prédit (copie)
 */
export function predictStateAfter(action) {
  const state = { ..._desktopState, openWindows: [..._desktopState.openWindows] };

  switch (action.type) {
    case 'open_app':
      state.activeApp = action.params?.app;
      break;
    case 'close_app':
      state.openWindows = state.openWindows.filter(w => w.app !== action.params?.app);
      break;
    case 'goto_url':
      state.activeApp = 'Safari';
      break;
    // Autres actions → état inchangé
  }

  return state;
}
