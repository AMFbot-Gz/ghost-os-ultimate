import { BrowserWindow, screen } from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

let _overlayWin = null;

export function createGhostOverlay() {
  if (_overlayWin && !_overlayWin.isDestroyed()) return _overlayWin;

  const { bounds } = screen.getPrimaryDisplay();

  _overlayWin = new BrowserWindow({
    x: bounds.x, y: bounds.y,
    width: bounds.width, height: bounds.height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  _overlayWin.setIgnoreMouseEvents(true);
  _overlayWin.loadFile(join(__dirname, 'overlay.html'));
  _overlayWin.setAlwaysOnTop(true, 'screen-saver');
  _overlayWin.setVisibleOnAllWorkspaces(true);

  return _overlayWin;
}

export function sendOverlayEvent(event) {
  if (!_overlayWin || _overlayWin.isDestroyed()) return;
  _overlayWin.webContents.executeJavaScript(
    `window.dispatchEvent(new MessageEvent('message', { data: ${JSON.stringify(event)} }))`
  ).catch(() => {});
}

export function showElementHighlight({ x, y, width, height, label, state = 'pending' }) {
  sendOverlayEvent({ type: 'highlight', x, y, width: width || 120, height: height || 40, label, state, autoFlash: false });
}

export function flashAction(x, y, success = true) {
  sendOverlayEvent({ type: 'highlight', x, y, width: 80, height: 30, state: success ? 'success' : 'error', autoFlash: true, duration: 500 });
  sendOverlayEvent({ type: 'heatmap', x, y });
}

export function showOverlayStatus(message) {
  sendOverlayEvent({ type: 'status', message });
}

export function clearOverlay() {
  sendOverlayEvent({ type: 'clear' });
}

export function destroyOverlay() {
  if (_overlayWin && !_overlayWin.isDestroyed()) _overlayWin.close();
  _overlayWin = null;
}
