/**
 * control_mutex.js — Gestion conflit souris humain/IA
 * Détecte l'activité humaine et pause l'IA pendant 5s
 */

import { WebSocket } from "ws";

let humanActive = false;
let idleTimer = null;
let wsClient = null;

function hudBroadcast(event) {
  if (wsClient?.readyState === WebSocket.OPEN) {
    wsClient.send(JSON.stringify({ ...event, ts: Date.now() }));
  }
}

function connectHUD() {
  try {
    wsClient = new WebSocket("ws://localhost:9001");
  } catch {
    // HUD non disponible
  }
}

function onHumanInput() {
  humanActive = true;
  clearTimeout(idleTimer);
  hudBroadcast({ type: "ai_paused", reason: "human_active" });
  idleTimer = setTimeout(() => {
    humanActive = false;
    hudBroadcast({ type: "ai_resuming", countdown: 3 });
  }, 5000);
}

export function isHumanActive() {
  return humanActive;
}

export async function requestControl() {
  if (humanActive) return false;
  hudBroadcast({ type: "ai_control_start" });
  return true;
}

export function releaseControl() {
  hudBroadcast({ type: "ai_control_end" });
}

export function init() {
  connectHUD();
  // uiohook-napi désactivé par défaut — activer si besoin
  // import { uIOhook } from "uiohook-napi";
  // uIOhook.on("mousemove", onHumanInput);
  // uIOhook.on("keydown", onHumanInput);
  // uIOhook.start();
}
