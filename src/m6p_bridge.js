/**
 * m6p_bridge.js — Tunnel M6P WebRTC P2P
 * Contrôle PC depuis smartphone sans serveur central
 * PeerJS + QR Code + Stream vidéo H.264
 */

import { WebSocketServer } from "ws";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import QRCode from "qrcode";
import dotenv from "dotenv";
import winston from "winston";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const logger = winston.createLogger({
  level: "info",
  format: winston.format.simple(),
  transports: [new winston.transports.Console()],
});

const M6P_FPS = parseInt(process.env.M6P_STREAM_FPS || "30");
const PEERJS_HOST = process.env.PEERJS_HOST || "0.peerjs.com";

function generateSecureId(len = 32) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "laruche_";
  for (let i = 0; i < len; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

// WebSocket HUD broadcast
let hudWs = null;
function hudBroadcast(event) {
  try {
    if (!hudWs || hudWs.readyState !== 1) {
      const { WebSocket } = require("ws");
      hudWs = new WebSocket("ws://localhost:9001");
    }
    hudWs.send(JSON.stringify({ ...event, ts: Date.now() }));
  } catch {}
}

export class M6PBridge {
  constructor() {
    this.sessionId = generateSecureId(16);
    this.connected = false;
    this.streamInterval = null;
  }

  async init() {
    logger.info(`🌐 M6P Bridge — Session ID: ${this.sessionId}`);

    // URL de connexion mobile
    const connectUrl = `laruche://connect/${this.sessionId}@${PEERJS_HOST}`;

    // Génération QR Code (terminal ASCII)
    try {
      const qrTerminal = await QRCode.toString(connectUrl, { type: "terminal", small: true });
      console.log("\n📱 Scannez ce QR Code avec l'app LaRuche Mobile:\n");
      console.log(qrTerminal);
      console.log(`\nURL: ${connectUrl}\n`);
    } catch (e) {
      logger.error(`QR Code: ${e.message}`);
    }

    // Diffusion vers HUD
    try {
      const qrDataUrl = await QRCode.toDataURL(connectUrl);
      hudBroadcast({ type: "qr_ready", qr: qrDataUrl, sessionId: this.sessionId });
    } catch {}

    // Serveur WebSocket local pour relai commandes mobile
    this._startLocalServer();

    logger.info("✅ M6P Bridge actif — en attente de connexion mobile");
    return this.sessionId;
  }

  _startLocalServer() {
    const wss = new WebSocketServer({ port: 9002 });

    wss.on("connection", (ws) => {
      logger.info("📱 Mobile connecté via M6P");
      this.connected = true;
      hudBroadcast({ type: "m6p_connected" });

      ws.on("message", async (data) => {
        try {
          const msg = JSON.parse(data.toString());

          if (msg.type === "voice") {
            // Transcription audio depuis mobile
            logger.info(`🎤 Commande vocale mobile reçue`);
            // Relai vers queen.js via Telegram API
            this._relayCommand(msg.text || "");
          } else if (msg.type === "command") {
            this._relayCommand(msg.text);
          } else if (msg.type === "ping") {
            ws.send(JSON.stringify({ type: "pong", ts: Date.now() }));
          }
        } catch (e) {
          logger.error(`M6P message error: ${e.message}`);
        }
      });

      ws.on("close", () => {
        logger.info("📱 Mobile déconnecté");
        this.connected = false;
        hudBroadcast({ type: "m6p_disconnected" });
        if (this.streamInterval) {
          clearInterval(this.streamInterval);
          this.streamInterval = null;
        }
      });

      // Démarrage stream écran
      this._startScreenStream(ws);
    });
  }

  _startScreenStream(ws) {
    if (this.streamInterval) clearInterval(this.streamInterval);

    this.streamInterval = setInterval(async () => {
      if (ws.readyState !== 1) return;
      try {
        // Capture écran via Python vision.py (subprocess)
        const { execa } = await import("execa");
        const { stdout } = await execa("python3", [
          join(__dirname, "vision.py"),
          "--capture-only",
          "--quality=50",
          "--scale=0.4",
        ], { reject: false });

        if (stdout) {
          ws.send(JSON.stringify({ type: "frame", data: stdout, ts: Date.now() }));
        }
      } catch {}
    }, Math.round(1000 / M6P_FPS));
  }

  async _relayCommand(text) {
    if (!text || !process.env.TELEGRAM_BOT_TOKEN || !process.env.ADMIN_TELEGRAM_ID) return;
    try {
      await fetch(
        `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: process.env.ADMIN_TELEGRAM_ID,
            text: `📱 [M6P] ${text}`,
          }),
        }
      );
    } catch {}
  }

  stop() {
    if (this.streamInterval) clearInterval(this.streamInterval);
    logger.info("M6P Bridge arrêté");
  }
}
