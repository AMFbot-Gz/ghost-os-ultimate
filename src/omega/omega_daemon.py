#!/usr/bin/env python3
"""
omega_daemon.py — Démon HTTP Omega + Bot Telegram UNIQUE
=========================================================
Serveur HTTP léger sur :8021 + polling Telegram dans un thread dédié.
Omega est le SEUL point d'entrée Telegram (TELEGRAM_MODE=omega).

Endpoints HTTP:
  POST /mission          {"mission": "texte"} → rapport
  POST /organ/run        {"name": "...", "params": {...}} → résultat
  POST /organ/create     {"name": "...", "description": "..."} → créer organe
  GET  /organs           → liste des organes
  GET  /health           → {"ok": true, "organs": N}

Telegram (polling long 25s) :
  /start                 → message de bienvenue
  /organs                → liste les organes disponibles
  /status                → état PM2 + santé
  <tout autre texte>     → dispatché comme mission à execute_mission()
"""

import os
import sys
import json
import ssl
import threading
import time
import urllib.request
import urllib.error
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from datetime import datetime

# Contexte SSL avec certifi pour api.telegram.org
try:
    import certifi
    _SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    _SSL_CTX = ssl.create_default_context()
    _SSL_CTX.check_hostname = False
    _SSL_CTX.verify_mode = ssl.CERT_NONE

# Ajouter le répertoire parent pour importer omega
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from src.omega import omega as ω

PORT        = int(os.getenv("OMEGA_PORT", "8021"))
TG_TOKEN    = os.getenv("TELEGRAM_BOT_TOKEN", "")
ADMIN_ID    = os.getenv("ADMIN_TELEGRAM_ID", "")
TG_BASE     = f"https://api.telegram.org/bot{TG_TOKEN}"

# ─── Helpers Telegram ────────────────────────────────────────────────────────

def tg_send(chat_id: str, text: str):
    """Envoie un message Telegram (sendMessage)."""
    if not TG_TOKEN:
        return
    payload = json.dumps({
        "chat_id": chat_id,
        "text": text[:4096],
        "parse_mode": "Markdown"
    }).encode()
    try:
        req = urllib.request.Request(
            f"{TG_BASE}/sendMessage",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        urllib.request.urlopen(req, timeout=10, context=_SSL_CTX)
    except Exception as e:
        print(f"[OmegaTG] sendMessage erreur: {e}")


def tg_get_updates(offset: int, timeout: int = 25) -> list:
    """Long-polling getUpdates."""
    url = f"{TG_BASE}/getUpdates?offset={offset}&timeout={timeout}&allowed_updates=%5B%22message%22%5D"
    try:
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=timeout + 5, context=_SSL_CTX) as resp:
            data = json.loads(resp.read())
            return data.get("result", [])
    except Exception:
        return []


def tg_delete_webhook():
    """Supprime tout webhook existant pour éviter les conflits."""
    url = f"{TG_BASE}/deleteWebhook?drop_pending_updates=true"
    try:
        urllib.request.urlopen(url, timeout=10, context=_SSL_CTX)
        print("[OmegaTG] Webhook supprimé (drop_pending_updates=true)")
    except Exception as e:
        print(f"[OmegaTG] deleteWebhook: {e}")


# ─── Boucle Telegram ─────────────────────────────────────────────────────────

# Set des chat_ids autorisés (ADMIN uniquement par défaut)
_active_missions: dict = {}   # chat_id → thread actif


def _handle_telegram_message(update: dict):
    """Traite un message Telegram entrant."""
    msg    = update.get("message", {})
    chat   = msg.get("chat", {})
    chat_id = str(chat.get("id", ""))
    text   = msg.get("text", "").strip()
    user   = msg.get("from", {}).get("first_name", "?")

    if not chat_id or not text:
        return

    # Sécurité : ADMIN uniquement
    if ADMIN_ID and chat_id != ADMIN_ID:
        tg_send(chat_id, "⛔ Accès refusé.")
        return

    print(f"[OmegaTG] 📩 {user}: {text[:80]}")

    # Commandes spéciales
    if text.startswith("/start"):
        reg = ω.load_registry()
        tg_send(chat_id, f"🤖 *Omega opérationnel* — {len(reg)} organes disponibles.\nEnvoie-moi une mission en français, je l'exécute.")
        return

    if text.startswith("/organs") or text.startswith("/organes"):
        reg = ω.load_registry()
        lines = [f"🧠 *{n}* — {i['description'][:60]}" for n, i in reg.items()]
        tg_send(chat_id, "📋 *Organes disponibles :*\n" + "\n".join(lines))
        return

    if text.startswith("/status"):
        import subprocess
        res = subprocess.run(["pm2", "list", "--no-color"], capture_output=True, text=True)
        online = res.stdout.count("online")
        tg_send(chat_id, f"🟢 *{online} processus PM2 online*\nOmega :8021 actif")
        return

    # Mission libre → exécuter dans un thread pour ne pas bloquer le polling
    if chat_id in _active_missions and _active_missions[chat_id].is_alive():
        tg_send(chat_id, "⏳ Une mission est déjà en cours, patiente...")
        return

    def run_mission():
        tg_send(chat_id, f"🎯 *Mission reçue :* {text}\n⚙️ Exécution en cours...")
        try:
            rapport = ω.execute_mission(text)
            tg_send(chat_id, rapport)
        except Exception as e:
            tg_send(chat_id, f"❌ Erreur mission: {e}")

    t = threading.Thread(target=run_mission, daemon=True)
    t.start()
    _active_missions[chat_id] = t


def telegram_polling_loop():
    """Boucle de polling Telegram longue (25s). Thread démon."""
    if not TG_TOKEN:
        print("[OmegaTG] TELEGRAM_BOT_TOKEN absent — polling désactivé")
        return

    print(f"[OmegaTG] 🤖 Bot Telegram démarré (polling 25s) — ADMIN={ADMIN_ID}")
    tg_delete_webhook()
    time.sleep(1)

    offset = 0
    while True:
        try:
            updates = tg_get_updates(offset)
            for upd in updates:
                offset = upd["update_id"] + 1
                threading.Thread(
                    target=_handle_telegram_message,
                    args=(upd,),
                    daemon=True
                ).start()
        except Exception as e:
            print(f"[OmegaTG] Erreur polling: {e}")
            time.sleep(5)


# ─── Serveur HTTP ─────────────────────────────────────────────────────────────

class OmegaHandler(BaseHTTPRequestHandler):
    """Handler HTTP minimal pour l'agent Omega."""

    def log_message(self, format, *args):
        print(f"[OmegaDaemon] {datetime.now().strftime('%H:%M:%S')} {format % args}")

    def send_json(self, data: dict, status: int = 200):
        body = json.dumps(data, ensure_ascii=False, indent=2).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_body(self) -> dict:
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw) if raw else {}

    def do_GET(self):
        if self.path == "/health":
            reg = ω.load_registry()
            self.send_json({"ok": True, "organs": len(reg), "port": PORT, "telegram": bool(TG_TOKEN)})

        elif self.path == "/organs":
            reg = ω.load_registry()
            organs = []
            for name, info in reg.items():
                organs.append({
                    "name": name,
                    "description": info["description"],
                    "functions": info.get("functions", []),
                    "uses": info.get("uses", 0),
                    "created_at": info.get("created_at", "")
                })
            self.send_json({"organs": organs, "count": len(organs)})

        else:
            self.send_json({"error": "Not found"}, 404)

    def do_POST(self):
        try:
            body = self.read_body()
        except Exception as e:
            self.send_json({"error": f"JSON invalide: {e}"}, 400)
            return

        if self.path == "/mission":
            mission = body.get("mission", "")
            if not mission:
                self.send_json({"error": "Champ 'mission' requis"}, 400)
                return
            print(f"[OmegaDaemon] 🎯 Mission reçue: {mission[:100]}")
            rapport = ω.execute_mission(mission)
            self.send_json({"success": True, "rapport": rapport})

        elif self.path == "/organ/run":
            name = body.get("name", "")
            params = body.get("params", {})
            if not name:
                self.send_json({"error": "Champ 'name' requis"}, 400)
                return
            result = ω.run_organ(name, params)
            self.send_json(result)

        elif self.path == "/organ/create":
            name = body.get("name", "")
            description = body.get("description", "")
            context = body.get("context", "")
            if not name or not description:
                self.send_json({"error": "Champs 'name' et 'description' requis"}, 400)
                return
            success, path_or_err = ω.self_code_organ(name, description, context)
            self.send_json({
                "success": success,
                "path": path_or_err if success else None,
                "error": None if success else path_or_err
            })

        else:
            self.send_json({"error": "Endpoint inconnu"}, 404)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()


# ─── Point d'entrée ──────────────────────────────────────────────────────────

def main():
    # Démarrer le polling Telegram en background
    tg_thread = threading.Thread(target=telegram_polling_loop, daemon=True)
    tg_thread.start()

    # Démarrer le serveur HTTP
    server = HTTPServer(("127.0.0.1", PORT), OmegaHandler)
    reg = ω.load_registry()
    print(f"[OmegaDaemon] 🚀 Omega :{ PORT} — {len(reg)} organes — Telegram: {'actif' if TG_TOKEN else 'absent'}")
    print(f"[OmegaDaemon] 📋 Organes: {', '.join(reg.keys())}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("[OmegaDaemon] Arrêt propre.")
        server.server_close()


if __name__ == "__main__":
    main()
