#!/usr/bin/env python3
"""
jarvis_telegram.py — Jarvis · GLM-4.6 (Ollama local) + outils macOS
=====================================================================
100% local, zéro cloud, zéro clé API payante.

Cerveau : GLM-4.6 via Ollama (:11434) — tool calling natif
Corps   : outils Python directs sur le Mac

Outils :
  bash(cmd)                 → shell
  read_file(path)           → lire fichier
  write_file(path, content) → écrire fichier
  screenshot()              → capture écran → photo Telegram
  vision_analyze(question)  → analyse visuelle (moondream)
  web_browse(url)           → contenu d'une page web
  web_search(query)         → DuckDuckGo
  remember(text)            → mémoire vectorielle ChromaDB
  recall(query)             → recherche sémantique
"""

import os, sys, json, subprocess, logging, threading, time, re, base64
import urllib.request, urllib.parse, html
from pathlib import Path
from datetime import datetime, date

import openai
import chromadb
from telegram import Update, Bot
from telegram.ext import Application, MessageHandler, filters, ContextTypes
from telegram.constants import ParseMode, ChatAction

# ─── Config ──────────────────────────────────────────────────────────────────

ROOT = Path(__file__).parent.parent

for line in (ROOT / ".env").read_text().splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip())

TELEGRAM_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
ADMIN_ID       = int(os.environ.get("ADMIN_TELEGRAM_ID", "0"))
OLLAMA_HOST    = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
GLM_MODEL      = os.environ.get("GLM_MODEL", "glm-4.6:cloud")
VISION_MODEL   = os.environ.get("OLLAMA_MODEL_VISION", "moondream:latest")
CHROMA_DIR     = ROOT / ".laruche" / "jarvis_memory_db"
SCREENSHOTS    = ROOT / ".laruche" / "temp" / "screenshots"
SCREENSHOTS.mkdir(parents=True, exist_ok=True)

logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")
log = logging.getLogger("jarvis")

# Client Ollama OpenAI-compatible
llm = openai.OpenAI(base_url=f"{OLLAMA_HOST}/v1", api_key="ollama")

# Historique par chat_id
conversations: dict[int, list] = {}

# ─── Mémoire vectorielle ChromaDB ────────────────────────────────────────────

_col = None

def _chroma():
    global _col
    if _col is None:
        try:
            client = chromadb.PersistentClient(path=str(CHROMA_DIR))
            _col = client.get_or_create_collection("jarvis", metadata={"hnsw:space": "cosine"})
        except Exception as e:
            log.warning(f"ChromaDB: {e}")
    return _col


def _embed(text: str) -> list | None:
    try:
        payload = json.dumps({"model": "nomic-embed-text", "prompt": text[:1000]}).encode()
        req = urllib.request.Request(
            f"{OLLAMA_HOST}/api/embeddings", data=payload,
            headers={"Content-Type": "application/json"}
        )
        return json.loads(urllib.request.urlopen(req, timeout=10).read())["embedding"]
    except Exception:
        return None


def tool_remember(text: str) -> str:
    col = _chroma()
    if not col:
        return "ChromaDB indisponible"
    try:
        emb = _embed(text)
        doc_id = f"m{int(time.time()*1000)}"
        kw = dict(ids=[doc_id], documents=[text],
                  metadatas=[{"ts": datetime.now().isoformat()}])
        if emb:
            kw["embeddings"] = [emb]
        col.upsert(**kw)
        return f"✅ Mémorisé ({col.count()} souvenirs)"
    except Exception as e:
        return f"Erreur: {e}"


def tool_recall(query: str, limit: int = 5) -> str:
    col = _chroma()
    if not col or col.count() == 0:
        return "Mémoire vide."
    try:
        n = min(limit, col.count())
        emb = _embed(query)
        res = col.query(query_embeddings=[emb] if emb else None,
                        query_texts=None if emb else [query],
                        n_results=n)
        docs  = res.get("documents", [[]])[0]
        metas = res.get("metadatas", [[]])[0]
        return "\n".join(f"[{m.get('ts','')[:16]}] {d}" for d, m in zip(docs, metas)) or "Rien trouvé."
    except Exception as e:
        return f"Erreur: {e}"


# ─── Outils macOS ────────────────────────────────────────────────────────────

def tool_bash(cmd: str, timeout: int = 30) -> str:
    try:
        r = subprocess.run(
            cmd, shell=True, capture_output=True, text=True, timeout=timeout, cwd=str(ROOT),
            env={**os.environ, "PATH": "/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:" + os.environ.get("PATH", "")}
        )
        out = (r.stdout + r.stderr).strip()
        return (out[:4000] if out else f"(exit {r.returncode})")
    except subprocess.TimeoutExpired:
        return f"Timeout {timeout}s"
    except Exception as e:
        return f"Erreur: {e}"


def tool_read_file(path: str) -> str:
    p = Path(path).expanduser()
    return p.read_text(errors="replace")[:8000] if p.exists() else f"Introuvable: {path}"


def tool_write_file(path: str, content: str) -> str:
    p = Path(path).expanduser()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content)
    return f"✅ {path} ({len(content)} chars)"


def tool_screenshot() -> tuple[bool, str]:
    path = str(SCREENSHOTS / f"shot_{datetime.now().strftime('%Y%m%d_%H%M%S')}.png")
    r = subprocess.run(["screencapture", "-x", path], capture_output=True, timeout=10)
    ok = r.returncode == 0 and Path(path).exists() and Path(path).stat().st_size > 1000
    return (True, path) if ok else (False, "Permission Screen Recording requise")


def tool_vision_analyze(question: str) -> str:
    ok, val = tool_screenshot()
    if not ok:
        return val
    try:
        b64 = base64.b64encode(Path(val).read_bytes()).decode()
        payload = json.dumps({
            "model": VISION_MODEL, "prompt": question, "images": [b64],
            "stream": False, "options": {"num_predict": 400, "temperature": 0.1}
        }).encode()
        req = urllib.request.Request(f"{OLLAMA_HOST}/api/generate", data=payload,
                                     headers={"Content-Type": "application/json"})
        return json.loads(urllib.request.urlopen(req, timeout=90).read()).get("response", "").strip()[:2000]
    except Exception as e:
        return f"Erreur vision: {e}"


def tool_web_browse(url: str) -> str:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        raw = urllib.request.urlopen(req, timeout=15).read().decode("utf-8", errors="replace")
        text = re.sub(r"<script[^>]*>.*?</script>", " ", raw, flags=re.DOTALL)
        text = re.sub(r"<style[^>]*>.*?</style>", " ", text, flags=re.DOTALL)
        text = re.sub(r"<[^>]+>", " ", text)
        return html.unescape(re.sub(r"\s+", " ", text).strip())[:6000]
    except Exception as e:
        return f"Erreur: {e}"


def tool_web_search(query: str) -> str:
    try:
        url = f"https://html.duckduckgo.com/html/?q={urllib.parse.quote(query)}"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        body = urllib.request.urlopen(req, timeout=10).read().decode("utf-8", errors="replace")
        snippets = re.findall(r'class="result__snippet"[^>]*>([^<]+)', body)
        titles   = re.findall(r'result__a[^>]*>([^<]+)<', body)
        u_list   = re.findall(r'result__url[^>]*>\s*([^\s<]+)', body)
        lines = []
        for i, (t, s) in enumerate(zip(titles[:5], snippets[:5]), 1):
            u = u_list[i-1] if i <= len(u_list) else ""
            lines.append(f"{i}. {html.unescape(t.strip())}\n   {html.unescape(s.strip())}\n   {u}")
        return "\n\n".join(lines) or "Aucun résultat."
    except Exception as e:
        return f"Erreur: {e}"


# ─── Définition outils pour GLM (format OpenAI) ──────────────────────────────

TOOLS = [
    {"type": "function", "function": {
        "name": "bash",
        "description": "Exécute n'importe quelle commande shell (bash/zsh) sur le Mac. Accès complet : git, npm, python3, pip, brew, tout.",
        "parameters": {"type": "object", "properties": {
            "cmd":     {"type": "string", "description": "Commande à exécuter"},
            "timeout": {"type": "integer", "description": "Timeout secondes (défaut 30)"}
        }, "required": ["cmd"]}
    }},
    {"type": "function", "function": {
        "name": "read_file",
        "description": "Lit le contenu d'un fichier texte (code, config, log, JSON...).",
        "parameters": {"type": "object", "properties": {
            "path": {"type": "string"}
        }, "required": ["path"]}
    }},
    {"type": "function", "function": {
        "name": "write_file",
        "description": "Crée ou écrase un fichier. Parfait pour écrire du code, scripts, configs.",
        "parameters": {"type": "object", "properties": {
            "path":    {"type": "string"},
            "content": {"type": "string"}
        }, "required": ["path", "content"]}
    }},
    {"type": "function", "function": {
        "name": "screenshot",
        "description": "Capture l'écran du Mac et l'envoie en photo dans Telegram.",
        "parameters": {"type": "object", "properties": {}}
    }},
    {"type": "function", "function": {
        "name": "vision_analyze",
        "description": "Capture l'écran et répond à une question visuelle via moondream (IA locale).",
        "parameters": {"type": "object", "properties": {
            "question": {"type": "string"}
        }, "required": ["question"]}
    }},
    {"type": "function", "function": {
        "name": "web_browse",
        "description": "Lit le contenu texte d'une URL. Pour lire de la doc, des articles.",
        "parameters": {"type": "object", "properties": {
            "url": {"type": "string"}
        }, "required": ["url"]}
    }},
    {"type": "function", "function": {
        "name": "web_search",
        "description": "Cherche sur DuckDuckGo. Retourne 5 résultats avec titre, extrait, URL.",
        "parameters": {"type": "object", "properties": {
            "query": {"type": "string"}
        }, "required": ["query"]}
    }},
    {"type": "function", "function": {
        "name": "remember",
        "description": "Mémorise une information de façon permanente (ChromaDB vectoriel). Pour préférences, décisions, contexte projet.",
        "parameters": {"type": "object", "properties": {
            "text": {"type": "string"}
        }, "required": ["text"]}
    }},
    {"type": "function", "function": {
        "name": "recall",
        "description": "Recherche sémantique dans la mémoire vectorielle. Retrouve par sens, pas mot exact.",
        "parameters": {"type": "object", "properties": {
            "query": {"type": "string"},
            "limit": {"type": "integer"}
        }, "required": ["query"]}
    }},
]

SYSTEM = f"""Tu es Jarvis, l'agent autonome de Wiaam sur son Mac (macOS Intel x86_64).
Date : {date.today().isoformat()}
Projets : ~/ghost-os-ultimate, ~/LaRuche, ~/Projects

Tu as accès direct à la machine via des outils. Tu AGIS — tu fais, tu n'expliques pas.

Règles :
1. Enchaîne les outils sans t'arrêter jusqu'à finir la tâche.
2. Code → write_file → bash (test) → corriger → retest.
3. Si tu vois quelque chose d'important → remember() automatiquement.
4. Demande confirmation uniquement pour rm -rf ou actions irréversibles importantes.
5. Réponds en français. Court et direct.
6. Pour les longues sorties bash : résume, n'affiche pas tout brut."""


# ─── Boucle agentique GLM ────────────────────────────────────────────────────

def _exec_tool(name: str, args: dict, bot_sync=None, chat_id=None) -> str:
    """Exécute un outil et retourne le résultat en string."""
    log.info(f"[Tool] {name}({str(args)[:80]})")
    if   name == "bash":           return tool_bash(args.get("cmd",""), args.get("timeout",30))
    elif name == "read_file":      return tool_read_file(args.get("path",""))
    elif name == "write_file":     return tool_write_file(args.get("path",""), args.get("content",""))
    elif name == "screenshot":
        ok, val = tool_screenshot()
        return val  # Le path ou l'erreur — l'envoi photo se fait dans le handler async
    elif name == "vision_analyze": return tool_vision_analyze(args.get("question","Décris l'écran."))
    elif name == "web_browse":     return tool_web_browse(args.get("url",""))
    elif name == "web_search":     return tool_web_search(args.get("query",""))
    elif name == "remember":       return tool_remember(args.get("text",""))
    elif name == "recall":         return tool_recall(args.get("query",""), args.get("limit",5))
    return f"Outil inconnu: {name}"


async def run_agent(chat_id: int, user_message: str, bot: Bot) -> str:
    """Boucle GLM → outils → GLM jusqu'à réponse finale."""
    history = conversations.setdefault(chat_id, [])
    history.append({"role": "user", "content": user_message})
    if len(history) > 40:
        history[:] = history[-40:]

    screenshots_to_send: list[str] = []

    for turn in range(15):
        response = llm.chat.completions.create(
            model=GLM_MODEL,
            messages=[{"role": "system", "content": SYSTEM}] + history,
            tools=TOOLS,
            tool_choice="auto",
            max_tokens=4096,
            temperature=0.3,
        )

        msg = response.choices[0].message
        finish = response.choices[0].finish_reason

        # Texte intermédiaire
        if msg.content and msg.tool_calls:
            await bot.send_message(chat_id=chat_id, text=msg.content[:4000])

        # Pas d'appel d'outil → réponse finale
        if finish != "tool_calls" or not msg.tool_calls:
            history.append({"role": "assistant", "content": msg.content or ""})
            # Envoyer screenshots en attente avant la réponse finale
            for path in screenshots_to_send:
                try:
                    with open(path, "rb") as f:
                        await bot.send_photo(chat_id=chat_id, photo=f)
                except Exception as e:
                    log.warning(f"Photo: {e}")
            return msg.content or "✅"

        # Ajouter le message assistant avec tool_calls à l'historique
        history.append(msg)

        # Exécuter chaque outil
        for tc in msg.tool_calls:
            await bot.send_chat_action(chat_id=chat_id, action=ChatAction.TYPING)
            try:
                args = json.loads(tc.function.arguments)
            except Exception:
                args = {}

            result = _exec_tool(tc.function.name, args)

            # Collecter les screenshots pour envoi async
            if tc.function.name == "screenshot" and Path(result).exists():
                screenshots_to_send.append(result)

            history.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "content": str(result)
            })

        # Envoyer les screenshots après chaque tour d'outils
        for path in screenshots_to_send:
            try:
                with open(path, "rb") as f:
                    await bot.send_photo(chat_id=chat_id, photo=f)
            except Exception as e:
                log.warning(f"Photo: {e}")
        screenshots_to_send.clear()

    return "⚠️ Limite 15 tours atteinte."


# ─── Scheduler proactif ──────────────────────────────────────────────────────

def _scheduler():
    """Rapport quotidien 9h + alertes PM2 horaires."""
    def tg(text):
        try:
            payload = json.dumps({"chat_id": ADMIN_ID, "text": text}).encode()
            req = urllib.request.Request(
                f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage",
                data=payload, headers={"Content-Type": "application/json"}
            )
            urllib.request.urlopen(req, timeout=10)
        except Exception:
            pass

    last_day = last_hour = None
    while True:
        now = datetime.now()

        # Rapport 9h
        if now.hour == 9 and now.minute < 2 and last_day != now.date():
            last_day = now.date()
            try:
                pm2_out = tool_bash("pm2 jlist 2>/dev/null")
                procs   = json.loads(pm2_out) if pm2_out.startswith("[") else []
                online  = [p["name"] for p in procs if p.get("pm2_env",{}).get("status") == "online"]
                disk    = tool_bash("df -h / | tail -1 | awk '{print $4}'").strip()
                tg(f"🌅 Bonjour — {now.strftime('%d/%m/%Y')}\n✅ {len(online)} processus actifs\n💾 {disk} libres sur disque")
            except Exception as e:
                tg(f"🌅 Rapport erreur: {e}")

        # Alerte crash toutes les heures
        if now.minute < 2 and last_hour != now.hour:
            last_hour = now.hour
            try:
                pm2_out = tool_bash("pm2 jlist 2>/dev/null")
                procs   = json.loads(pm2_out) if pm2_out.startswith("[") else []
                crashed = [p["name"] for p in procs
                           if p.get("pm2_env",{}).get("status") in ("errored","stopped")
                           and p.get("pm2_env",{}).get("restart_time",0) > 5]
                if crashed:
                    tg(f"⚠️ Processus instables: {', '.join(crashed)}")
            except Exception:
                pass

        time.sleep(60)


# ─── Handlers Telegram ───────────────────────────────────────────────────────

async def handle(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    msg = update.message
    if not msg or not msg.text:
        return

    chat_id = msg.chat_id
    uid     = msg.from_user.id if msg.from_user else 0

    if ADMIN_ID and uid != ADMIN_ID:
        await msg.reply_text("⛔ Accès refusé.")
        return

    text = msg.text.strip()
    log.info(f"[TG] {text[:80]}")

    if text == "/start":
        col = _chroma()
        await msg.reply_text(
            f"🤖 *Jarvis actif*\n"
            f"Cerveau : {GLM_MODEL} (local)\n"
            f"Mémoire : {col.count() if col else 0} souvenirs\n\n"
            f"Envoie une mission.",
            parse_mode=ParseMode.MARKDOWN
        )
        return

    if text == "/clear":
        conversations.pop(chat_id, None)
        await msg.reply_text("🧹 Conversation effacée.")
        return

    if text == "/memory":
        col = _chroma()
        recent = tool_recall("jarvis projet wiaam", 8)
        await msg.reply_text(f"📚 *{col.count() if col else 0} souvenirs*\n\n{recent[:3000]}", parse_mode=ParseMode.MARKDOWN)
        return

    if text == "/status":
        pm2  = tool_bash("pm2 list 2>/dev/null | grep -E 'online|errored'")
        disk = tool_bash("df -h / | tail -1 | awk '{print $4\" libres\"}'")
        mods = tool_bash("curl -s http://localhost:11434/api/tags | python3 -c \"import sys,json; d=json.load(sys.stdin); print(len(d['models']), 'modèles Ollama')\"")
        await msg.reply_text(f"📊 *Statut Jarvis*\n\n{pm2}\n\n💾 {disk}\n🧠 {mods}", parse_mode=ParseMode.MARKDOWN)
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
        sys.exit("TELEGRAM_BOT_TOKEN manquant")

    col = _chroma()
    log.info(f"ChromaDB : {col.count() if col else 0} souvenirs")
    log.info(f"🤖 Jarvis démarré — modèle: {GLM_MODEL} — admin: {ADMIN_ID}")

    threading.Thread(target=_scheduler, daemon=True).start()

    app = Application.builder().token(TELEGRAM_TOKEN).build()
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle))
    app.add_handler(MessageHandler(filters.COMMAND, handle))
    app.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    main()
