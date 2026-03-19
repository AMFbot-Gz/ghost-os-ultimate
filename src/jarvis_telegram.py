#!/usr/bin/env python3
"""
jarvis_telegram.py — Jarvis AGI v3
====================================
Cerveau  : GLM-4.6 (Ollama local, tool calling natif)
Corps    : outils macOS directs
Mémoire  : ChromaDB vectoriel (nomic-embed-text 768D)
Organes  : src/omega/organs/ — contrôle Mac natif
Évolution: création d'organes à la volée (sandbox AST 4 couches)
Contexte : world state injecté dynamiquement dans chaque prompt
"""

import os, sys, json, subprocess, logging, threading, time, re, base64, ast
import importlib.util, hashlib
import urllib.request, urllib.parse, html
from pathlib import Path
from datetime import datetime, date

import openai
import chromadb
from telegram import Update, Bot
from telegram.ext import Application, MessageHandler, filters, ContextTypes
from telegram.constants import ParseMode, ChatAction

# ─── Bootstrap ───────────────────────────────────────────────────────────────

ROOT    = Path(__file__).parent.parent
ORGANS  = ROOT / "src" / "omega" / "organs"
TOOLS_DIR = ROOT / ".laruche" / "custom_tools"
TOOLS_DIR.mkdir(parents=True, exist_ok=True)

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

llm = openai.OpenAI(base_url=f"{OLLAMA_HOST}/v1", api_key="ollama")
conversations: dict[int, list] = {}

# Registre dynamique des outils custom créés à la volée
_custom_tools: dict[str, callable] = {}

# ─── ChromaDB ────────────────────────────────────────────────────────────────

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
        req = urllib.request.Request(f"{OLLAMA_HOST}/api/embeddings", data=payload,
                                     headers={"Content-Type": "application/json"})
        return json.loads(urllib.request.urlopen(req, timeout=10).read())["embedding"]
    except Exception:
        return None

def tool_remember(text: str) -> str:
    col = _chroma()
    if not col:
        return "ChromaDB indisponible"
    try:
        emb  = _embed(text)
        did  = f"m{int(time.time()*1000)}"
        kw   = dict(ids=[did], documents=[text], metadatas=[{"ts": datetime.now().isoformat()}])
        if emb: kw["embeddings"] = [emb]
        col.upsert(**kw)
        return f"✅ Mémorisé ({col.count()} souvenirs)"
    except Exception as e:
        return f"Erreur: {e}"

def tool_recall(query: str, limit: int = 5) -> str:
    col = _chroma()
    if not col or col.count() == 0:
        return "Mémoire vide."
    try:
        n   = min(limit, col.count())
        emb = _embed(query)
        res = col.query(query_embeddings=[emb] if emb else None,
                        query_texts=None if emb else [query], n_results=n)
        docs  = res.get("documents", [[]])[0]
        metas = res.get("metadatas", [[]])[0]
        return "\n".join(f"[{m.get('ts','')[:16]}] {d}" for d, m in zip(docs, metas)) or "Rien trouvé."
    except Exception as e:
        return f"Erreur: {e}"

# ─── World State — contexte dynamique ────────────────────────────────────────

def _world_state() -> str:
    """Snapshot rapide du système injecté dans le system prompt."""
    try:
        pm2 = subprocess.run(["pm2", "jlist"], capture_output=True, text=True, timeout=5)
        procs = json.loads(pm2.stdout) if pm2.returncode == 0 and pm2.stdout.startswith("[") else []
        online  = [p["name"] for p in procs if p.get("pm2_env", {}).get("status") == "online"]
        crashed = [p["name"] for p in procs if p.get("pm2_env", {}).get("status") in ("errored","stopped")]
    except Exception:
        online, crashed = [], []

    try:
        disk = subprocess.run(["df", "-h", "/"], capture_output=True, text=True, timeout=3)
        disk_free = disk.stdout.split("\n")[1].split()[3] if disk.returncode == 0 else "?"
    except Exception:
        disk_free = "?"

    try:
        ollama_r = urllib.request.urlopen(f"{OLLAMA_HOST}/api/tags", timeout=3)
        models = [m["name"] for m in json.loads(ollama_r.read()).get("models", [])]
    except Exception:
        models = []

    organs = [f.stem for f in ORGANS.glob("*.py") if not f.stem.startswith("_")]
    custom = list(_custom_tools.keys())

    lines = [
        f"Date: {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        f"PM2 online: {', '.join(online) or 'aucun'}" + (f" | CRASH: {', '.join(crashed)}" if crashed else ""),
        f"Disque libre: {disk_free}",
        f"Ollama ({len(models)} modèles): {', '.join(models[:6])}{'...' if len(models)>6 else ''}",
        f"Organes Mac: {', '.join(organs)}",
    ]
    if custom:
        lines.append(f"Outils custom créés: {', '.join(custom)}")
    return "\n".join(lines)

# ─── Outils de base ──────────────────────────────────────────────────────────

def tool_bash(cmd: str, timeout: int = 30) -> str:
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout,
                           cwd=str(ROOT),
                           env={**os.environ, "PATH": "/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:" + os.environ.get("PATH", "")})
        out = (r.stdout + r.stderr).strip()
        return out[:4000] or f"(exit {r.returncode})"
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
        payload = json.dumps({"model": VISION_MODEL, "prompt": question, "images": [b64],
                              "stream": False, "options": {"num_predict": 400, "temperature": 0.1}}).encode()
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
        lines = [f"{i}. {html.unescape(t.strip())}\n   {html.unescape(s.strip())}\n   {(u_list[i-1] if i<=len(u_list) else '')}"
                 for i, (t, s) in enumerate(zip(titles[:5], snippets[:5]), 1)]
        return "\n\n".join(lines) or "Aucun résultat."
    except Exception as e:
        return f"Erreur: {e}"

# ─── Organes Mac (src/omega/organs/) ─────────────────────────────────────────

def _load_organ(name: str):
    """Importe dynamiquement un organe Python depuis organs/."""
    path = ORGANS / f"{name}.py"
    if not path.exists():
        return None
    spec = importlib.util.spec_from_file_location(f"organ_{name}", path)
    mod  = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

def tool_run_organ(name: str, params: dict) -> str:
    """Exécute un organe macOS depuis src/omega/organs/."""
    mod = _load_organ(name)
    if mod is None:
        available = [f.stem for f in ORGANS.glob("*.py") if not f.stem.startswith("_")]
        return f"Organe '{name}' introuvable. Disponibles: {', '.join(available)}"
    try:
        result = mod.run(params)
        if isinstance(result, dict):
            return result.get("result", json.dumps(result))
        return str(result)
    except Exception as e:
        return f"Erreur organe {name}: {e}"

def tool_list_organs() -> str:
    organs = []
    for f in sorted(ORGANS.glob("*.py")):
        if f.stem.startswith("_"):
            continue
        try:
            lines = f.read_text().split("\n")
            desc  = next((l.strip().strip('"').strip("'") for l in lines[1:6] if l.strip().strip('"').strip("'")), "")
            organs.append(f"• {f.stem}: {desc[:60]}")
        except Exception:
            organs.append(f"• {f.stem}")
    custom = [f"• [custom] {k}" for k in _custom_tools]
    return "\n".join(organs + custom) or "Aucun organe."

# ─── Création d'outils à la volée (sandbox AST 4 couches) ───────────────────

_IMPORT_WHITELIST = {
    "os", "sys", "re", "json", "time", "datetime", "pathlib", "typing",
    "collections", "subprocess", "shutil", "tempfile", "io", "hashlib",
    "base64", "urllib", "http", "socket", "math", "random", "string",
    "httpx", "requests", "PIL", "numpy", "pyautogui", "pyperclip",
    "AppKit", "Quartz", "Foundation",
}
_DANGEROUS_RE = [
    r"__import__\s*\(", r"\bexec\s*\(", r"\beval\s*\(", r"compile\s*\(",
    r"globals\s*\(\s*\)", r"locals\s*\(\s*\)", r"getattr\s*\(.*__",
    r"os\.remove\b", r"shutil\.rmtree\b", r"rm\s+-rf",
    r":while\s+True:", r"fork\s*\(\s*\)",
]

def _sandbox_validate(code: str) -> tuple[bool, str]:
    """4 couches de validation avant d'exécuter du code généré."""
    # 1. Parse AST
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return False, f"SyntaxError: {e}"

    # 2. Imports whitelist
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            mod = node.names[0].name.split(".")[0] if isinstance(node, ast.Import) else (node.module or "").split(".")[0]
            if mod and mod not in _IMPORT_WHITELIST:
                return False, f"Import non autorisé: {mod}"

    # 3. Patterns dangereux (regex)
    for pat in _DANGEROUS_RE:
        if re.search(pat, code):
            return False, f"Pattern dangereux: {pat}"

    # 4. Doit contenir une fonction run(params)
    has_run = any(
        isinstance(n, ast.FunctionDef) and n.name == "run"
        for n in ast.walk(tree)
    )
    if not has_run:
        return False, "Le code doit contenir une fonction run(params: dict) -> dict"

    return True, "OK"

def tool_create_tool(name: str, description: str, code: str = "") -> str:
    """
    Crée un nouvel outil Python dynamiquement.
    Si code vide, GLM génère le code automatiquement.
    """
    name = re.sub(r"[^a-z0-9_]", "_", name.lower())

    # Générer le code si absent
    if not code.strip():
        prompt = f"""Écris une fonction Python pour cet outil : {description}

La fonction DOIT s'appeler run(params: dict) -> dict
Elle retourne {{"success": bool, "result": str, "data": dict_ou_None}}
Imports autorisés: os, subprocess, re, json, time, pathlib, base64, urllib

Écris UNIQUEMENT le code Python, sans explication."""

        try:
            r = llm.chat.completions.create(
                model=GLM_MODEL,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=1000, temperature=0.2
            )
            raw = r.choices[0].message.content or ""
            # Extraire le bloc de code
            match = re.search(r"```python\n(.*?)```", raw, re.DOTALL)
            code = match.group(1).strip() if match else raw.strip()
        except Exception as e:
            return f"Erreur génération code: {e}"

    # Validation sandbox
    ok, msg = _sandbox_validate(code)
    if not ok:
        return f"❌ Validation échouée: {msg}\n\nCode rejeté:\n{code[:300]}"

    # Sauvegarder dans organs/ ou custom_tools/
    dest = ORGANS / f"{name}.py"
    header = f'"""\n{name} — {description}\nGénéré automatiquement par Jarvis\n"""\n\n'
    dest.write_text(header + code)

    # Charger dynamiquement
    try:
        mod = _load_organ(name)
        _custom_tools[name] = mod.run
        return f"✅ Outil '{name}' créé et chargé ({len(code)} chars)\nFichier: {dest}"
    except Exception as e:
        return f"Outil sauvegardé mais erreur au chargement: {e}"

# ─── Sous-agent autonome ─────────────────────────────────────────────────────

def tool_deploy_subagent(mission: str, timeout: int = 120) -> str:
    """
    Lance un sous-agent GLM autonome pour une mission parallèle.
    S'exécute dans un subprocess Python indépendant.
    """
    agent_script = f"""
import os, json, sys, urllib.request
sys.path.insert(0, '{ROOT}')

for line in open('{ROOT}/.env').read().splitlines():
    line = line.strip()
    if line and not line.startswith('#') and '=' in line:
        k,_,v = line.partition('=')
        os.environ.setdefault(k.strip(), v.strip())

import openai, subprocess
llm = openai.OpenAI(base_url='{OLLAMA_HOST}/v1', api_key='ollama')

tools = [
    {{"type":"function","function":{{"name":"bash","description":"Shell command","parameters":{{"type":"object","properties":{{"cmd":{{"type":"string"}}}},"required":["cmd"]}}}}}}
]

history = [{{"role":"user","content":{json.dumps(mission)}}}]
for _ in range(8):
    r = llm.chat.completions.create(model='{GLM_MODEL}', messages=history, tools=tools, tool_choice='auto', max_tokens=2048)
    msg = r.choices[0].message
    if r.choices[0].finish_reason != 'tool_calls' or not msg.tool_calls:
        print(msg.content or 'Mission terminée.')
        break
    history.append(msg)
    for tc in msg.tool_calls:
        args = json.loads(tc.function.arguments)
        result = subprocess.run(args.get('cmd',''), shell=True, capture_output=True, text=True, timeout=30).stdout.strip()[:2000]
        history.append({{"role":"tool","tool_call_id":tc.id,"content":result}})
"""

    try:
        r = subprocess.run(
            ["python3", "-c", agent_script],
            capture_output=True, text=True, timeout=timeout,
            cwd=str(ROOT)
        )
        out = (r.stdout + r.stderr).strip()
        return f"[Sous-agent terminé]\n{out[:3000]}" if out else "Sous-agent terminé (pas de sortie)"
    except subprocess.TimeoutExpired:
        return f"Sous-agent timeout ({timeout}s)"
    except Exception as e:
        return f"Erreur sous-agent: {e}"

# ─── Définitions outils GLM ──────────────────────────────────────────────────

TOOLS_DEF = [
    {"type":"function","function":{"name":"bash",
        "description":"Exécute n'importe quelle commande shell sur le Mac. Git, npm, python3, brew, tout.",
        "parameters":{"type":"object","properties":{
            "cmd":{"type":"string"},
            "timeout":{"type":"integer","description":"Secondes (défaut 30)"}
        },"required":["cmd"]}}},
    {"type":"function","function":{"name":"read_file",
        "description":"Lit un fichier texte.",
        "parameters":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}}},
    {"type":"function","function":{"name":"write_file",
        "description":"Crée ou écrase un fichier.",
        "parameters":{"type":"object","properties":{"path":{"type":"string"},"content":{"type":"string"}},"required":["path","content"]}}},
    {"type":"function","function":{"name":"screenshot",
        "description":"Capture l'écran et l'envoie en photo Telegram.",
        "parameters":{"type":"object","properties":{}}}},
    {"type":"function","function":{"name":"vision_analyze",
        "description":"Capture l'écran et répond à une question visuelle via moondream.",
        "parameters":{"type":"object","properties":{"question":{"type":"string"}},"required":["question"]}}},
    {"type":"function","function":{"name":"web_browse",
        "description":"Lit le contenu d'une page web.",
        "parameters":{"type":"object","properties":{"url":{"type":"string"}},"required":["url"]}}},
    {"type":"function","function":{"name":"web_search",
        "description":"Cherche sur DuckDuckGo. Retourne titres, extraits, URLs.",
        "parameters":{"type":"object","properties":{"query":{"type":"string"}},"required":["query"]}}},
    {"type":"function","function":{"name":"remember",
        "description":"Mémorise durablement une info (ChromaDB vectoriel).",
        "parameters":{"type":"object","properties":{"text":{"type":"string"}},"required":["text"]}}},
    {"type":"function","function":{"name":"recall",
        "description":"Recherche sémantique dans la mémoire vectorielle.",
        "parameters":{"type":"object","properties":{"query":{"type":"string"},"limit":{"type":"integer"}},"required":["query"]}}},
    {"type":"function","function":{"name":"run_organ",
        "description":"Exécute un organe macOS natif (mouse_click, type_text, open_app, press_key, scroll, drag_drop, read_clipboard, take_screenshot, see_screen, run_terminal). Utilise pour contrôler le Mac directement.",
        "parameters":{"type":"object","properties":{
            "name":{"type":"string","description":"Nom de l'organe"},
            "params":{"type":"object","description":"Paramètres spécifiques à l'organe"}
        },"required":["name","params"]}}},
    {"type":"function","function":{"name":"list_organs",
        "description":"Liste tous les organes et outils disponibles.",
        "parameters":{"type":"object","properties":{}}}},
    {"type":"function","function":{"name":"create_tool",
        "description":"Crée un nouvel outil Python à la volée. GLM génère le code, le valide (sandbox AST 4 couches), le sauvegarde et le charge immédiatement. Utilise pour étendre les capacités de Jarvis.",
        "parameters":{"type":"object","properties":{
            "name":{"type":"string","description":"Nom snake_case de l'outil"},
            "description":{"type":"string","description":"Ce que fait l'outil"},
            "code":{"type":"string","description":"Code Python optionnel (si absent, GLM génère)"}
        },"required":["name","description"]}}},
    {"type":"function","function":{"name":"deploy_subagent",
        "description":"Lance un sous-agent GLM autonome en parallèle pour une mission spécifique. L'agent dispose de bash. Utile pour tâches longues ou parallèles.",
        "parameters":{"type":"object","properties":{
            "mission":{"type":"string"},
            "timeout":{"type":"integer","description":"Timeout secondes (défaut 120)"}
        },"required":["mission"]}}},
]

# ─── Boucle agentique ────────────────────────────────────────────────────────

def _exec_tool(name: str, args: dict) -> tuple[str, str | None]:
    """Retourne (result_text, screenshot_path_ou_None)."""
    log.info(f"[Tool] {name}({str(args)[:80]})")

    if   name == "bash":           return tool_bash(args.get("cmd",""), args.get("timeout",30)), None
    elif name == "read_file":      return tool_read_file(args.get("path","")), None
    elif name == "write_file":     return tool_write_file(args.get("path",""), args.get("content","")), None
    elif name == "screenshot":
        ok, val = tool_screenshot()
        return val, (val if ok else None)
    elif name == "vision_analyze": return tool_vision_analyze(args.get("question","Décris l'écran.")), None
    elif name == "web_browse":     return tool_web_browse(args.get("url","")), None
    elif name == "web_search":     return tool_web_search(args.get("query","")), None
    elif name == "remember":       return tool_remember(args.get("text","")), None
    elif name == "recall":         return tool_recall(args.get("query",""), args.get("limit",5)), None
    elif name == "run_organ":      return tool_run_organ(args.get("name",""), args.get("params",{})), None
    elif name == "list_organs":    return tool_list_organs(), None
    elif name == "create_tool":    return tool_create_tool(args.get("name",""), args.get("description",""), args.get("code","")), None
    elif name == "deploy_subagent":return tool_deploy_subagent(args.get("mission",""), args.get("timeout",120)), None

    # Outils custom créés dynamiquement
    if name in _custom_tools:
        try:
            r = _custom_tools[name](args)
            return (r.get("result", json.dumps(r)) if isinstance(r, dict) else str(r)), None
        except Exception as e:
            return f"Erreur outil custom {name}: {e}", None

    return f"Outil inconnu: {name}", None


async def run_agent(chat_id: int, user_msg: str, bot: Bot) -> str:
    # Pré-charger les souvenirs pertinents
    past = tool_recall(user_msg, limit=3)
    past_ctx = f"\nSouvenirs pertinents:\n{past}" if "Mémoire vide" not in past and "Rien trouvé" not in past else ""

async def _safe_send(bot, chat_id: int, text: str):
    """Envoie un message — fallback texte brut si Markdown invalide."""
    for chunk in [text[i:i+4000] for i in range(0, max(len(text),1), 4000)]:
        try:
            await bot.send_message(chat_id=chat_id, text=chunk)
        except Exception:
            await bot.send_message(chat_id=chat_id, text=chunk.replace("*","").replace("`","").replace("_","").replace("[","").replace("]",""))


    system = f"""Tu es Jarvis, agent autonome de Wiaam sur macOS Intel x86_64.
{_world_state()}
Projets: ~/ghost-os-ultimate, ~/LaRuche, ~/Projects
{past_ctx}

Tu AGIS directement. Enchaîne les outils sans t'arrêter.
Code → write_file → bash test → corriger si erreur → retest.
Contrôle Mac → run_organ (open_app, mouse_click, type_text, press_key, run_terminal...).
Capacité manquante → create_tool pour créer l'outil et l'utiliser immédiatement.
Tâche longue/parallèle → deploy_subagent.
Résultats importants → remember automatiquement.
Réponds en français. Court et direct."""

    history = conversations.setdefault(chat_id, [])
    history.append({"role": "user", "content": user_msg})
    if len(history) > 40:
        history[:] = history[-40:]

    shots_pending: list[str] = []

    for _ in range(20):
        response = llm.chat.completions.create(
            model=GLM_MODEL,
            messages=[{"role": "system", "content": system}] + history,
            tools=TOOLS_DEF,
            tool_choice="auto",
            max_tokens=4096,
            temperature=0.3,
        )
        msg    = response.choices[0].message
        finish = response.choices[0].finish_reason

        if msg.content and msg.tool_calls:
            await _safe_send(bot, chat_id, msg.content)

        if finish != "tool_calls" or not msg.tool_calls:
            history.append({"role": "assistant", "content": msg.content or ""})
            for path in shots_pending:
                try:
                    with open(path, "rb") as f: await bot.send_photo(chat_id=chat_id, photo=f)
                except Exception: pass
            return msg.content or "✅"

        history.append(msg)

        for tc in msg.tool_calls:
            await bot.send_chat_action(chat_id=chat_id, action=ChatAction.TYPING)
            try:
                args = json.loads(tc.function.arguments)
            except Exception:
                args = {}
            result, shot = _exec_tool(tc.function.name, args)
            if shot:
                shots_pending.append(shot)
            history.append({"role": "tool", "tool_call_id": tc.id, "content": str(result)})

        for path in shots_pending:
            try:
                with open(path, "rb") as f: await bot.send_photo(chat_id=chat_id, photo=f)
            except Exception: pass
        shots_pending.clear()

    return "⚠️ Limite 20 tours atteinte."

# ─── Scheduler proactif ──────────────────────────────────────────────────────

def _scheduler():
    def tg(text):
        try:
            payload = json.dumps({"chat_id": ADMIN_ID, "text": text}).encode()
            urllib.request.urlopen(urllib.request.Request(
                f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage",
                data=payload, headers={"Content-Type": "application/json"}
            ), timeout=10)
        except Exception: pass

    last_day = last_hour = None
    while True:
        now = datetime.now()
        if now.hour == 9 and now.minute < 2 and last_day != now.date():
            last_day = now.date()
            try:
                pm2    = json.loads(subprocess.run(["pm2","jlist"], capture_output=True, text=True, timeout=5).stdout or "[]")
                online = [p["name"] for p in pm2 if p.get("pm2_env",{}).get("status") == "online"]
                disk   = subprocess.run(["df","-h","/"], capture_output=True, text=True).stdout.split("\n")[1].split()[3]
                col    = _chroma()
                tg(f"🌅 Bonjour — {now.strftime('%d/%m/%Y')}\n✅ {len(online)} processus PM2\n💾 {disk} libres\n🧠 {col.count() if col else 0} souvenirs")
            except Exception as e:
                tg(f"🌅 Rapport erreur: {e}")

        if now.minute < 2 and last_hour != now.hour:
            last_hour = now.hour
            try:
                pm2     = json.loads(subprocess.run(["pm2","jlist"], capture_output=True, text=True, timeout=5).stdout or "[]")
                crashed = [p["name"] for p in pm2 if p.get("pm2_env",{}).get("status") in ("errored","stopped")
                           and p.get("pm2_env",{}).get("restart_time",0) > 5]
                if crashed: tg(f"⚠️ Processus instables: {', '.join(crashed)}")
            except Exception: pass
        time.sleep(60)

# ─── Handlers Telegram ───────────────────────────────────────────────────────

async def handle(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    msg = update.message
    if not msg or not msg.text: return
    chat_id = msg.chat_id
    uid     = msg.from_user.id if msg.from_user else 0
    if ADMIN_ID and uid != ADMIN_ID:
        await msg.reply_text("⛔ Accès refusé.")
        return
    text = msg.text.strip()
    log.info(f"[TG] {text[:80]}")

    if text == "/start":
        col = _chroma()
        organs = [f.stem for f in ORGANS.glob("*.py") if not f.stem.startswith("_")]
        await msg.reply_text(
            f"Jarvis v3 actif\n"
            f"Cerveau: {GLM_MODEL} (local)\n"
            f"Organes: {len(organs)} ({', '.join(organs[:4])}...)\n"
            f"Memoire: {col.count() if col else 0} souvenirs\n"
            f"Outils custom: {len(_custom_tools)}\n\n"
            f"Envoie une mission."
        )
        return

    if text == "/status":
        await msg.reply_text(_world_state())
        return

    if text == "/organs":
        await msg.reply_text(f"Organes disponibles:\n\n{tool_list_organs()}")
        return

    if text == "/memory":
        col = _chroma()
        recent = tool_recall("jarvis projet wiaam mission", 8)
        await msg.reply_text(f"{col.count() if col else 0} souvenirs:\n\n{recent[:3000]}")
        return

    if text == "/clear":
        conversations.pop(chat_id, None)
        await msg.reply_text("Efface.")
        return

    await ctx.bot.send_chat_action(chat_id=chat_id, action=ChatAction.TYPING)
    try:
        reply = await run_agent(chat_id, text, ctx.bot)
        await _safe_send(ctx.bot, chat_id, reply)
    except Exception as e:
        log.exception("Agent error")
        await msg.reply_text(f"Erreur: {e}")

# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    if not TELEGRAM_TOKEN:
        sys.exit("TELEGRAM_BOT_TOKEN manquant")

    col = _chroma()
    organs = [f.stem for f in ORGANS.glob("*.py") if not f.stem.startswith("_")]
    log.info(f"Organes: {organs}")
    log.info(f"ChromaDB: {col.count() if col else 0} souvenirs")
    log.info(f"🤖 Jarvis v3 — {GLM_MODEL} — admin: {ADMIN_ID}")

    threading.Thread(target=_scheduler, daemon=True).start()

    app = Application.builder().token(TELEGRAM_TOKEN).build()
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle))
    app.add_handler(MessageHandler(filters.COMMAND, handle))
    app.run_polling(drop_pending_updates=True)

if __name__ == "__main__":
    main()
