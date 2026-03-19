#!/usr/bin/env python3
"""
jarvis_telegram.py — Bot Telegram propulsé par Claude Sonnet
=============================================================
Architecture : Telegram → Anthropic API (Claude) → outils locaux → Telegram

Outils disponibles :
  bash(cmd)              → exécute une commande shell
  read_file(path)        → lit un fichier
  write_file(path, txt)  → écrit/modifie un fichier
  screenshot()           → capture l'écran et l'envoie en photo
  web_search(query)      → cherche sur DuckDuckGo
  remember(text)         → mémorise une information
  recall(query)          → retrouve des souvenirs
"""

import os, sys, json, subprocess, logging, asyncio, time, re
from pathlib import Path
from datetime import datetime

import anthropic
from telegram import Update, Bot
from telegram.ext import Application, MessageHandler, filters, ContextTypes
from telegram.constants import ParseMode, ChatAction

# ─── Config ──────────────────────────────────────────────────────────────────

# Charger .env si dispo
env_file = Path(__file__).parent.parent / ".env"
if env_file.exists():
    for line in env_file.read_text().splitlines():
        if line.strip() and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip())

TELEGRAM_TOKEN   = os.environ["TELEGRAM_BOT_TOKEN"]
ADMIN_ID         = int(os.environ.get("ADMIN_TELEGRAM_ID", "0"))
ANTHROPIC_KEY    = os.environ.get("ANTHROPIC_API_KEY", "")
CLAUDE_MODEL     = "claude-sonnet-4-6"
ROOT             = Path(__file__).parent.parent
MEMORY_FILE      = ROOT / ".laruche" / "jarvis_memory.jsonl"
MEMORY_FILE.parent.mkdir(parents=True, exist_ok=True)

logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")
log = logging.getLogger("jarvis")

# Historique de conversation par chat_id (garde les 20 derniers tours)
conversations: dict[int, list] = {}

# ─── Outils ──────────────────────────────────────────────────────────────────

def tool_bash(cmd: str, timeout: int = 30) -> str:
    """Exécute une commande shell et retourne stdout+stderr."""
    try:
        r = subprocess.run(
            cmd, shell=True, capture_output=True, text=True,
            timeout=timeout, cwd=str(ROOT),
            env={**os.environ, "PATH": "/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:" + os.environ.get("PATH", "")}
        )
        out = (r.stdout + r.stderr).strip()
        return out[:3000] if out else f"(exit {r.returncode})"
    except subprocess.TimeoutExpired:
        return f"Timeout ({timeout}s) dépassé"
    except Exception as e:
        return f"Erreur: {e}"


def tool_read_file(path: str) -> str:
    """Lit un fichier texte (max 8000 chars)."""
    p = Path(path).expanduser()
    if not p.exists():
        return f"Fichier introuvable: {path}"
    try:
        return p.read_text(errors="replace")[:8000]
    except Exception as e:
        return f"Erreur lecture: {e}"


def tool_write_file(path: str, content: str) -> str:
    """Crée ou écrase un fichier texte."""
    p = Path(path).expanduser()
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content)
        return f"✅ Fichier écrit: {path} ({len(content)} chars)"
    except Exception as e:
        return f"Erreur écriture: {e}"


def tool_screenshot() -> tuple[bool, str]:
    """Capture l'écran, retourne (ok, path_ou_erreur)."""
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = str(ROOT / ".laruche" / "temp" / "screenshots" / f"shot_{ts}.png")
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(["screencapture", "-x", path], capture_output=True, timeout=10)
    if r.returncode == 0 and Path(path).exists():
        return True, path
    return False, "Permission Screen Recording requise (Préférences Système → Confidentialité)"


def tool_web_search(query: str) -> str:
    """Recherche DuckDuckGo via l'API HTML."""
    try:
        import urllib.request, urllib.parse, html
        url = f"https://html.duckduckgo.com/html/?q={urllib.parse.quote(query)}"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as r:
            body = r.read().decode("utf-8", errors="replace")
        # Extraire les résultats bruts
        results = re.findall(r'class="result__snippet"[^>]*>([^<]+)', body)
        titles  = re.findall(r'class="result__title"[^>]*>.*?<a[^>]*>([^<]+)', body)
        lines = []
        for i, (t, s) in enumerate(zip(titles[:5], results[:5]), 1):
            lines.append(f"{i}. **{html.unescape(t.strip())}**\n   {html.unescape(s.strip())}")
        return "\n\n".join(lines) if lines else f"Aucun résultat pour: {query}"
    except Exception as e:
        return f"Erreur recherche: {e}"


def tool_remember(text: str) -> str:
    """Mémorise une information horodatée."""
    entry = {"ts": datetime.now().isoformat(), "content": text}
    with open(MEMORY_FILE, "a") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    return f"✅ Mémorisé: {text[:100]}"


def tool_recall(query: str, limit: int = 5) -> str:
    """Cherche dans la mémoire (recherche textuelle simple)."""
    if not MEMORY_FILE.exists():
        return "Mémoire vide."
    q = query.lower()
    results = []
    for line in MEMORY_FILE.read_text().splitlines():
        try:
            e = json.loads(line)
            if q in e.get("content", "").lower():
                results.append(f"[{e['ts'][:16]}] {e['content']}")
        except Exception:
            pass
    if not results:
        return f"Aucun souvenir trouvé pour: {query}"
    return "\n".join(results[-limit:])


# ─── Définitions outils pour Claude ──────────────────────────────────────────

TOOLS = [
    {
        "name": "bash",
        "description": "Exécute n'importe quelle commande shell sur le Mac de Wiaam (bash/zsh). Accès complet au filesystem, git, npm, python3, etc.",
        "input_schema": {
            "type": "object",
            "properties": {
                "cmd": {"type": "string", "description": "Commande shell à exécuter"},
                "timeout": {"type": "integer", "description": "Timeout en secondes (défaut: 30)"}
            },
            "required": ["cmd"]
        }
    },
    {
        "name": "read_file",
        "description": "Lit le contenu d'un fichier texte (code, config, log, etc.)",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Chemin absolu ou ~ du fichier"}
            },
            "required": ["path"]
        }
    },
    {
        "name": "write_file",
        "description": "Crée ou modifie un fichier texte. Utilise pour écrire du code, des configs, des scripts.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Chemin du fichier à créer/modifier"},
                "content": {"type": "string", "description": "Contenu complet du fichier"}
            },
            "required": ["path", "content"]
        }
    },
    {
        "name": "screenshot",
        "description": "Capture l'écran du Mac et l'envoie en photo dans Telegram. Utile pour voir l'état visuel.",
        "input_schema": {"type": "object", "properties": {}}
    },
    {
        "name": "web_search",
        "description": "Cherche sur internet via DuckDuckGo. Retourne les 5 premiers résultats.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Requête de recherche"}
            },
            "required": ["query"]
        }
    },
    {
        "name": "remember",
        "description": "Mémorise une information importante pour plus tard (persistant entre sessions).",
        "input_schema": {
            "type": "object",
            "properties": {
                "text": {"type": "string", "description": "Information à mémoriser"}
            },
            "required": ["text"]
        }
    },
    {
        "name": "recall",
        "description": "Retrouve des informations mémorisées précédemment.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Ce que tu cherches en mémoire"}
            },
            "required": ["query"]
        }
    }
]

SYSTEM_PROMPT = f"""Tu es Jarvis, l'agent autonome de Wiaam sur son Mac (macOS, x86_64).
Date : {datetime.now().strftime('%Y-%m-%d')}
Projets : ~/ghost-os-ultimate, ~/LaRuche, ~/Projects

Tu as accès à la machine via des outils réels :
- bash : exécute n'importe quelle commande shell
- read_file / write_file : lis et modifie des fichiers
- screenshot : vois l'état visuel de l'écran
- web_search : cherche sur internet
- remember / recall : mémoire persistante

Comportement :
- Tu es direct, autonome, efficace. Tu agis sans demander de confirmation sauf pour rm -rf ou actions irréversibles.
- Tu réponds en français sauf si Wiaam parle anglais.
- Si une tâche nécessite plusieurs outils, enchaîne-les sans t'arrêter.
- Pour du code : écris directement les fichiers avec write_file puis teste avec bash.
- Pour les erreurs : analyse, corrige, reteste automatiquement (max 3 tentatives).
"""

# ─── Boucle agentique ─────────────────────────────────────────────────────────

async def run_agent(chat_id: int, user_message: str, bot: Bot) -> str:
    """Boucle Claude → outils → Claude jusqu'à réponse finale."""
    if not ANTHROPIC_KEY:
        return "❌ ANTHROPIC_API_KEY manquante dans .env"

    client = anthropic.Anthropic(api_key=ANTHROPIC_KEY)

    # Historique de conversation
    history = conversations.setdefault(chat_id, [])
    history.append({"role": "user", "content": user_message})

    # Garder max 20 messages
    if len(history) > 20:
        history[:] = history[-20:]

    screenshot_pending: list[str] = []  # screenshots à envoyer

    for iteration in range(10):  # max 10 tours d'outils
        response = client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            tools=TOOLS,
            messages=history
        )

        # Collecter le texte et les appels d'outils
        text_parts = []
        tool_calls = []

        for block in response.content:
            if block.type == "text" and block.text.strip():
                text_parts.append(block.text.strip())
            elif block.type == "tool_use":
                tool_calls.append(block)

        # Si Claude a du texte à envoyer en cours de route
        if text_parts and tool_calls:
            partial = "\n".join(text_parts)
            await bot.send_message(chat_id=chat_id, text=partial[:4000])

        # Pas d'outils → réponse finale
        if not tool_calls:
            history.append({"role": "assistant", "content": response.content})
            final_text = "\n".join(text_parts) or "✅ Fait."
            return final_text

        # Exécuter les outils
        tool_results = []
        for tool_call in tool_calls:
            name = tool_call.name
            inp  = tool_call.input
            log.info(f"[Tool] {name}({json.dumps(inp)[:100]})")

            # Envoyer feedback en temps réel
            await bot.send_chat_action(chat_id=chat_id, action=ChatAction.TYPING)

            if name == "bash":
                result = tool_bash(inp.get("cmd", ""), inp.get("timeout", 30))
            elif name == "read_file":
                result = tool_read_file(inp.get("path", ""))
            elif name == "write_file":
                result = tool_write_file(inp.get("path", ""), inp.get("content", ""))
            elif name == "screenshot":
                ok, val = tool_screenshot()
                if ok:
                    screenshot_pending.append(val)
                    result = f"Screenshot capturé: {val}"
                else:
                    result = val
            elif name == "web_search":
                result = tool_web_search(inp.get("query", ""))
            elif name == "remember":
                result = tool_remember(inp.get("text", ""))
            elif name == "recall":
                result = tool_recall(inp.get("query", ""))
            else:
                result = f"Outil inconnu: {name}"

            tool_results.append({
                "type": "tool_result",
                "tool_use_id": tool_call.id,
                "content": str(result)
            })

        # Envoyer les screenshots en attente
        for path in screenshot_pending:
            try:
                with open(path, "rb") as f:
                    await bot.send_photo(chat_id=chat_id, photo=f)
            except Exception as e:
                log.warning(f"Screenshot send error: {e}")
        screenshot_pending.clear()

        # Ajouter les échanges à l'historique
        history.append({"role": "assistant", "content": response.content})
        history.append({"role": "user", "content": tool_results})

    return "⚠️ Limite d'itérations atteinte (10 tours)."


# ─── Handlers Telegram ────────────────────────────────────────────────────────

async def handle_message(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Handler principal : filtre admin, lance l'agent."""
    msg = update.message
    if not msg or not msg.text:
        return

    chat_id = msg.chat_id
    user_id = msg.from_user.id if msg.from_user else 0

    # Seul l'admin peut interagir
    if ADMIN_ID and user_id != ADMIN_ID:
        await msg.reply_text("⛔ Accès refusé.")
        return

    text = msg.text.strip()
    log.info(f"[TG] {user_id}: {text[:80]}")

    # Commandes spéciales
    if text == "/start":
        await msg.reply_text(
            "🤖 *Jarvis actif*\n\nJe suis ton agent autonome. Dis-moi ce que tu veux faire.",
            parse_mode=ParseMode.MARKDOWN
        )
        return
    if text == "/clear":
        conversations.pop(chat_id, None)
        await msg.reply_text("🧹 Conversation effacée.")
        return
    if text == "/memory":
        content = tool_recall("", limit=10) if MEMORY_FILE.exists() else "Mémoire vide."
        await msg.reply_text(f"📚 *Mémoire récente :*\n{content[:3000]}", parse_mode=ParseMode.MARKDOWN)
        return

    # Indicateur de frappe
    await ctx.bot.send_chat_action(chat_id=chat_id, action=ChatAction.TYPING)

    try:
        reply = await run_agent(chat_id, text, ctx.bot)
        # Envoyer par chunks de 4000 chars
        for i in range(0, len(reply), 4000):
            chunk = reply[i:i+4000]
            try:
                await msg.reply_text(chunk, parse_mode=ParseMode.MARKDOWN)
            except Exception:
                await msg.reply_text(chunk)  # fallback sans markdown
    except Exception as e:
        log.exception("Erreur agent")
        await msg.reply_text(f"❌ Erreur: {e}")


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    if not TELEGRAM_TOKEN:
        log.error("TELEGRAM_BOT_TOKEN manquant")
        sys.exit(1)
    if not ANTHROPIC_KEY:
        log.warning("⚠️  ANTHROPIC_API_KEY manquante — le bot démarrera mais ne pourra pas répondre")

    log.info(f"🤖 Jarvis Telegram démarré — admin: {ADMIN_ID} — modèle: {CLAUDE_MODEL}")

    app = Application.builder().token(TELEGRAM_TOKEN).build()
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))
    app.add_handler(MessageHandler(filters.COMMAND, handle_message))

    app.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    main()
