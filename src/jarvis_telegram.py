#!/usr/bin/env python3
"""
jarvis_telegram.py — Jarvis AGI · Telegram + Claude Sonnet + outils macOS
==========================================================================
Architecture :
  Telegram → Claude Sonnet (cerveau) → outils locaux (corps) → Telegram

Outils :
  bash(cmd)                 → shell sur le Mac
  read_file(path)           → lit un fichier
  write_file(path, content) → écrit un fichier
  screenshot()              → capture + envoie photo
  vision_analyze(question)  → analyse l'écran avec llava/moondream
  web_browse(url)           → lit le contenu d'une page web
  web_search(query)         → DuckDuckGo
  remember(text)            → mémorise (ChromaDB vectoriel)
  recall(query)             → recherche sémantique en mémoire
"""

import os, sys, json, subprocess, logging, asyncio, threading, time, re, base64
import urllib.request, urllib.parse, html
from pathlib import Path
from datetime import datetime, date

import anthropic
import chromadb
from telegram import Update, Bot
from telegram.ext import Application, MessageHandler, filters, ContextTypes
from telegram.constants import ParseMode, ChatAction

# ─── Config ──────────────────────────────────────────────────────────────────

ROOT = Path(__file__).parent.parent

env_file = ROOT / ".env"
if env_file.exists():
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip())

TELEGRAM_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
ADMIN_ID       = int(os.environ.get("ADMIN_TELEGRAM_ID", "0"))
ANTHROPIC_KEY  = os.environ.get("ANTHROPIC_API_KEY", "")
CLAUDE_MODEL   = "claude-sonnet-4-6"
OLLAMA_HOST    = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
VISION_MODEL   = os.environ.get("OLLAMA_MODEL_VISION", "moondream:latest")
CHROMA_DIR     = ROOT / ".laruche" / "jarvis_memory_db"
SCREENSHOTS    = ROOT / ".laruche" / "temp" / "screenshots"
SCREENSHOTS.mkdir(parents=True, exist_ok=True)

logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")
log = logging.getLogger("jarvis")

# Historique conversations par chat_id
conversations: dict[int, list] = {}

# ─── ChromaDB mémoire vectorielle ────────────────────────────────────────────

_chroma_col = None

def _get_chroma():
    global _chroma_col
    if _chroma_col is None:
        try:
            client = chromadb.PersistentClient(path=str(CHROMA_DIR))
            _chroma_col = client.get_or_create_collection(
                "jarvis",
                metadata={"hnsw:space": "cosine"}
            )
        except Exception as e:
            log.warning(f"ChromaDB init error: {e}")
    return _chroma_col


def _embed(text: str) -> list[float] | None:
    """Embeddings via nomic-embed-text (Ollama)."""
    try:
        payload = json.dumps({"model": "nomic-embed-text", "prompt": text[:1000]}).encode()
        req = urllib.request.Request(
            f"{OLLAMA_HOST}/api/embeddings", data=payload,
            headers={"Content-Type": "application/json"}
        )
        r = urllib.request.urlopen(req, timeout=10)
        return json.loads(r.read())["embedding"]
    except Exception:
        return None


def tool_remember(text: str) -> str:
    col = _get_chroma()
    if col is None:
        return "⚠️ ChromaDB indisponible"
    try:
        emb = _embed(text)
        doc_id = f"mem_{int(time.time()*1000)}"
        if emb:
            col.upsert(ids=[doc_id], embeddings=[emb],
                       documents=[text],
                       metadatas=[{"ts": datetime.now().isoformat(), "type": "memory"}])
        else:
            col.upsert(ids=[doc_id], documents=[text],
                       metadatas=[{"ts": datetime.now().isoformat(), "type": "memory"}])
        return f"✅ Mémorisé ({col.count()} souvenirs au total)"
    except Exception as e:
        return f"Erreur mémoire: {e}"


def tool_recall(query: str, limit: int = 5) -> str:
    col = _get_chroma()
    if col is None or col.count() == 0:
        return "Mémoire vide."
    try:
        emb = _embed(query)
        if emb:
            results = col.query(query_embeddings=[emb], n_results=min(limit, col.count()))
        else:
            results = col.query(query_texts=[query], n_results=min(limit, col.count()))
        docs = results.get("documents", [[]])[0]
        metas = results.get("metadatas", [[]])[0]
        if not docs:
            return "Aucun souvenir trouvé."
        lines = []
        for doc, meta in zip(docs, metas):
            ts = meta.get("ts", "")[:16]
            lines.append(f"[{ts}] {doc}")
        return "\n".join(lines)
    except Exception as e:
        return f"Erreur recall: {e}"


# ─── Outils ──────────────────────────────────────────────────────────────────

def tool_bash(cmd: str, timeout: int = 30) -> str:
    try:
        r = subprocess.run(
            cmd, shell=True, capture_output=True, text=True, timeout=timeout,
            cwd=str(ROOT),
            env={**os.environ, "PATH": "/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:" + os.environ.get("PATH", "")}
        )
        out = (r.stdout + r.stderr).strip()
        return out[:4000] if out else f"(exit {r.returncode})"
    except subprocess.TimeoutExpired:
        return f"Timeout ({timeout}s)"
    except Exception as e:
        return f"Erreur: {e}"


def tool_read_file(path: str) -> str:
    p = Path(path).expanduser()
    if not p.exists():
        return f"Fichier introuvable: {path}"
    try:
        return p.read_text(errors="replace")[:8000]
    except Exception as e:
        return f"Erreur: {e}"


def tool_write_file(path: str, content: str) -> str:
    p = Path(path).expanduser()
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content)
        return f"✅ {path} écrit ({len(content)} chars)"
    except Exception as e:
        return f"Erreur: {e}"


def tool_screenshot() -> tuple[bool, str]:
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = str(SCREENSHOTS / f"shot_{ts}.png")
    r = subprocess.run(["screencapture", "-x", path], capture_output=True, timeout=10)
    if r.returncode == 0 and Path(path).exists() and Path(path).stat().st_size > 1000:
        return True, path
    return False, "Permission Screen Recording requise"


def tool_vision_analyze(question: str) -> str:
    """Screenshot + analyse visuelle via Ollama (moondream/llava)."""
    ok, val = tool_screenshot()
    if not ok:
        return val
    try:
        with open(val, "rb") as f:
            b64 = base64.b64encode(f.read()).decode()
        payload = json.dumps({
            "model": VISION_MODEL,
            "prompt": question,
            "images": [b64],
            "stream": False,
            "options": {"num_predict": 300, "temperature": 0.1}
        }).encode()
        req = urllib.request.Request(
            f"{OLLAMA_HOST}/api/generate", data=payload,
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read()).get("response", "").strip()[:1500]
    except Exception as e:
        return f"Erreur vision: {e}"


def tool_web_browse(url: str) -> str:
    """Lit le contenu texte d'une page web (max 6000 chars)."""
    try:
        req = urllib.request.Request(
            url, headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"}
        )
        with urllib.request.urlopen(req, timeout=15) as r:
            raw = r.read().decode("utf-8", errors="replace")
        # Supprimer tags HTML → texte brut
        text = re.sub(r"<script[^>]*>.*?</script>", " ", raw, flags=re.DOTALL)
        text = re.sub(r"<style[^>]*>.*?</style>", " ", text, flags=re.DOTALL)
        text = re.sub(r"<[^>]+>", " ", text)
        text = re.sub(r"\s+", " ", text).strip()
        text = html.unescape(text)
        return text[:6000]
    except Exception as e:
        return f"Erreur navigation: {e}"


def tool_web_search(query: str) -> str:
    try:
        url = f"https://html.duckduckgo.com/html/?q={urllib.parse.quote(query)}"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as r:
            body = r.read().decode("utf-8", errors="replace")
        snippets = re.findall(r'class="result__snippet"[^>]*>([^<]+)', body)
        titles   = re.findall(r'result__a[^>]*>([^<]+)<', body)
        urls     = re.findall(r'result__url[^>]*>\s*([^\s<]+)', body)
        lines = []
        for i, (t, s) in enumerate(zip(titles[:5], snippets[:5]), 1):
            u = urls[i-1] if i <= len(urls) else ""
            lines.append(f"{i}. **{html.unescape(t.strip())}**\n   {html.unescape(s.strip())}\n   {u}")
        return "\n\n".join(lines) or f"Aucun résultat pour: {query}"
    except Exception as e:
        return f"Erreur: {e}"


# ─── Outils Claude ───────────────────────────────────────────────────────────

TOOLS = [
    {
        "name": "bash",
        "description": "Exécute n'importe quelle commande shell (bash/zsh) sur le Mac de Wiaam. Accès complet: git, npm, python3, pip, brew, tout. Utilise pour coder, tester, installer, explorer.",
        "input_schema": {
            "type": "object",
            "properties": {
                "cmd": {"type": "string"},
                "timeout": {"type": "integer", "description": "Secondes (défaut: 30)"}
            },
            "required": ["cmd"]
        }
    },
    {
        "name": "read_file",
        "description": "Lit le contenu d'un fichier texte (code, config, logs, JSON...).",
        "input_schema": {
            "type": "object",
            "properties": {"path": {"type": "string"}},
            "required": ["path"]
        }
    },
    {
        "name": "write_file",
        "description": "Crée ou écrase un fichier. Parfait pour écrire du code, des configs, des scripts.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "content": {"type": "string"}
            },
            "required": ["path", "content"]
        }
    },
    {
        "name": "screenshot",
        "description": "Capture l'écran du Mac et l'envoie en photo dans Telegram. Utilise pour voir ce qui est affiché.",
        "input_schema": {"type": "object", "properties": {}}
    },
    {
        "name": "vision_analyze",
        "description": "Capture l'écran et l'analyse avec une IA visuelle (moondream). Répond à une question sur ce qui est affiché.",
        "input_schema": {
            "type": "object",
            "properties": {"question": {"type": "string"}},
            "required": ["question"]
        }
    },
    {
        "name": "web_browse",
        "description": "Lit le contenu texte d'une page web. Utile pour lire la doc, un article, vérifier une info.",
        "input_schema": {
            "type": "object",
            "properties": {"url": {"type": "string"}},
            "required": ["url"]
        }
    },
    {
        "name": "web_search",
        "description": "Cherche sur DuckDuckGo. Retourne les 5 premiers résultats avec titre, extrait et URL.",
        "input_schema": {
            "type": "object",
            "properties": {"query": {"type": "string"}},
            "required": ["query"]
        }
    },
    {
        "name": "remember",
        "description": "Mémorise une information importante de façon permanente (stockage vectoriel ChromaDB). Utilise pour les préférences, décisions, contexte projet.",
        "input_schema": {
            "type": "object",
            "properties": {"text": {"type": "string"}},
            "required": ["text"]
        }
    },
    {
        "name": "recall",
        "description": "Recherche sémantique dans la mémoire vectorielle. Retrouve des informations mémorisées même avec des mots différents.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "limit": {"type": "integer", "description": "Nombre de résultats (défaut: 5)"}
            },
            "required": ["query"]
        }
    }
]

SYSTEM_PROMPT = f"""Tu es Jarvis, l'agent autonome de Wiaam sur son Mac (macOS Intel x86_64).
Aujourd'hui : {date.today().isoformat()}
Projets : ~/ghost-os-ultimate, ~/LaRuche, ~/Projects

Tu as accès direct à la machine via des outils réels. Tu AGIS — tu n'expliques pas, tu fais.

Règles :
1. Enchaîne les outils sans t'arrêter jusqu'à terminer la tâche.
2. Pour du code : write_file → bash (test) → corriger si erreur → bash (retest).
3. Pour une recherche : web_search → si besoin web_browse pour détails.
4. Si tu vois quelque chose d'important → remember() automatiquement.
5. Demande confirmation SEULEMENT pour : supprimer des fichiers importants, dépenses réelles.
6. Réponds en français. Sois direct et concis.
7. Pour les longues sorties bash : résume, n'affiche pas tout brut.
"""

# ─── Boucle agentique ────────────────────────────────────────────────────────

async def run_agent(chat_id: int, user_message: str, bot: Bot) -> str:
    if not ANTHROPIC_KEY:
        return "❌ ANTHROPIC_API_KEY manquante — ajoute-la dans ~/ghost-os-ultimate/.env"

    client = anthropic.Anthropic(api_key=ANTHROPIC_KEY)
    history = conversations.setdefault(chat_id, [])
    history.append({"role": "user", "content": user_message})
    if len(history) > 30:
        history[:] = history[-30:]

    screenshots_to_send: list[str] = []

    for _ in range(15):
        response = client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            tools=TOOLS,
            messages=history
        )

        text_parts = []
        tool_calls = []
        for block in response.content:
            if block.type == "text" and block.text.strip():
                text_parts.append(block.text.strip())
            elif block.type == "tool_use":
                tool_calls.append(block)

        # Texte intermédiaire pendant les outils
        if text_parts and tool_calls:
            await bot.send_message(chat_id=chat_id, text="\n".join(text_parts)[:4000])

        # Réponse finale
        if not tool_calls:
            history.append({"role": "assistant", "content": response.content})
            return "\n".join(text_parts) or "✅"

        # Exécuter les outils
        tool_results = []
        for tc in tool_calls:
            await bot.send_chat_action(chat_id=chat_id, action=ChatAction.TYPING)
            name = tc.name
            inp  = tc.input
            log.info(f"[Tool] {name}({str(inp)[:80]})")

            if   name == "bash":           result = tool_bash(inp.get("cmd",""), inp.get("timeout", 30))
            elif name == "read_file":      result = tool_read_file(inp.get("path",""))
            elif name == "write_file":     result = tool_write_file(inp.get("path",""), inp.get("content",""))
            elif name == "screenshot":
                ok, val = tool_screenshot()
                if ok: screenshots_to_send.append(val)
                result = f"Screenshot: {val}"
            elif name == "vision_analyze": result = tool_vision_analyze(inp.get("question","Décris l'écran."))
            elif name == "web_browse":     result = tool_web_browse(inp.get("url",""))
            elif name == "web_search":     result = tool_web_search(inp.get("query",""))
            elif name == "remember":       result = tool_remember(inp.get("text",""))
            elif name == "recall":         result = tool_recall(inp.get("query",""), inp.get("limit", 5))
            else:                          result = f"Outil inconnu: {name}"

            tool_results.append({
                "type": "tool_result",
                "tool_use_id": tc.id,
                "content": str(result)
            })

        # Envoyer screenshots
        for path in screenshots_to_send:
            try:
                with open(path, "rb") as f:
                    await bot.send_photo(chat_id=chat_id, photo=f)
            except Exception as e:
                log.warning(f"Photo send error: {e}")
        screenshots_to_send.clear()

        history.append({"role": "assistant", "content": response.content})
        history.append({"role": "user", "content": tool_results})

    return "⚠️ Limite 15 tours atteinte."


# ─── Scheduler proactif ──────────────────────────────────────────────────────

def _proactive_loop(bot_token: str, admin_id: int):
    """Thread proactif : tâches planifiées et alertes automatiques."""
    import http.client

    def tg_send(text: str):
        try:
            payload = json.dumps({"chat_id": admin_id, "text": text}).encode()
            req = urllib.request.Request(
                f"https://api.telegram.org/bot{bot_token}/sendMessage",
                data=payload, headers={"Content-Type": "application/json"}
            )
            urllib.request.urlopen(req, timeout=10)
        except Exception:
            pass

    last_daily = None
    last_health = None

    while True:
        now = datetime.now()

        # Rapport quotidien à 9h00
        if now.hour == 9 and now.minute < 2 and last_daily != now.date():
            last_daily = now.date()
            try:
                pm2 = subprocess.run(["pm2", "jlist"], capture_output=True, text=True, timeout=5)
                procs = json.loads(pm2.stdout) if pm2.returncode == 0 else []
                online = [p["name"] for p in procs if p.get("pm2_env", {}).get("status") == "online"]
                disk = subprocess.run(["df", "-h", "/"], capture_output=True, text=True).stdout.split("\n")[1].split()
                ram_info = subprocess.run(["vm_stat"], capture_output=True, text=True).stdout
                pages_free = int(re.search(r"Pages free:\s+(\d+)", ram_info).group(1)) * 4096 if re.search(r"Pages free:\s+(\d+)", ram_info) else 0
                tg_send(
                    f"🌅 Bonjour Wiaam — {now.strftime('%d/%m/%Y')}\n"
                    f"✅ {len(online)} processus PM2 actifs\n"
                    f"💾 Disque: {disk[3] if len(disk)>3 else '?'} libres\n"
                    f"🧠 RAM libre: ~{pages_free // 1024 // 1024} MB"
                )
            except Exception as e:
                tg_send(f"🌅 Rapport quotidien — erreur: {e}")

        # Alerte santé toutes les heures
        if now.minute < 2 and last_health != now.hour:
            last_health = now.hour
            try:
                pm2 = subprocess.run(["pm2", "jlist"], capture_output=True, text=True, timeout=5)
                procs = json.loads(pm2.stdout) if pm2.returncode == 0 else []
                crashed = [p["name"] for p in procs
                           if p.get("pm2_env", {}).get("status") in ("errored", "stopped")
                           and p.get("pm2_env", {}).get("restart_time", 0) > 5]
                if crashed:
                    tg_send(f"⚠️ Processus instables: {', '.join(crashed)}")
            except Exception:
                pass

        time.sleep(60)


# ─── Handlers Telegram ───────────────────────────────────────────────────────

async def handle_message(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    msg = update.message
    if not msg or not msg.text:
        return

    chat_id = msg.chat_id
    user_id = msg.from_user.id if msg.from_user else 0

    if ADMIN_ID and user_id != ADMIN_ID:
        await msg.reply_text("⛔ Accès refusé.")
        return

    text = msg.text.strip()
    log.info(f"[TG] {text[:80]}")

    if text == "/start":
        mem_count = _get_chroma().count() if _get_chroma() else 0
        await msg.reply_text(
            f"🤖 *Jarvis actif*\n"
            f"Modèle : {CLAUDE_MODEL}\n"
            f"Mémoire : {mem_count} souvenirs\n\n"
            f"Dis-moi ce que tu veux faire.",
            parse_mode=ParseMode.MARKDOWN
        )
        return

    if text == "/clear":
        conversations.pop(chat_id, None)
        await msg.reply_text("🧹 Conversation effacée.")
        return

    if text == "/memory":
        col = _get_chroma()
        count = col.count() if col else 0
        recent = tool_recall("jarvis projet wiaam", limit=8)
        await msg.reply_text(f"📚 *{count} souvenirs*\n\n{recent[:3000]}", parse_mode=ParseMode.MARKDOWN)
        return

    if text == "/status":
        pm2 = tool_bash("pm2 list 2>/dev/null | grep -E 'online|errored'")
        disk = tool_bash("df -h / | tail -1 | awk '{print $4\" libres sur \"$2}'")
        ollama = tool_bash("curl -s http://localhost:11434/api/tags | python3 -c \"import sys,json; d=json.load(sys.stdin); print(len(d['models']), 'modèles')\" 2>/dev/null")
        await msg.reply_text(f"📊 *Statut*\n\n{pm2}\n\n💾 {disk}\n🧠 Ollama: {ollama}", parse_mode=ParseMode.MARKDOWN)
        return

    await ctx.bot.send_chat_action(chat_id=chat_id, action=ChatAction.TYPING)

    try:
        reply = await run_agent(chat_id, text, ctx.bot)
        for i in range(0, max(len(reply), 1), 4000):
            chunk = reply[i:i+4000]
            try:
                await msg.reply_text(chunk, parse_mode=ParseMode.MARKDOWN)
            except Exception:
                await msg.reply_text(chunk)
    except Exception as e:
        log.exception("Agent error")
        await msg.reply_text(f"❌ {e}")


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    if not TELEGRAM_TOKEN:
        log.error("TELEGRAM_BOT_TOKEN manquant")
        sys.exit(1)

    # Init ChromaDB
    col = _get_chroma()
    mem_count = col.count() if col else 0
    log.info(f"ChromaDB: {mem_count} souvenirs")

    if not ANTHROPIC_KEY:
        log.warning("⚠️  ANTHROPIC_API_KEY manquante — ajoute-la dans .env")

    log.info(f"🤖 Jarvis démarré — admin: {ADMIN_ID} — modèle: {CLAUDE_MODEL}")

    # Thread proactif (rapport 9h, alertes horaires)
    t = threading.Thread(
        target=_proactive_loop,
        args=(TELEGRAM_TOKEN, ADMIN_ID),
        daemon=True
    )
    t.start()

    app = Application.builder().token(TELEGRAM_TOKEN).build()
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))
    app.add_handler(MessageHandler(filters.COMMAND, handle_message))
    app.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    main()
