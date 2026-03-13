/**
 * hud/main.js — Ghost-Monitor HUD LaRuche
 * Fenêtre Electron transparente, always-on-top, click-through
 *
 * IMPORTANT: Le HUD se connecte en CLIENT WebSocket au serveur queen_oss.js (port 9001).
 * Il n'ouvre plus son propre serveur WSS pour éviter le conflit EADDRINUSE.
 * Les événements reçus de queen sont transmis au renderer React via IPC.
 */

const { app, BrowserWindow, globalShortcut, ipcMain, screen } = require("electron");
const { WebSocket } = require("ws");
const path = require("path");

let win = null;
let hudWs = null;
const HUD_PORT = parseInt(process.env.HUD_PORT || "9001", 10);
const HUD_TOKEN = process.env.HUD_TOKEN || null;
const RECONNECT_DELAY_MS = 3000;

// ─── Connexion WS vers queen_oss (client, pas serveur) ───────────────────────
function connectToQueen() {
  const url = HUD_TOKEN
    ? `ws://localhost:${HUD_PORT}?token=${HUD_TOKEN}`
    : `ws://localhost:${HUD_PORT}`;

  hudWs = new WebSocket(url);

  hudWs.on("open", () => {
    console.log(`🐝 LaRuche HUD connecté à queen_oss — ws://localhost:${HUD_PORT}`);
  });

  hudWs.on("message", (data) => {
    try {
      const event = JSON.parse(data.toString());
      // Transmet l'événement au renderer React
      if (win && !win.isDestroyed()) {
        win.webContents.send("hud-event", event);
      }
    } catch {}
  });

  hudWs.on("close", () => {
    console.log(`⚠️ HUD: Connexion perdue — reconnexion dans ${RECONNECT_DELAY_MS}ms`);
    setTimeout(connectToQueen, RECONNECT_DELAY_MS);
  });

  hudWs.on("error", (err) => {
    // Erreur silencieuse — queen n'est peut-être pas encore démarrée
    if (err.code !== "ECONNREFUSED") {
      console.warn(`HUD WebSocket error: ${err.message}`);
    }
  });
}

app.whenReady().then(() => {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  win = new BrowserWindow({
    x: 0,
    y: 0,
    width,
    height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  // CRITIQUE: rend la fenêtre traversable par les clics
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, "src/index.html"));

  // Ctrl+Shift+H → Toggle visibilité HUD
  globalShortcut.register("Ctrl+Shift+H", () => {
    if (win.isVisible()) {
      win.hide();
    } else {
      win.show();
    }
  });

  // Ctrl+Shift+Space → Toggle mode interactif (pour HITL)
  globalShortcut.register("Ctrl+Shift+Space", () => {
    const isIgnoring = win.isIgnoreMouseEventsEnabled?.() ?? true;
    win.setIgnoreMouseEvents(!isIgnoring, { forward: true });
    win.setFocusable(isIgnoring);
    if (isIgnoring) win.focus();
  });

  // Connexion WS vers queen_oss
  connectToQueen();
});

// IPC pour HITL (Human-in-the-Loop) — réponse du renderer vers queen via WS
ipcMain.on("hitl-response", (event, { approved, missionId }) => {
  if (hudWs && hudWs.readyState === WebSocket.OPEN) {
    hudWs.send(JSON.stringify({ type: "hitl_response", approved, missionId }));
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  hudWs?.close();
});
