"""
Couche cerveau — port 8003
Claude API · MLX · Ollama · routing modèles · compression contexte · planification · ReAct loop
Provider : Claude API (claude-opus-4-6) · Fallback cloud : Kimi → OpenAI
"""
import asyncio
import httpx
import json
import os
import time
import uuid
import subprocess
from collections import deque
from datetime import datetime
from pathlib import Path
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional, Any, Callable
import yaml
from dotenv import load_dotenv
load_dotenv()

ROOT = Path(__file__).resolve().parent.parent

with open(ROOT / "agent_config.yml") as f:
    CONFIG = yaml.safe_load(f)

app = FastAPI(title="PICO-RUCHE Brain", version="1.0.0")

# CORS — autorise le dashboard Vite (port 3001) et toute origine locale
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3001", "http://localhost:5173", "http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

OLLAMA_URL        = CONFIG["ollama"]["base_url"]
MLX_URL           = CONFIG["mlx"]["server_url"]
MODELS            = CONFIG["ollama"]["models"]
COMPRESS_THRESHOLD= CONFIG["brain"]["compress_threshold"]
CLAUDE_MODEL      = "claude-opus-4-6"

# URLs des services internes (utilisés par la boucle ReAct)
_PORTS            = CONFIG["ports"]
EXECUTOR_URL      = f"http://localhost:{_PORTS['executor']}"
PERCEPTION_URL    = f"http://localhost:{_PORTS['perception']}"
MEMORY_URL        = f"http://localhost:{_PORTS['memory']}"

# ─── Prompt système ReAct ──────────────────────────────────────────────────
REACT_SYSTEM_PROMPT = """Tu es le cerveau de Ghost OS Ultimate v2.0 en mode ReAct (Reason + Act).

IMPORTANT : Tu dois OBLIGATOIREMENT exécuter des actions réelles avant de dire "done".
Ne dis jamais "done" sans avoir d'abord effectué au moins une action shell ou vision.
Tu ne connais pas l'état du système — tu dois l'observer en exécutant des commandes.

À chaque étape, réponds UNIQUEMENT avec ce format exact (une seule étape par réponse) :

Thought: <raisonnement court — 1 à 2 phrases>
Action: <shell|vision|memory_search|done>
Action Input: <contenu selon l'action>

ACTIONS :
- shell         → commande bash exacte (ex: ls ~/Documents)
- vision        → observe l'écran (Action Input: observe)
- memory_search → cherche dans les souvenirs passés (ex: commande erreur)
- done          → SEULEMENT après avoir vérifié le résultat via shell ou vision

EXEMPLE :
Mission: Crée un fichier test.txt dans Documents

Thought: Je dois créer le fichier avec echo ou touch.
Action: shell
Action Input: echo "contenu" > ~/Documents/test.txt

[Observation reçue]

Thought: Le fichier a été créé, je dois vérifier qu'il existe.
Action: shell
Action Input: cat ~/Documents/test.txt

[Observation reçue]

Thought: Le fichier existe et contient le bon contenu. Mission accomplie.
Action: done
Action Input: Fichier test.txt créé dans Documents avec le contenu "contenu".

CONTRAINTES :
- Une seule Action par réponse
- Ne répète JAMAIS la même Action Input deux fois de suite
- Si une commande échoue, essaie une alternative différente
- Toujours vérifier le résultat avant "done\""""

# ─── Prompts Supervisor/Workers ───────────────────────────────────────────

SUPERVISOR_DECOMPOSE_PROMPT = """Tu es le Superviseur de Ghost OS Ultimate v2.0.
Tu reçois une mission complexe et tu la décomposes en Workers indépendants.

Réponds UNIQUEMENT en JSON valide (sans markdown) :

{
  "goal": "description concise de l'objectif final",
  "reasoning": "pourquoi cette décomposition en workers parallèles",
  "workers": [
    {
      "id": "W1",
      "role": "shell|vision|research|analysis|synthesis",
      "task": "description précise et auto-suffisante de la tâche",
      "depends_on": [],
      "max_steps": 5,
      "priority": 1
    }
  ]
}

RÔLES :
- shell     → exécute des commandes bash (lecture, écriture, system)
- vision    → observe l'écran et l'état du système (screencapture)
- research  → cherche dans la mémoire sémantique (épisodes passés)
- analysis  → raisonne sur des données textuelles ou du code (LLM only)
- synthesis → fusionne TOUS les résultats des autres workers en réponse finale

RÈGLES IMPÉRATIVES :
- Maximum {max_workers} workers au total
- depends_on: [] → exécution PARALLÈLE avec les autres workers sans dépendances
- depends_on: ["W1","W2"] → attend que W1 et W2 soient terminés
- TOUJOURS finir par UN worker synthesis (depends_on: tous les autres)
- Chaque tâche doit être autonome et précise — le worker ne voit que sa tâche
- Évite les dépendances en cascade (max 3 niveaux de waves)
- max_steps: 3 pour shell/vision/research simple, 5 pour analysis complexe, 1 pour synthesis"""

SUPERVISOR_SYNTHESIS_PROMPT = """Tu es le Superviseur final de Ghost OS Ultimate.
Tu reçois les résultats de tous les Workers parallèles et tu synthetises une réponse complète.

Produis une réponse claire, structurée et directement utilisable.
Cite les résultats clés de chaque worker. Identifie les divergences ou incohérences.
Termine par une conclusion actionnable."""

WORKER_SHELL_CMD_PROMPT = """Tu es un Worker Ghost OS. Ta tâche : {task}
Réponds UNIQUEMENT avec la commande bash exacte à exécuter, rien d'autre.
Pas de markdown, pas d'explication — juste la commande."""

# ─── Prompt Critic ────────────────────────────────────────────────────────
CRITIC_SYSTEM_PROMPT = """Tu es un Critic pour Ghost OS Ultimate. Tu évalues si une action a produit le résultat attendu.

Réponds UNIQUEMENT en JSON valide, sans markdown :

{
  "verdict": "ok|retry|abort",
  "reason": "explication courte (1 phrase)",
  "confidence": 0.0-1.0,
  "rollback_needed": true|false,
  "rollback_action": "commande bash pour annuler, ou null"
}

RÈGLES verdict :
- "ok"    → l'action a réussi ou est acceptable (returncode 0, output cohérent avec l'objectif)
- "retry" → l'action a échoué mais est corrigeable (erreur mineure, path incorrect, permission manquante)
- "abort" → l'action a causé un dommage ou un état incohérent → rollback nécessaire

RÈGLES rollback_needed :
- true  SEULEMENT si l'action a modifié l'état du système (fichier créé/modifié/supprimé, app ouverte) ET a échoué partiellement
- false si l'action est en lecture seule (ls, cat, ps, curl GET, vision) ou si elle a totalement réussi

rollback_action : commande bash exacte pour annuler, ou null si pas de rollback possible/nécessaire"""

# ─── Prompts Tree of Thoughts ──────────────────────────────────────────────

TOT_EXPAND_PROMPT = """Tu es un moteur de raisonnement Tree of Thoughts pour Ghost OS Ultimate.
Mission : {mission}
Profondeur actuelle : {depth}
Chemin de pensées suivi jusqu'ici :
{path_so_far}

Génère exactement {n_branches} pensées candidates DISTINCTES et DIVERSIFIÉES pour progresser vers la solution.

Réponds UNIQUEMENT en JSON valide (sans markdown) :

{{
  "thoughts": [
    {{
      "id": "t1",
      "thought": "description concise de cette approche (2-3 phrases max)",
      "approach": "nom court de la stratégie",
      "actions_preview": ["étape 1", "étape 2"]
    }}
  ]
}}

RÈGLES DE DIVERSITÉ — chaque pensée doit être une STRATÉGIE DIFFÉRENTE :
- Pensée 1 : approche directe / la plus simple
- Pensée 2 : approche alternative / indirecte
- Pensée 3 : approche créative / hors-sentier
- Évite les variations du même plan (ne reformule pas)
- Si la solution est évidente depuis le chemin déjà suivi, inclure une pensée "done" avec la réponse complète
- Chaque pensée doit être auto-suffisante et concrète (actionnables, pas des généralités)"""

TOT_EVALUATE_PROMPT = """Tu es un évaluateur Tree of Thoughts pour Ghost OS Ultimate.
Mission originale : {mission}
Chemin de pensées suivi : {path_so_far}
Pensée à évaluer : {thought}

Évalue cette pensée sur 3 axes et retourne un score global.

Réponds UNIQUEMENT en JSON valide (sans markdown) :

{{
  "score": 0.0,
  "feasibility": 0.0,
  "relevance": 0.0,
  "safety": 1.0,
  "reason": "justification courte (1 phrase)",
  "is_solution": false,
  "solution_summary": null
}}

BARÈME score (0.0 → 1.0) :
- 0.9-1.0 : chemin optimal — mène directement et efficacement à la solution
- 0.7-0.9 : bon chemin — approche prometteuse, quelques étapes restantes
- 0.5-0.7 : chemin acceptable — pourrait fonctionner mais risques ou inefficacités
- 0.3-0.5 : chemin faible — risque de dérailler ou de prendre trop de temps
- 0.0-0.3 : chemin à abandonner — impasse, dangereux, ou hors-sujet

feasibility : peut-on réellement exécuter cette pensée ? (0=impossible, 1=trivial)
relevance   : est-ce que ça avance vers l'objectif ? (0=hors-sujet, 1=cœur du problème)
safety      : risque pour le système ? (0=destructeur, 1=100% sûr)

is_solution = true SEULEMENT si cette pensée représente une solution COMPLÈTE et VÉRIFIABLE à la mission.
solution_summary : résumé actionnable de la solution si is_solution=true, sinon null."""

TOT_SOLUTION_PROMPT = """Tu es le cerveau de Ghost OS Ultimate.
La mission "{mission}" a été analysée via Tree of Thoughts.

Chemin optimal trouvé (du plus général au plus précis) :
{optimal_path}

Score de confiance : {best_score}

Sur la base de ce chemin de réflexion, produis un plan d'exécution CONCRET :
- Étapes numérotées et actionnables
- Commandes bash spécifiques si nécessaire (avec le bon working directory)
- Risques identifiés et mesures de mitigation
- Critère de succès vérifiable (comment savoir que c'est fait ?)

Sois direct et pratique — ce plan sera exécuté par Ghost OS."""

# ─── Provider-agnostic model config (format vendor/model, inspiré PicoClaw) ──
GHOST_MODEL = os.environ.get('GHOST_MODEL', '')  # ex: 'anthropic/claude-opus-4-6'


def parse_model_spec(spec: str) -> dict:
    """Parse un spec 'vendor/model' → {'vendor': str, 'model': str, 'api_base': str|None}.

    Exemples:
      'anthropic/claude-opus-4-6'  → vendor=anthropic
      'ollama/llama3'              → vendor=ollama
      'openai/gpt-4'               → vendor=openai
      'llama3'                     → vendor=ollama (défaut local)
    """
    if '/' in spec:
        vendor, model = spec.split('/', 1)
    else:
        vendor, model = 'ollama', spec  # défaut local

    api_bases = {
        'anthropic': None,  # SDK natif
        'ollama':    os.environ.get('OLLAMA_HOST', 'http://localhost:11434'),
        'openai':    'https://api.openai.com/v1',
        'groq':      'https://api.groq.com/openai/v1',
        'deepseek':  'https://api.deepseek.com/v1',
        'kimi':      'https://api.moonshot.cn/v1',
    }

    return {
        'vendor':   vendor.lower(),
        'model':    model,
        'api_base': api_bases.get(vendor.lower()),
    }

# Circuit breaker : compte les échecs consécutifs par provider
_provider_failures: dict = {"claude": 0, "kimi": 0, "openai": 0, "ollama": 0, "mlx": 0}
_PROVIDER_MAX_FAILURES = 3   # après 3 échecs consécutifs, on skip ce provider
_circuit_reset_count: int = 0  # compteur de resets consécutifs pour backoff exponentiel


def claude_available() -> bool:
    """Vérifie si ANTHROPIC_API_KEY est présente et non vide."""
    return bool(os.environ.get("ANTHROPIC_API_KEY", "").strip())


def mlx_available() -> bool:
    if not CONFIG["mlx"]["enabled"]:
        return False
    try:
        r = httpx.get(f"{MLX_URL.replace('/v1', '')}/health", timeout=2)
        return r.status_code == 200
    except Exception:
        return False


def estimate_tokens(text: str) -> int:
    """Estime les tokens — ajustement +25% pour le français (plus verbeux que l'anglais)."""
    # Règle empirique : 1 token ≈ 4 chars anglais ≈ 3.2 chars français
    # On prend le max entre char-based et word-based pour être conservateur
    char_est = len(text) // 4
    word_est = len(text.split()) * 1  # 1 token ≈ 1 mot anglais courant
    return max(char_est, word_est)


async def call_ollama(model: str, messages: list, system: str = "", force_json: bool = False) -> str:
    """Appelle Ollama. force_json=True active format='json' pour éviter le texte conversationnel."""
    payload = {"model": model, "messages": messages, "stream": False}
    if system:
        payload["messages"] = [{"role": "system", "content": system}] + messages
    if force_json:
        payload["format"] = "json"
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(f"{OLLAMA_URL}/api/chat", json=payload)
        r.raise_for_status()
        return r.json()["message"]["content"]


async def call_mlx(messages: list, system: str = "") -> str:
    msgs = []
    if system:
        msgs.append({"role": "system", "content": system})
    msgs.extend(messages)
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(f"{MLX_URL}/chat/completions",
                              json={"model": "local", "messages": msgs, "max_tokens": 2000})
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"]


async def call_claude(messages: list, system: str = "", thinking: bool = True) -> str:
    """Appelle Claude API (claude-opus-4-6).
    thinking=True  → adaptive thinking (planification, analyse)
    thinking=False → mode direct, format strict (ReAct)
    """
    import anthropic
    key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not key:
        raise ValueError("ANTHROPIC_API_KEY absent")
    client = anthropic.AsyncAnthropic(api_key=key)
    kwargs = {
        "model": CLAUDE_MODEL,
        "max_tokens": 2048,
        "messages": messages,
    }
    if thinking:
        kwargs["thinking"] = {"type": "adaptive"}
        kwargs["max_tokens"] = 4096
    if system:
        kwargs["system"] = system
    response = await client.messages.create(**kwargs)
    text = next((b.text for b in response.content if b.type == "text"), "")
    if not text.strip():
        raise ValueError("Claude a retourné une réponse vide (aucun bloc texte)")
    return text


async def call_kimi(messages: list, system: str = "") -> str:
    key = os.environ.get("KIMI_API_KEY", "")
    if not key:
        raise ValueError("KIMI_API_KEY absent")
    msgs = []
    if system:
        msgs.append({"role": "system", "content": system})
    msgs.extend(messages)
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            "https://api.moonshot.cn/v1/chat/completions",
            headers={"Authorization": f"Bearer {key}"},
            json={"model": "moonshot-v1-8k", "messages": msgs, "max_tokens": 2000}
        )
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"]


async def call_openai(messages: list, system: str = "") -> str:
    """Fallback OpenAI — gpt-4o-mini par défaut."""
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not key:
        raise ValueError("OPENAI_API_KEY absent dans .env")
    try:
        import openai
    except ImportError:
        raise RuntimeError("openai non installé — pip install openai")
    client = openai.AsyncOpenAI(api_key=key)
    msgs = []
    if system:
        msgs.append({"role": "system", "content": system})
    msgs.extend(messages)
    response = await client.chat.completions.create(
        model=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
        messages=msgs,
        max_tokens=2000,
        timeout=60,
    )
    return response.choices[0].message.content or ""


async def llm(role: str, messages: list, system: str = "") -> dict:
    """
    Routing LLM avec circuit breaker par provider.
    Claude API prioritaire — Kimi → OpenAI en fallback.
    Un provider est mis en pause après _PROVIDER_MAX_FAILURES échecs consécutifs.
    Si GHOST_MODEL est défini (format vendor/model), il override le routing.
    """
    global _circuit_reset_count, CLAUDE_MODEL

    # ─── Override via GHOST_MODEL (ex: 'anthropic/claude-opus-4-6') ───────────
    _ghost_vendor: str | None = None
    _ghost_model: str | None = None
    if GHOST_MODEL:
        _spec = parse_model_spec(GHOST_MODEL)
        _ghost_vendor = _spec['vendor']
        _ghost_model = _spec['model']
        print(f"[Brain] GHOST_MODEL override → vendor={_ghost_vendor}, model={_ghost_model}")

        if _ghost_vendor == 'anthropic':
            # Rediriger vers Claude avec le modèle spécifié
            _orig_claude_model = CLAUDE_MODEL
            CLAUDE_MODEL = _ghost_model
            try:
                content = await call_claude(messages, system)
                _provider_failures['claude'] = 0
                return {'content': content, 'provider': 'claude', 'model': CLAUDE_MODEL}
            except Exception as e:
                _provider_failures['claude'] = _provider_failures.get('claude', 0) + 1
                print(f"[Brain] GHOST_MODEL claude override failed: {e}")
            finally:
                CLAUDE_MODEL = _orig_claude_model
        elif _ghost_vendor == 'ollama':
            try:
                content = await call_ollama(_ghost_model, messages, system)
                _provider_failures['ollama'] = 0
                return {'content': content, 'provider': 'ollama', 'model': _ghost_model}
            except Exception as e:
                _provider_failures['ollama'] = _provider_failures.get('ollama', 0) + 1
                print(f"[Brain] GHOST_MODEL ollama override failed: {e}")
        elif _ghost_vendor == 'openai':
            try:
                content = await call_openai(messages, system)
                _provider_failures['openai'] = 0
                return {'content': content, 'provider': 'openai', 'model': _ghost_model}
            except Exception as e:
                _provider_failures['openai'] = _provider_failures.get('openai', 0) + 1
                print(f"[Brain] GHOST_MODEL openai override failed: {e}")
        elif _ghost_vendor == 'kimi':
            try:
                content = await call_kimi(messages, system)
                _provider_failures['kimi'] = 0
                return {'content': content, 'provider': 'kimi', 'model': _ghost_model}
            except Exception as e:
                _provider_failures['kimi'] = _provider_failures.get('kimi', 0) + 1
                print(f"[Brain] GHOST_MODEL kimi override failed: {e}")
        # Si l'override échoue, on continue avec le routing normal ci-dessous
    # ─────────────────────────────────────────────────────────────────────────

    providers_tried = 0

    # 1. Claude API — pour tous les rôles
    if claude_available() and _provider_failures.get("claude", 0) < _PROVIDER_MAX_FAILURES:
        print(f"[Brain] 🔄 Tentative provider: claude (failures: {_provider_failures.get('claude', 0)})")
        try:
            content = await call_claude(messages, system)
            _provider_failures["claude"] = 0   # reset on success
            _circuit_reset_count = 0            # reset du backoff après succès
            return {"content": content, "provider": "claude", "model": CLAUDE_MODEL}
        except Exception as e:
            _provider_failures["claude"] = _provider_failures.get("claude", 0) + 1
            print(f"[Brain] Claude failed ({_provider_failures['claude']}/{_PROVIDER_MAX_FAILURES}): {e}")
            providers_tried += 1

    # 2. Kimi — fallback cloud
    if os.environ.get("KIMI_API_KEY") and _provider_failures.get("kimi", 0) < _PROVIDER_MAX_FAILURES:
        print(f"[Brain] 🔄 Tentative provider: kimi (failures: {_provider_failures.get('kimi', 0)})")
        try:
            content = await call_kimi(messages, system)
            _provider_failures["kimi"] = 0
            _circuit_reset_count = 0
            if providers_tried > 0:
                print(f"[Brain] ✅ Fallback kimi réussi après {providers_tried} tentative(s)")
            return {"content": content, "provider": "kimi", "model": "moonshot-v1-8k"}
        except Exception as e:
            _provider_failures["kimi"] = _provider_failures.get("kimi", 0) + 1
            print(f"[Brain] Kimi failed ({_provider_failures['kimi']}/{_PROVIDER_MAX_FAILURES}): {e}")
            providers_tried += 1

    # 3. OpenAI — fallback cloud secondaire
    if os.environ.get("OPENAI_API_KEY") and _provider_failures.get("openai", 0) < _PROVIDER_MAX_FAILURES:
        print(f"[Brain] 🔄 Tentative provider: openai (failures: {_provider_failures.get('openai', 0)})")
        try:
            content = await call_openai(messages, system)
            _provider_failures["openai"] = 0
            _circuit_reset_count = 0
            if providers_tried > 0:
                print(f"[Brain] ✅ Fallback openai réussi après {providers_tried} tentative(s)")
            return {"content": content, "provider": "openai", "model": os.environ.get("OPENAI_MODEL", "gpt-4o-mini")}
        except Exception as e:
            _provider_failures["openai"] = _provider_failures.get("openai", 0) + 1
            print(f"[Brain] OpenAI failed ({_provider_failures['openai']}/{_PROVIDER_MAX_FAILURES}): {e}")
            providers_tried += 1

    # Reset circuit breakers si tous ont échoué — avec backoff exponentiel pour éviter la boucle infinie
    if all(v >= _PROVIDER_MAX_FAILURES for v in _provider_failures.values() if v > 0):
        # Backoff : 1er reset immédiat, 2ème → 5s, 3ème+ → 30s
        if _circuit_reset_count == 1:
            print("[Brain] ⚠️  Tous les circuit breakers ouverts — backoff 5s avant reset")
            await asyncio.sleep(5)
        elif _circuit_reset_count >= 2:
            print(f"[Brain] ⚠️  Tous les circuit breakers ouverts — backoff 30s avant reset (reset #{_circuit_reset_count + 1})")
            await asyncio.sleep(30)
        else:
            print("[Brain] ⚠️  Tous les circuit breakers ouverts — reset immédiat")
        _circuit_reset_count += 1
        for k in _provider_failures:
            _provider_failures[k] = 0

    raise RuntimeError("Tous les providers cloud ont échoué — vérifier ANTHROPIC_API_KEY dans .env")


async def llm_react(messages: list, system: str = "") -> dict:
    """LLM spécialisé pour la boucle ReAct — sans adaptive thinking pour forcer
    le format Thought/Action/Action Input étape par étape (pas de hallucination)."""
    if claude_available() and _provider_failures.get("claude", 0) < _PROVIDER_MAX_FAILURES:
        try:
            content = await call_claude(messages, system, thinking=False)
            _provider_failures["claude"] = 0
            return {"content": content, "provider": "claude", "model": CLAUDE_MODEL}
        except Exception as e:
            _provider_failures["claude"] = _provider_failures.get("claude", 0) + 1
            print(f"[Brain/ReAct] Claude failed: {e}")
    # Fallback Ollama
    try:
        content = await call_ollama(MODELS.get("strategist", "llama3:latest"), messages, system)
        return {"content": content, "provider": "ollama", "model": MODELS.get("strategist")}
    except Exception as e:
        raise RuntimeError(f"llm_react: tous les providers ont échoué — {e}")


async def compress_context(messages: list) -> str:
    history = "\n".join([f"{m['role']}: {m['content']}" for m in messages])
    prompt = [{"role": "user", "content": f"Résume en moins de 400 tokens. Garde: décisions, erreurs, état actuel, prochaine étape. Supprime: répétitions, politesses.\n\n{history}"}]

    try:
        result_dict = await llm("worker", prompt)
        return result_dict["content"]
    except Exception as e:
        print(f"[Brain] compress_context failed: {e}")
        return history[-2000:]


def load_domain_context(mission_type: str) -> str:
    ctx_file = ROOT / f"support/domain-contexts/{mission_type}.md"
    mem_file = ROOT / "agent/memory/persistent.md"
    ctx = ""
    if ctx_file.exists():
        ctx += ctx_file.read_text()
    if mem_file.exists():
        ctx += "\n\n" + mem_file.read_text()[-2000:]
    return ctx


def load_skills_list() -> str:
    """Charge les skills disponibles depuis registry.json pour guider la planification (C1)."""
    try:
        registry_path = ROOT / "skills/registry.json"
        if not registry_path.exists():
            return ""
        registry = json.loads(registry_path.read_text(encoding="utf-8"))
        skills = registry.get("skills", [])
        if not skills:
            return ""
        lines = ["Skills disponibles (tu peux les référencer dans tes sous-tâches):"]
        for s in skills[:20]:
            lines.append(f"  - {s['name']}: {s.get('description', '')[:80]}")
        return "\n".join(lines)
    except Exception:
        return ""


async def _async_load_domain_context(mission_type: str) -> str:
    try:
        return await asyncio.get_event_loop().run_in_executor(None, load_domain_context, mission_type)
    except Exception as e:
        print(f"[Brain] load_domain_context error: {e}")
        return ""


async def _async_load_skills_list() -> str:
    try:
        return await asyncio.get_event_loop().run_in_executor(None, load_skills_list)
    except Exception as e:
        print(f"[Brain] load_skills_list error: {e}")
        return ""


async def load_recent_learnings(mission_hint: str = "") -> str:
    """Charge les épisodes mémoire pertinents pour la mission en cours.
    Si mission_hint fourni → recherche sémantique ChromaDB (épisodes similaires).
    Sinon → 3 derniers épisodes (fallback temporel).
    """
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            if mission_hint:
                # Recherche sémantique — épisodes proches de la mission actuelle
                r = await c.post(
                    f"http://localhost:{CONFIG['ports']['memory']}/semantic_search",
                    json={"query": mission_hint, "n_results": 4, "min_similarity": 0.45},
                )
                r.raise_for_status()
                data     = r.json()
                results  = data.get("results", [])
                method   = "sémantique" if data.get("chroma_ready") else "récents"
                episodes = []
                for hit in results:
                    ep = hit.get("episode") or {
                        "mission": hit.get("document", "")[:80],
                        "result":  "",
                        "success": hit.get("success", False),
                    }
                    ep["_similarity"] = hit.get("similarity", 0)
                    episodes.append(ep)
            else:
                r = await c.get(f"http://localhost:{CONFIG['ports']['memory']}/episodes?limit=3")
                r.raise_for_status()
                episodes = r.json().get("episodes", [])
                method   = "récents"

        if not episodes:
            return ""
        lines = [f"Apprentissages {method} (prends-les en compte):"]
        for ep in episodes:
            flag = "✓" if ep.get("success") else "✗"
            sim  = f" [{ep['_similarity']:.2f}]" if ep.get("_similarity") else ""
            lines.append(f"  {flag}{sim} {ep.get('mission','')[:60]} → {ep.get('result','')[:70]}")
        return "\n".join(lines)
    except Exception as e:
        print(f"[Brain] load_recent_learnings error: {e}")
        return ""


# ─── ReAct helpers ────────────────────────────────────────────────────────

def _parse_react_step(text: str) -> dict:
    """Parse une réponse ReAct → {thought, action, action_input}.
    Tolère les variantes de casse et les espaces superflus.
    """
    thought = action = action_input = ""
    lines = text.strip().splitlines()
    capturing_input = False
    for line in lines:
        if line.lower().startswith("thought:"):
            thought = line.split(":", 1)[1].strip()
            capturing_input = False
        elif line.lower().startswith("action input:"):
            action_input = line.split(":", 1)[1].strip()
            capturing_input = True
        elif line.lower().startswith("action:") and "input" not in line.lower():
            action = line.split(":", 1)[1].strip().lower()
            capturing_input = False
        elif capturing_input and line.strip():
            # Ligne de suite pour Action Input multi-ligne
            action_input += " " + line.strip()

    # Fallback : si rien parsé, on traite le bloc entier comme pensée
    if not action:
        action = "done"
    if not action_input and action == "done":
        action_input = text.strip()[:300]

    return {"thought": thought, "action": action, "action_input": action_input}


async def _execute_react_action(action: str, action_input: str, step_timeout: int) -> dict:
    """Dispatch une action ReAct vers le bon service et retourne l'observation."""
    try:
        async with httpx.AsyncClient(timeout=step_timeout) as client:

            if action == "shell":
                r = await client.post(
                    f"{EXECUTOR_URL}/shell",
                    json={"command": action_input},   # champ "command" (pas "cmd")
                )
                r.raise_for_status()
                data = r.json()
                if data.get("blocked"):
                    return {"ok": False, "output": f"[BLOQUÉ] {data.get('block_reason', 'commande interdite')}"}
                out = (data.get("stdout", "") + data.get("stderr", "")).strip()
                return {"ok": data.get("returncode", 1) == 0, "output": out[:2000] or "(aucune sortie)"}

            elif action == "vision":
                r = await client.post(f"{PERCEPTION_URL}/observe")
                r.raise_for_status()
                obs = r.json()
                screen = obs.get("screen", {})
                sys_info = obs.get("system", {})
                summary = (
                    f"Écran: {'changé' if screen.get('changed') else 'identique'} | "
                    f"CPU: {sys_info.get('cpu_percent', '?')}% | "
                    f"RAM: {sys_info.get('ram_percent', '?')}% | "
                    f"Screenshot: {screen.get('path', 'N/A')}"
                )
                return {"ok": True, "output": summary}

            elif action == "memory_search":
                # Recherche sémantique ChromaDB → fallback mots-clés si indisponible
                r = await client.post(
                    f"{MEMORY_URL}/semantic_search",
                    json={"query": action_input, "n_results": 4, "min_similarity": 0.4},
                )
                r.raise_for_status()
                data = r.json()
                results = data.get("results", [])
                method  = "sémantique" if data.get("chroma_ready") else "mots-clés"
                if not results:
                    return {"ok": True, "output": "Aucun souvenir pertinent trouvé."}
                lines = [f"[Mémoire {method}]"]
                for hit in results[:3]:
                    flag = "✓" if hit.get("success") else "✗"
                    sim  = f" ({hit.get('similarity', 0):.2f})" if hit.get("similarity") else ""
                    doc  = hit.get("document", "")[:80]
                    lines.append(f"  {flag}{sim} {doc}")
                return {"ok": True, "output": "\n".join(lines)}

            elif action == "done":
                return {"ok": True, "output": action_input}

            else:
                return {"ok": False, "output": f"Action inconnue: '{action}' — utilise shell|vision|memory_search|done"}

    except httpx.TimeoutException:
        return {"ok": False, "output": f"[TIMEOUT {step_timeout}s] Le service ne répond pas."}
    except Exception as e:
        return {"ok": False, "output": f"[ERREUR] {type(e).__name__}: {str(e)[:200]}"}


# ─── Critic + Rollback ────────────────────────────────────────────────────

# Actions en lecture seule — le critic ne génère jamais de rollback pour celles-ci
_READ_ONLY_PATTERNS = (
    "ls ", "ls\n", "cat ", "head ", "tail ", "wc ", "find ", "grep ",
    "ps ", "top ", "df ", "du ", "which ", "echo ", "pwd",
    "curl -s", "curl --silent", "git status", "git log", "git diff",
    "open -a", "osascript -e 'tell application",   # ouvertures app (réversibles facilement)
)

# Patterns shell → rollback inverse automatique (avant de demander au LLM)
_ROLLBACK_PATTERNS = [
    # Écriture fichier : echo "..." > file  →  rm file
    (r'^echo .+ > (.+)$',           lambda m: f"rm -f {m.group(1)}"),
    # Append fichier : echo "..." >> file  →  (pas de rollback exact, on notifie)
    (r'^echo .+ >> (.+)$',          lambda m: None),
    # Création fichier : touch file  →  rm file
    (r'^touch (.+)$',               lambda m: f"rm -f {m.group(1)}"),
    # Mkdir : mkdir ...  →  rmdir
    (r'^mkdir(?:\s+-p)?\s+(.+)$',   lambda m: f"rmdir '{m.group(1).strip()}' 2>/dev/null || rm -rf '{m.group(1).strip()}'"),
    # Move : mv src dst  →  mv dst src
    (r'^mv\s+(\S+)\s+(\S+)$',       lambda m: f"mv {m.group(2)} {m.group(1)}"),
    # Copy : cp src dst  →  rm dst
    (r'^cp(?:\s+-r)?\s+\S+\s+(\S+)$', lambda m: f"rm -f {m.group(1)}"),
    # pip install  →  pip uninstall
    (r'^pip3?\s+install\s+(\S+)',   lambda m: f"pip3 uninstall -y {m.group(1)}"),
    # npm install  →  npm uninstall
    (r'^npm\s+install\s+(\S+)',     lambda m: f"npm uninstall {m.group(1)}"),
]


def _auto_rollback_cmd(action_input: str) -> Optional[str]:
    """Génère un rollback bash par pattern matching rapide (sans LLM)."""
    import re
    cmd = action_input.strip()
    for pattern, generator in _ROLLBACK_PATTERNS:
        m = re.match(pattern, cmd, re.IGNORECASE)
        if m:
            result = generator(m)
            return result  # peut être None si pas de rollback exact
    return None


def _is_read_only(action_input: str) -> bool:
    """True si la commande est en lecture seule (rollback inutile)."""
    cmd = action_input.strip().lower()
    return any(cmd.startswith(p.lower()) for p in _READ_ONLY_PATTERNS)


async def critic_evaluate(
    goal: str,
    action: str,
    action_input: str,
    observation: str,
    step_num: int,
    exec_success: bool,
) -> dict:
    """Évalue le résultat d'une action et retourne un verdict structuré.

    Retourne :
        verdict        : "ok" | "retry" | "abort"
        reason         : explication courte
        confidence     : float 0-1
        rollback_needed: bool
        rollback_action: str | None
    """
    # Lecture seule ou action non-shell → ok rapide sans LLM
    if action in ("vision", "memory_search", "done"):
        return {"verdict": "ok", "reason": "action passive", "confidence": 1.0,
                "rollback_needed": False, "rollback_action": None}

    if action == "shell" and _is_read_only(action_input) and exec_success:
        return {"verdict": "ok", "reason": "commande lecture seule réussie", "confidence": 0.95,
                "rollback_needed": False, "rollback_action": None}

    # Échec executor immédiat sans sortie utile → retry direct
    if not exec_success and ("[BLOQUÉ]" in observation or "[TIMEOUT" in observation):
        return {"verdict": "retry", "reason": observation[:120], "confidence": 0.9,
                "rollback_needed": False, "rollback_action": None}

    # Tentative de rollback auto avant d'appeler le LLM
    auto_rb = _auto_rollback_cmd(action_input) if not exec_success else None

    prompt = f"""Objectif global : {goal}
Étape {step_num} — action executée :
  Type    : {action}
  Commande: {action_input}
  Succès  : {exec_success}
  Résultat: {observation[:600]}

Évalue si le résultat correspond à l'objectif et retourne le JSON demandé."""

    try:
        result = await llm_react(
            [{"role": "user", "content": prompt}],
            CRITIC_SYSTEM_PROMPT,
        )
        raw = result["content"].strip()
        # Extraire le JSON
        start = raw.find("{")
        end   = raw.rfind("}") + 1
        verdict_dict = json.loads(raw[start:end]) if start != -1 else {}
    except Exception as e:
        print(f"[Critic] LLM error: {e} — fallback heuristique")
        # Fallback heuristique si le LLM échoue
        verdict_dict = {}

    # Valeurs par défaut + validation
    verdict   = verdict_dict.get("verdict", "ok" if exec_success else "retry")
    reason    = verdict_dict.get("reason", "évaluation heuristique")
    confidence = float(verdict_dict.get("confidence", 0.7 if exec_success else 0.5))
    rb_needed = bool(verdict_dict.get("rollback_needed", False))
    rb_action = verdict_dict.get("rollback_action") or auto_rb

    # Sécurité : jamais rollback si la commande originale était en lecture seule
    if _is_read_only(action_input):
        rb_needed = False
        rb_action = None

    return {
        "verdict":        verdict,
        "reason":         reason,
        "confidence":     confidence,
        "rollback_needed": rb_needed,
        "rollback_action": rb_action,
    }


async def _execute_rollback(rollback_action: str, timeout: int = 15) -> dict:
    """Exécute une action de rollback via executor :8004."""
    print(f"[Critic/Rollback] 🔄 Rollback: {rollback_action[:80]}")
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.post(
                f"{EXECUTOR_URL}/shell",
                json={"command": rollback_action},
            )
            r.raise_for_status()
            data = r.json()
            ok = data.get("returncode", 1) == 0 and not data.get("blocked")
            out = (data.get("stdout", "") + data.get("stderr", "")).strip()
            print(f"[Critic/Rollback] {'✅' if ok else '❌'} {out[:80]}")
            return {"ok": ok, "output": out[:500]}
    except Exception as e:
        print(f"[Critic/Rollback] Erreur: {e}")
        return {"ok": False, "output": str(e)[:200]}


async def _emit(on_event: Optional[Callable], event: dict) -> None:
    """Émet un événement SSE si le callback est défini. Ignore les erreurs silencieusement."""
    if on_event:
        try:
            await on_event(event)
        except Exception:
            pass


async def _save_to_memory(result: dict, loop_type: str) -> None:
    """Sauvegarde un résultat de boucle ReAct/ToT dans la mémoire vectorielle (memory.py :8006).
    Silencieux — n'interrompt jamais la boucle principale.
    """
    try:
        mission = (result.get("goal") or result.get("mission", ""))[:300]
        if not mission:
            return

        if loop_type == "react":
            result_text = (result.get("final_answer") or "")[:600]
            success = result.get("status") == "success"
            steps = result.get("steps_taken", 0)
            learned = (
                f"[ReAct] {steps} étape(s), provider={result.get('provider', '?')}, "
                f"rollbacks={len(result.get('rollbacks', []))}"
            )
        else:  # tot
            summary = result.get("solution_summary") or ""
            plan    = result.get("execution_plan") or ""
            result_text = (summary or plan)[:600]
            success = result.get("status") in ("solution_found", "best_path")
            nodes   = result.get("tree_stats", {}).get("total_nodes_explored", 0)
            learned = (
                f"[ToT] score={result.get('best_score', 0):.2f}, "
                f"profondeur={result.get('path_depth', 0)}, noeuds={nodes}, "
                f"provider={result.get('provider', '?')}"
            )

        if not result_text:
            return

        payload = {
            "mission":    mission,
            "result":     result_text,
            "success":    success,
            "duration_ms": result.get("duration_ms", 0),
            "model_used": result.get("model", ""),
            "skills_used": [],
            "learned":    learned,
        }
        async with httpx.AsyncClient(timeout=8) as c:
            r = await c.post(f"{MEMORY_URL}/episode", json=payload)
            if r.status_code == 200:
                print(f"[Brain/Memory] ✅ Épisode {loop_type} sauvegardé: {mission[:60]}")
            else:
                print(f"[Brain/Memory] ⚠️  Sauvegarde échouée: HTTP {r.status_code}")
    except Exception as e:
        print(f"[Brain/Memory] Sauvegarde silencieuse échouée: {e}")


# ─── Observabilité temps réel ─────────────────────────────────────────────────
# Ring buffer : 60 snapshots × 10s = 10 minutes d'historique
_METRICS_HISTORY: deque = deque(maxlen=60)
_METRICS_LOCK_OBS = asyncio.Lock()
_NODE_QUEEN_URL = "http://localhost:3000"

# Ports de toutes les couches Python
_ALL_LAYER_PORTS = {
    "queen":      _PORTS["queen"],
    "perception": _PORTS["perception"],
    "brain":      _PORTS["brain"],
    "executor":   _PORTS["executor"],
    "evolution":  _PORTS["evolution"],
    "memory":     _PORTS["memory"],
    "mcp_bridge": _PORTS["mcp_bridge"],
}


def _compute_alerts(layers: dict, system: dict) -> list:
    """Génère la liste des alertes actives à partir d'un snapshot."""
    alerts = []
    cpu  = system.get("cpu_percent",  0)
    ram  = system.get("ram_percent",  0)
    disk = system.get("disk_percent", 0)

    if cpu > 90:
        alerts.append({"level": "critical", "message": f"CPU critique : {cpu}%",    "source": "system"})
    elif cpu > 80:
        alerts.append({"level": "warn",     "message": f"CPU élevé : {cpu}%",       "source": "system"})
    if ram > 90:
        alerts.append({"level": "critical", "message": f"RAM critique : {ram}%",    "source": "system"})
    elif ram > 80:
        alerts.append({"level": "warn",     "message": f"RAM élevée : {ram}%",      "source": "system"})
    if disk > 90:
        alerts.append({"level": "critical", "message": f"Disque plein : {disk}%",   "source": "system"})
    elif disk > 80:
        alerts.append({"level": "warn",     "message": f"Disque chargé : {disk}%",  "source": "system"})

    # Couches hors ligne
    for name, data in layers.items():
        if not data.get("ok"):
            err = data.get("error", f"HTTP {data.get('status_code', '?')}")
            alerts.append({"level": "critical", "message": f"Couche {name} hors ligne ({err})", "source": name})
        elif data.get("latency_ms", 0) > 2000:
            alerts.append({"level": "warn", "message": f"Latence élevée {name} : {data['latency_ms']}ms", "source": name})

    # ChromaDB dégradé
    mem = layers.get("memory", {})
    if mem.get("ok") and not mem.get("chroma_ready"):
        alerts.append({"level": "info", "message": "ChromaDB inactif — recherche sémantique dégradée", "source": "memory"})

    # Circuit breakers ouverts (brain)
    brain_layer = layers.get("brain", {})
    for provider, cb in brain_layer.get("circuit_breakers", {}).items():
        if cb.get("open"):
            alerts.append({"level": "warn", "message": f"Circuit breaker ouvert : {provider}", "source": "brain"})

    return alerts


async def _collect_snapshot() -> dict:
    """Collecte un snapshot complet en parallèle : 7 couches Python + Node system/status."""
    t_snap = time.time()

    # ── Poll couches Python en parallèle ──────────────────────────────────
    async def _poll(name: str, port: int) -> tuple:
        t0 = time.time()
        try:
            async with httpx.AsyncClient(timeout=3) as c:
                r = await c.get(f"http://localhost:{port}/health")
                lat = int((time.time() - t0) * 1000)
                if r.status_code == 200:
                    return name, {"ok": True, "latency_ms": lat, **r.json()}
                return name, {"ok": False, "latency_ms": lat, "status_code": r.status_code}
        except Exception as e:
            return name, {"ok": False, "latency_ms": int((time.time() - t0) * 1000), "error": str(e)[:80]}

    raw_layers = await asyncio.gather(
        *[_poll(n, p) for n, p in _ALL_LAYER_PORTS.items()],
        return_exceptions=True,
    )
    layers = {}
    for item in raw_layers:
        if isinstance(item, tuple):
            layers[item[0]] = item[1]

    # ── Node.js queen : system + status ───────────────────────────────────
    system   = {}
    missions = {}
    ollama   = {}
    chimera  = os.environ.get("CHIMERA_SECRET", "")
    hdrs = {"Authorization": f"Bearer {chimera}"} if chimera else {}
    try:
        async with httpx.AsyncClient(timeout=3) as c:
            sys_r, sta_r = await asyncio.gather(
                c.get(f"{_NODE_QUEEN_URL}/api/system",  headers=hdrs),
                c.get(f"{_NODE_QUEEN_URL}/api/status",  headers=hdrs),
                return_exceptions=True,
            )
        if not isinstance(sys_r, Exception) and sys_r.status_code == 200:
            d = sys_r.json()
            mem = d.get("memory", {})
            disk_list = d.get("disk", [{}])
            system = {
                "cpu_percent":  round(d.get("cpu",    {}).get("load",    0), 1),
                "ram_percent":  round(mem.get("percent", 0), 1),
                "ram_gb_used":  round(mem.get("used",  0) / 1e9, 1),
                "ram_gb_total": round(mem.get("total", 0) / 1e9, 1),
                "disk_percent": round(disk_list[0].get("percent", 0), 1) if disk_list else 0,
                "disk_gb_used": round(disk_list[0].get("used",    0) / 1e9, 1) if disk_list else 0,
                "disk_gb_total":round(disk_list[0].get("size",    0) / 1e9, 1) if disk_list else 0,
            }
        if not isinstance(sta_r, Exception) and sta_r.status_code == 200:
            d = sta_r.json()
            missions = {
                "total":   d.get("missions", {}).get("total",  0),
                "active":  d.get("missions", {}).get("active", 0),
                "success": d.get("missions", {}).get("success",0),
                "error":   d.get("missions", {}).get("error",  0),
            }
            ollama = {
                "ok":        d.get("ollama", {}).get("ok",        False),
                "latency_ms":d.get("ollama", {}).get("latencyMs", None),
                "model":     d.get("ollama", {}).get("model",     ""),
            }
    except Exception:
        pass

    alerts = _compute_alerts(layers, system)

    snapshot = {
        "timestamp":     t_snap,
        "layers":        layers,
        "system":        system,
        "missions":      missions,
        "ollama":        ollama,
        "alerts":        alerts,
        "alerts_count":  len(alerts),
        "layers_ok":     sum(1 for v in layers.values() if v.get("ok", False)),
        "layers_total":  len(_ALL_LAYER_PORTS),
        "collect_ms":    int((time.time() - t_snap) * 1000),
    }

    async with _METRICS_LOCK_OBS:
        _METRICS_HISTORY.append(snapshot)

    return snapshot


async def _metrics_poller_loop() -> None:
    """Tâche background — collecte un snapshot toutes les 10 secondes."""
    print("[Brain/Obs] 🔭 Démarrage poller métriques (10s)")
    await asyncio.sleep(5)  # attendre que les autres couches démarrent
    while True:
        try:
            await _collect_snapshot()
        except Exception as e:
            print(f"[Brain/Obs] Erreur collecte: {e}")
        await asyncio.sleep(10)


@app.on_event("startup")
async def _start_obs_poller():
    asyncio.create_task(_metrics_poller_loop())


async def react_loop(
    mission: str,
    max_steps: int = 15,
    mission_type: str = "general",
    timeout_per_step: int = 60,
    on_event: Optional[Callable] = None,
) -> dict:
    """
    Boucle ReAct complète : Reason → Act → Observe → repeat.
    Retourne le trace complet + réponse finale.
    """
    started = time.time()
    mission_id = uuid.uuid4().hex[:8]
    steps_trace = []
    last_action_input = None  # anti-boucle infinie
    repeat_count = 0
    rollback_stack: List[dict] = []  # historique des rollbacks exécutés

    # Contexte enrichi (skills + mémoire sémantique similaire) — même logique que /think
    skills_ctx, learnings_ctx = await asyncio.gather(
        _async_load_skills_list(),
        load_recent_learnings(mission_hint=mission),
        return_exceptions=True,
    )
    skills_ctx    = skills_ctx    if isinstance(skills_ctx, str)    else ""
    learnings_ctx = learnings_ctx if isinstance(learnings_ctx, str) else ""

    extra = ""
    if skills_ctx:
        extra += f"\n\n{skills_ctx}"
    if learnings_ctx:
        extra += f"\n\n{learnings_ctx}"

    system = REACT_SYSTEM_PROMPT + extra

    # Historique de conversation — s'allonge à chaque tour
    messages: List[dict] = [{"role": "user", "content": f"Mission: {mission}"}]

    print(f"[Brain/ReAct] 🚀 Démarrage mission={mission_id} max_steps={max_steps}")
    await _emit(on_event, {"type": "start", "mission_id": mission_id, "mission": mission, "max_steps": max_steps})

    for step_num in range(1, max_steps + 1):
        step_start = time.time()
        print(f"[Brain/ReAct] ── Étape {step_num}/{max_steps}")
        await _emit(on_event, {"type": "step_start", "step": step_num, "max_steps": max_steps})

        # Compression si le contexte grossit trop
        total_text = " ".join(m.get("content", "") for m in messages)
        if estimate_tokens(total_text) > COMPRESS_THRESHOLD:
            print(f"[Brain/ReAct] Compression contexte ({estimate_tokens(total_text)} tokens)")
            compressed = await compress_context(messages)
            messages = [
                {"role": "user",      "content": f"Mission: {mission}"},
                {"role": "assistant", "content": f"[Contexte résumé]: {compressed}"},
            ]

        # ── Reason ────────────────────────────────────────────────────────
        try:
            result = await llm_react(messages, system)
        except Exception as e:
            error_msg = f"[Brain/ReAct] LLM error à l'étape {step_num}: {e}"
            print(error_msg)
            steps_trace.append({
                "step": step_num, "thought": "", "action": "error",
                "action_input": "", "observation": error_msg,
                "success": False, "duration_ms": int((time.time() - step_start) * 1000),
            })
            break

        raw = result["content"].strip()
        parsed = _parse_react_step(raw)
        thought      = parsed["thought"]
        action       = parsed["action"]
        action_input = parsed["action_input"]

        print(f"[Brain/ReAct]   Thought: {thought[:80]}")
        print(f"[Brain/ReAct]   Action:  {action} | Input: {action_input[:80]}")
        await _emit(on_event, {"type": "thought", "step": step_num, "thought": thought,
                               "action": action, "action_input": action_input})

        # Anti-boucle : même action_input 3 fois → forcer done
        if action_input == last_action_input:
            repeat_count += 1
            if repeat_count >= 3:
                print(f"[Brain/ReAct] ⚠️  Boucle détectée ({repeat_count}x '{action_input[:40]}') → arrêt forcé")
                action = "done"
                action_input = f"Arrêt anti-boucle après {step_num} étapes. Dernière action: {action_input}"
        else:
            repeat_count = 0
        last_action_input = action_input

        # ── Act + Observe ──────────────────────────────────────────────────
        obs = await _execute_react_action(action, action_input, timeout_per_step)
        observation = obs["output"]
        success     = obs["ok"]

        # ── Critic ─────────────────────────────────────────────────────────
        critic = None
        rollback_result = None
        if action not in ("done", "memory_search"):
            critic = await critic_evaluate(
                goal=mission,
                action=action,
                action_input=action_input,
                observation=observation,
                step_num=step_num,
                exec_success=success,
            )
            print(f"[Critic] verdict={critic['verdict']} conf={critic['confidence']:.2f} | {critic['reason'][:60]}")
            await _emit(on_event, {"type": "critic", "step": step_num, "verdict": critic["verdict"],
                                   "reason": critic["reason"], "confidence": critic["confidence"],
                                   "rollback_needed": critic.get("rollback_needed", False)})

            # ── Auto-rollback si verdict=abort ─────────────────────────────
            if critic["verdict"] == "abort" and critic.get("rollback_needed") and critic.get("rollback_action"):
                rollback_result = await _execute_rollback(critic["rollback_action"], timeout=15)
                rollback_stack.append({
                    "step":            step_num,
                    "original_action": action_input,
                    "rollback_action": critic["rollback_action"],
                    "rollback_ok":     rollback_result["ok"],
                    "rollback_output": rollback_result["output"],
                })

        step_ms = int((time.time() - step_start) * 1000)
        step_record = {
            "step":         step_num,
            "thought":      thought,
            "action":       action,
            "action_input": action_input,
            "observation":  observation,
            "success":      success,
            "duration_ms":  step_ms,
        }
        if critic:
            step_record["critic"] = {
                "verdict":    critic["verdict"],
                "reason":     critic["reason"],
                "confidence": critic["confidence"],
            }
        if rollback_result:
            step_record["rollback"] = {
                "action": critic["rollback_action"],
                "ok":     rollback_result["ok"],
                "output": rollback_result["output"][:200],
            }
        steps_trace.append(step_record)
        await _emit(on_event, {"type": "observation", "step": step_num, "observation": observation,
                               "success": success, "duration_ms": step_ms})
        if rollback_result:
            await _emit(on_event, {"type": "rollback", "step": step_num,
                                   "rollback_action": critic.get("rollback_action", ""),
                                   "ok": rollback_result["ok"], "output": rollback_result["output"][:200]})

        print(f"[Brain/ReAct]   Obs ({step_ms}ms): {observation[:100]}")

        # ── Fin si done ────────────────────────────────────────────────────
        if action == "done":
            print(f"[Brain/ReAct] ✅ Mission terminée en {step_num} étape(s)")
            final = {
                "mission_id":   mission_id,
                "mission":      mission,
                "status":       "success",
                "steps":        steps_trace,
                "final_answer": action_input,
                "steps_taken":  step_num,
                "rollbacks":    rollback_stack,
                "provider":     result["provider"],
                "model":        result["model"],
                "duration_ms":  int((time.time() - started) * 1000),
            }
            await _emit(on_event, {"type": "done", **{k: v for k, v in final.items() if k != "steps"}})
            asyncio.create_task(_save_to_memory(final, "react"))
            return final

        # ── Message contexte pour le prochain tour ─────────────────────────
        messages.append({"role": "assistant", "content": raw})

        # Enrichir le message d'observation avec le verdict du critic
        obs_suffix = ""
        if critic:
            if critic["verdict"] == "abort":
                rb_msg = f" Rollback exécuté : {critic['rollback_action']}" if rollback_result else ""
                obs_suffix = f" [CRITIC ABORT — {critic['reason']}{rb_msg} — change d'approche]"
            elif critic["verdict"] == "retry":
                obs_suffix = f" [CRITIC RETRY — {critic['reason']} — essaie autrement]"
            # verdict ok → pas de suffix

        if not success and not obs_suffix:
            obs_suffix = " [ÉCHEC — essaie autrement]"

        messages.append({
            "role":    "user",
            "content": f"Observation: {observation}{obs_suffix}",
        })

    # max_steps atteint sans done
    final_obs = steps_trace[-1]["observation"] if steps_trace else "Aucun résultat"
    print(f"[Brain/ReAct] ⚠️  max_steps={max_steps} atteint")
    final = {
        "mission_id":   mission_id,
        "mission":      mission,
        "status":       "max_steps_reached",
        "steps":        steps_trace,
        "final_answer": final_obs,
        "steps_taken":  max_steps,
        "rollbacks":    rollback_stack,
        "provider":     "claude",
        "model":        CLAUDE_MODEL,
        "duration_ms":  int((time.time() - started) * 1000),
    }
    asyncio.create_task(_save_to_memory(final, "react"))
    return final


# ─── Supervisor / Workers ─────────────────────────────────────────────────

async def _supervisor_decompose(mission: str, max_workers: int) -> dict:
    """Appel LLM Supervisor : décompose la mission en workers avec graph de dépendances."""
    system = SUPERVISOR_DECOMPOSE_PROMPT.replace("{max_workers}", str(max_workers))
    try:
        result = await llm("strategist", [{"role": "user", "content": f"Mission: {mission}"}], system)
        raw = result["content"].strip()
        start, end = raw.find("{"), raw.rfind("}") + 1
        plan = json.loads(raw[start:end]) if start != -1 else {}
    except Exception as e:
        print(f"[Supervisor] Decompose failed: {e} — plan minimal")
        plan = {}

    # Garanties structurelles
    if not isinstance(plan.get("workers"), list) or not plan["workers"]:
        plan["workers"] = [
            {"id": "W1", "role": "analysis", "task": mission, "depends_on": [], "max_steps": 5, "priority": 1},
            {"id": "W2", "role": "synthesis", "task": f"Synthétise le résultat de W1 pour: {mission}", "depends_on": ["W1"], "max_steps": 1, "priority": 2},
        ]
    if not plan.get("goal"):
        plan["goal"] = mission

    # Valider et normaliser chaque worker
    valid_roles = {"shell", "vision", "research", "analysis", "synthesis"}
    for w in plan["workers"]:
        if not w.get("id"):
            w["id"] = f"W{plan['workers'].index(w)+1}"
        if w.get("role") not in valid_roles:
            w["role"] = "analysis"
        if not isinstance(w.get("depends_on"), list):
            w["depends_on"] = []
        w.setdefault("max_steps", 5)
        w.setdefault("priority", 1)

    return plan


def _topo_sort_workers(workers: list) -> list[list]:
    """Trie les workers en waves d'exécution parallèle (DAG topologique).

    Wave 0 : workers sans dépendances        → s'exécutent en parallèle
    Wave 1 : workers dont les deps sont Wave 0 → s'exécutent en parallèle
    ...
    Retourne une liste de listes (chaque sous-liste = une wave).
    """
    completed: set = set()
    waves: list = []
    remaining = list(workers)
    max_iterations = len(workers) + 1  # protection contre les cycles

    while remaining and max_iterations > 0:
        max_iterations -= 1
        wave = [
            w for w in remaining
            if all(dep in completed for dep in w.get("depends_on", []))
        ]
        if not wave:
            # Dépendance circulaire ou manquante — forcer l'ajout du reste
            print(f"[Supervisor] ⚠️  Dépendance non résolue — forçage des {len(remaining)} workers restants")
            wave = remaining[:]
        waves.append(wave)
        for w in wave:
            completed.add(w["id"])
            remaining.remove(w)

    return waves


def _build_worker_context(worker: dict, all_results: dict) -> str:
    """Construit le contexte des dépendances pour un worker."""
    lines = []
    for dep_id in worker.get("depends_on", []):
        res = all_results.get(dep_id, {})
        output = res.get("output", "(pas de résultat)")[:600]
        status = "✅" if res.get("success") else "❌"
        lines.append(f"[Résultat {dep_id} — {res.get('role','?')} {status}]:\n{output}")
    return "\n\n".join(lines)


async def _run_worker(worker: dict, all_results: dict, timeout_per_step: int) -> dict:
    """Exécute un worker selon son rôle.

    - shell / vision / research  → action directe via _execute_react_action
    - analysis / general / code  → mini react_loop (max worker.max_steps)
    - synthesis                  → appel LLM unique avec tous les résultats
    """
    wid   = worker["id"]
    role  = worker["role"]
    task  = worker["task"]
    steps = worker.get("max_steps", 5)
    started = time.time()

    dep_ctx = _build_worker_context(worker, all_results)
    full_task = task + (f"\n\nContexte des workers précédents:\n{dep_ctx}" if dep_ctx else "")

    print(f"[Worker {wid}] 🚀 role={role} task={task[:60]}")

    try:
        # ── Synthesis : unique appel LLM ──────────────────────────────────
        if role == "synthesis":
            # Reconstruit un résumé de TOUS les résultats pour la synthèse
            all_outputs = []
            for wid_k, res in all_results.items():
                out = res.get("output", "(vide)")[:500]
                status = "✅" if res.get("success") else "❌"
                all_outputs.append(f"[{wid_k} — {res.get('role','?')} {status}]:\n{out}")
            synthesis_prompt = (
                f"Mission originale: {task}\n\n"
                f"Résultats des workers:\n" + "\n\n".join(all_outputs)
            )
            result = await llm_react(
                [{"role": "user", "content": synthesis_prompt}],
                SUPERVISOR_SYNTHESIS_PROMPT,
            )
            return {
                "id": wid, "role": role, "task": task,
                "output": result["content"], "success": True,
                "duration_ms": int((time.time() - started) * 1000),
                "steps_taken": 1,
            }

        # ── Research : semantic_search direct ─────────────────────────────
        if role == "research":
            res = await _execute_react_action("memory_search", full_task[:200], timeout_per_step)
            return {
                "id": wid, "role": role, "task": task,
                "output": res["output"], "success": res["ok"],
                "duration_ms": int((time.time() - started) * 1000),
                "steps_taken": 1,
            }

        # ── Vision : perception directe ────────────────────────────────────
        if role == "vision":
            res = await _execute_react_action("vision", "observe", timeout_per_step)
            return {
                "id": wid, "role": role, "task": task,
                "output": res["output"], "success": res["ok"],
                "duration_ms": int((time.time() - started) * 1000),
                "steps_taken": 1,
            }

        # ── Shell simple (1 commande évidente) ────────────────────────────
        # Si la tâche ressemble à une commande directe, exécuter sans LLM
        task_stripped = full_task.strip()
        looks_like_cmd = (
            task_stripped.startswith(("ls ", "cat ", "find ", "grep ", "echo ", "mkdir ", "rm ", "mv ",
                                       "cp ", "git ", "npm ", "pip ", "python", "node ", "curl ", "open "))
            and "\n" not in task_stripped
            and len(task_stripped) < 200
        )
        if role == "shell" and looks_like_cmd:
            res = await _execute_react_action("shell", task_stripped, timeout_per_step)
            return {
                "id": wid, "role": role, "task": task,
                "output": res["output"], "success": res["ok"],
                "duration_ms": int((time.time() - started) * 1000),
                "steps_taken": 1,
            }

        # ── Tous les autres rôles : mini ReAct loop ───────────────────────
        # (shell complexe, analysis, code, general)
        loop_result = await react_loop(
            mission=full_task,
            max_steps=steps,
            mission_type="general",
            timeout_per_step=min(timeout_per_step, 30),
        )
        return {
            "id":         wid,
            "role":       role,
            "task":       task,
            "output":     loop_result.get("final_answer", ""),
            "success":    loop_result.get("status") == "success",
            "duration_ms": int((time.time() - started) * 1000),
            "steps_taken": loop_result.get("steps_taken", 0),
            "steps":      loop_result.get("steps", []),
        }

    except Exception as e:
        print(f"[Worker {wid}] ❌ Erreur: {e}")
        return {
            "id": wid, "role": role, "task": task,
            "output": f"[ERREUR] {type(e).__name__}: {str(e)[:300]}",
            "success": False,
            "duration_ms": int((time.time() - started) * 1000),
            "steps_taken": 0,
        }


async def _run_workers_wave(wave: list, all_results: dict, timeout_per_step: int) -> dict:
    """Exécute une wave de workers en parallèle via asyncio.gather.
    Retourne un dict {worker_id: result}.
    """
    tasks = [_run_worker(w, all_results, timeout_per_step) for w in wave]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    wave_results = {}
    for worker, result in zip(wave, results):
        if isinstance(result, Exception):
            wave_results[worker["id"]] = {
                "id": worker["id"], "role": worker["role"], "task": worker["task"],
                "output": f"[EXCEPTION] {result}", "success": False,
                "duration_ms": 0, "steps_taken": 0,
            }
        else:
            wave_results[worker["id"]] = result
        print(f"[Wave] Worker {worker['id']} ({worker['role']}) → {'✅' if wave_results[worker['id']]['success'] else '❌'} {wave_results[worker['id']]['duration_ms']}ms")
    return wave_results


async def supervise_loop(
    mission: str,
    max_workers: int = 5,
    timeout_per_step: int = 60,
) -> dict:
    """Supervisor/Workers orchestration — exécution parallèle par waves.

    Flow :
      1. Supervisor décompose la mission en workers + graph de dépendances
      2. Tri topologique → waves d'exécution
      3. Chaque wave est exécutée en parallèle (asyncio.gather)
      4. Les résultats s'accumulent et alimentent les waves suivantes
      5. Le worker synthesis produit la réponse finale
    """
    started    = time.time()
    mission_id = uuid.uuid4().hex[:8]

    print(f"[Supervisor] 🎯 Mission={mission_id} | '{mission[:60]}'")

    # ── Phase 1 : décomposition ────────────────────────────────────────────
    plan = await _supervisor_decompose(mission, max_workers)
    workers = plan["workers"]
    print(f"[Supervisor] 📋 Plan: {len(workers)} workers — {[w['id'] for w in workers]}")

    # ── Phase 2 : tri topologique → waves ─────────────────────────────────
    waves = _topo_sort_workers(workers)
    print(f"[Supervisor] 🌊 {len(waves)} waves: {[[w['id'] for w in wave] for wave in waves]}")

    # ── Phase 3 : exécution par waves ─────────────────────────────────────
    all_results: dict = {}
    waves_trace = []

    for wave_idx, wave in enumerate(waves):
        wave_start = time.time()
        print(f"[Supervisor] 🌊 Wave {wave_idx+1}/{len(waves)}: {[w['id'] for w in wave]}")
        wave_results = await _run_workers_wave(wave, all_results, timeout_per_step)
        all_results.update(wave_results)
        waves_trace.append({
            "wave":     wave_idx + 1,
            "workers":  [w["id"] for w in wave],
            "results":  {wid: {"success": r["success"], "duration_ms": r["duration_ms"], "steps": r.get("steps_taken", 0)}
                         for wid, r in wave_results.items()},
            "duration_ms": int((time.time() - wave_start) * 1000),
        })

    # ── Phase 4 : résultat final ───────────────────────────────────────────
    # Chercher le worker synthesis ou prendre le dernier résultat
    synthesis_workers = [w for w in workers if w["role"] == "synthesis"]
    if synthesis_workers:
        final_wid    = synthesis_workers[-1]["id"]
        final_answer = all_results.get(final_wid, {}).get("output", "")
    else:
        # Pas de synthesis explicite → fusion manuelle via LLM
        all_outputs = "\n\n".join(
            f"[{wid}]: {r.get('output','')[:400]}" for wid, r in all_results.items()
        )
        synth = await llm_react(
            [{"role": "user", "content": f"Mission: {mission}\n\nRésultats:\n{all_outputs}"}],
            SUPERVISOR_SYNTHESIS_PROMPT,
        )
        final_answer = synth["content"]

    total_ms     = int((time.time() - started) * 1000)
    workers_ok   = sum(1 for r in all_results.values() if r.get("success"))
    workers_fail = len(all_results) - workers_ok

    print(f"[Supervisor] ✅ Done in {total_ms}ms | {workers_ok}/{len(all_results)} workers OK")

    return {
        "mission_id":    mission_id,
        "status":        "success" if workers_fail == 0 else "partial",
        "goal":          plan.get("goal", mission),
        "reasoning":     plan.get("reasoning", ""),
        "waves":         waves_trace,
        "workers":       list(all_results.values()),
        "final_answer":  final_answer,
        "workers_ok":    workers_ok,
        "workers_failed": workers_fail,
        "total_workers": len(all_results),
        "duration_ms":   total_ms,
    }


# ─── Tree of Thoughts ─────────────────────────────────────────────────────

async def _tot_expand(
    mission: str,
    depth: int,
    path_so_far: List[str],
    n_branches: int,
    memory_context: str = "",
) -> List[dict]:
    """Génère n_branches pensées candidates depuis l'état courant (BFS node expansion)."""
    path_text = (
        "\n".join(f"  {i+1}. {t}" for i, t in enumerate(path_so_far))
        if path_so_far else "  (point de départ — première expansion)"
    )
    prompt = (
        TOT_EXPAND_PROMPT
        .replace("{mission}",    mission)
        .replace("{depth}",      str(depth))
        .replace("{path_so_far}", path_text)
        .replace("{n_branches}", str(n_branches))
    )
    if memory_context:
        prompt += f"\n\n[MÉMOIRE CONTEXTUELLE — expériences similaires passées]\n{memory_context}"
    try:
        result = await llm_react(
            messages=[{"role": "user", "content": "Génère les pensées candidates."}],
            system=prompt,
        )
        raw = result["content"].strip()
        brace_start = raw.find("{")
        brace_end   = raw.rfind("}")
        if brace_start != -1 and brace_end != -1:
            data = json.loads(raw[brace_start:brace_end + 1])
            thoughts = data.get("thoughts", [])
            if isinstance(thoughts, list) and thoughts:
                return thoughts[:n_branches]
    except Exception as e:
        print(f"[Brain/ToT] Expand error depth={depth}: {e}")
    # Fallback si le LLM échoue
    return [{"id": "t1", "thought": f"Approche directe pour résoudre: {mission}", "approach": "direct", "actions_preview": []}]


async def _tot_evaluate(
    mission: str,
    thought: str,
    path_so_far: List[str],
) -> dict:
    """Score une pensée candidate sur feasibility/relevance/safety → retourne dict avec is_solution."""
    path_text = (
        "\n".join(f"  {i+1}. {t}" for i, t in enumerate(path_so_far))
        if path_so_far else "  (point de départ)"
    )
    prompt = (
        TOT_EVALUATE_PROMPT
        .replace("{mission}",    mission)
        .replace("{path_so_far}", path_text)
        .replace("{thought}",    thought)
    )
    _default = {"score": 0.5, "feasibility": 0.5, "relevance": 0.5, "safety": 1.0,
                "reason": "eval failed", "is_solution": False, "solution_summary": None}
    try:
        result = await llm("strategist",
                           [{"role": "user", "content": "Évalue cette pensée."}],
                           prompt)
        raw = result["content"].strip()
        brace_start = raw.find("{")
        brace_end   = raw.rfind("}")
        if brace_start != -1 and brace_end != -1:
            data = json.loads(raw[brace_start:brace_end + 1])
            return {
                "score":            min(max(float(data.get("score",       0.5)), 0.0), 1.0),
                "feasibility":      min(max(float(data.get("feasibility", 0.5)), 0.0), 1.0),
                "relevance":        min(max(float(data.get("relevance",   0.5)), 0.0), 1.0),
                "safety":           min(max(float(data.get("safety",      1.0)), 0.0), 1.0),
                "reason":           str(data.get("reason", "")),
                "is_solution":      bool(data.get("is_solution", False)),
                "solution_summary": data.get("solution_summary"),
            }
    except Exception as e:
        print(f"[Brain/ToT] Evaluate error: {e}")
    return _default


async def tot_loop(
    mission: str,
    max_depth:  int = 4,
    n_branches: int = 3,
    beam_width: int = 2,
    timeout:    int = 120,
    on_event:   Optional[Callable] = None,
) -> dict:
    """
    Tree of Thoughts BFS avec beam search.

    À chaque niveau de profondeur :
      1. Pour chaque noeud du beam, expand → n_branches pensées (en parallèle)
      2. Évaluer toutes les pensées candidates (en parallèle)
      3. Pruning : garder les beam_width meilleurs noeuds
      4. Si is_solution=True → arrêter et générer le plan d'exécution final

    Retourne le chemin optimal + plan d'exécution actionnable.
    """
    started    = time.time()
    mission_id = uuid.uuid4().hex[:8]
    print(f"[Brain/ToT] 🌳 Start mission={mission_id} depth={max_depth} branches={n_branches} beam={beam_width}")
    await _emit(on_event, {"type": "start", "mission_id": mission_id, "mission": mission,
                           "max_depth": max_depth, "n_branches": n_branches, "beam_width": beam_width})

    # Récupération mémoire vectorielle — injecte le contexte des missions similaires
    memory_ctx = ""
    try:
        memory_ctx = await load_recent_learnings(mission_hint=mission)
    except Exception:
        pass

    # Beam courant : liste de noeuds {"path": [...], "score": float, "is_solution": bool, ...}
    beam: List[dict] = [{"path": [], "score": 1.0, "feasibility": 1.0, "relevance": 1.0,
                          "safety": 1.0, "reason": "root", "is_solution": False,
                          "solution_summary": None, "depth": 0}]
    all_nodes: List[dict] = []
    best_solution: Optional[dict] = None

    for depth in range(1, max_depth + 1):
        elapsed = time.time() - started
        if elapsed > timeout:
            print(f"[Brain/ToT] ⏰ Timeout à depth={depth} ({elapsed:.0f}s)")
            break

        print(f"[Brain/ToT] ── Depth {depth}/{max_depth}  beam_size={len(beam)}")
        await _emit(on_event, {"type": "depth_start", "depth": depth, "max_depth": max_depth, "beam_size": len(beam)})

        # ── Expansion parallèle ────────────────────────────────────────────
        expand_results = await asyncio.gather(
            *[_tot_expand(mission, depth, node["path"], n_branches, memory_ctx) for node in beam],
            return_exceptions=True,
        )

        candidates: List[tuple] = []  # (parent_path, thought_text)
        for node, expansion in zip(beam, expand_results):
            if isinstance(expansion, Exception):
                print(f"[Brain/ToT] Expand exception: {expansion}")
                continue
            for t in expansion:
                thought_text = t.get("thought", str(t))
                candidates.append((node["path"][:], thought_text))

        if not candidates:
            print(f"[Brain/ToT] Aucun candidat à depth={depth} — arrêt")
            break

        # ── Évaluation parallèle ───────────────────────────────────────────
        eval_results = await asyncio.gather(
            *[_tot_evaluate(mission, thought, path) for path, thought in candidates],
            return_exceptions=True,
        )

        scored: List[dict] = []
        for (path, thought), ev in zip(candidates, eval_results):
            if isinstance(ev, Exception):
                ev = {"score": 0.3, "feasibility": 0.3, "relevance": 0.3, "safety": 1.0,
                      "reason": str(ev), "is_solution": False, "solution_summary": None}
            node = {
                "path":             path + [thought],
                "score":            ev["score"],
                "feasibility":      ev["feasibility"],
                "relevance":        ev["relevance"],
                "safety":           ev["safety"],
                "reason":           ev["reason"],
                "is_solution":      ev["is_solution"],
                "solution_summary": ev["solution_summary"],
                "depth":            depth,
            }
            scored.append(node)
            all_nodes.append(node)
            flag = "✅" if node["is_solution"] else "  "
            print(f"[Brain/ToT]   {flag} score={node['score']:.2f} → {thought[:70]}…")

            await _emit(on_event, {"type": "node_eval", "depth": depth,
                                   "thought": thought, "score": node["score"],
                                   "feasibility": node["feasibility"], "relevance": node["relevance"],
                                   "safety": node["safety"], "reason": node["reason"],
                                   "is_solution": node["is_solution"],
                                   "solution_summary": node.get("solution_summary")})
            if node["is_solution"] and node["score"] > (best_solution["score"] if best_solution else 0.0):
                best_solution = node

        if best_solution:
            print(f"[Brain/ToT] 🎯 Solution trouvée à depth={depth} score={best_solution['score']:.2f}")
            await _emit(on_event, {"type": "solution_found", "depth": depth,
                                   "score": best_solution["score"],
                                   "path": best_solution["path"],
                                   "solution_summary": best_solution.get("solution_summary")})
            break

        # ── Beam pruning ───────────────────────────────────────────────────
        scored.sort(key=lambda n: n["score"], reverse=True)
        beam = scored[:beam_width]
        await _emit(on_event, {"type": "beam_prune", "depth": depth,
                               "kept": [n["path"][-1] if n["path"] else "" for n in beam],
                               "scores": [round(n["score"], 3) for n in beam]})
        if not beam:
            print(f"[Brain/ToT] Beam vide à depth={depth} — arrêt")
            break

    # Si aucune solution explicite → meilleur noeud du beam final
    if not best_solution:
        if beam:
            best_solution = beam[0]
            status = "best_path"
            print(f"[Brain/ToT] Pas de solution explicite, meilleur path score={best_solution['score']:.2f}")
        else:
            return {
                "mission_id":  mission_id,
                "status":      "failed",
                "reason":      "Beam vide — aucun chemin exploré",
                "all_nodes":   all_nodes,
                "duration_ms": int((time.time() - started) * 1000),
            }
    else:
        status = "solution_found"

    # ── Plan d'exécution final ─────────────────────────────────────────────
    optimal_path = best_solution["path"]
    path_text    = "\n".join(f"  {i+1}. {t}" for i, t in enumerate(optimal_path))
    plan_prompt  = (
        TOT_SOLUTION_PROMPT
        .replace("{mission}",    mission)
        .replace("{optimal_path}", path_text)
        .replace("{best_score}", f"{best_solution['score']:.2f}")
    )
    await _emit(on_event, {"type": "generating_plan"})
    try:
        plan_result    = await llm("strategist",
                                   [{"role": "user", "content": "Produis le plan d'exécution."}],
                                   plan_prompt)
        execution_plan = plan_result["content"]
        provider       = plan_result["provider"]
        model_used     = plan_result["model"]
    except Exception as e:
        execution_plan = f"Erreur génération plan: {e}"
        provider       = "unknown"
        model_used     = "unknown"

    await _emit(on_event, {"type": "plan_ready", "execution_plan": execution_plan})
    result_dict = {
        "mission_id":       mission_id,
        "status":           status,
        "goal":             mission,
        "optimal_path":     optimal_path,
        "path_depth":       len(optimal_path),
        "best_score":       round(best_solution["score"],       3),
        "feasibility":      round(best_solution["feasibility"], 3),
        "relevance":        round(best_solution["relevance"],   3),
        "safety":           round(best_solution["safety"],      3),
        "solution_summary": best_solution.get("solution_summary"),
        "execution_plan":   execution_plan,
        "tree_stats": {
            "total_nodes_explored": len(all_nodes),
            "max_depth_reached":    max((n["depth"] for n in all_nodes), default=0),
            "n_branches":           n_branches,
            "beam_width":           beam_width,
        },
        "all_nodes":   all_nodes,
        "provider":    provider,
        "model":       model_used,
        "duration_ms": int((time.time() - started) * 1000),
    }
    await _emit(on_event, {"type": "done", "mission_id": mission_id, "status": status,
                           "best_score": result_dict["best_score"],
                           "path_depth": result_dict["path_depth"],
                           "total_nodes": len(all_nodes),
                           "duration_ms": result_dict["duration_ms"]})
    asyncio.create_task(_save_to_memory(result_dict, "tot"))
    return result_dict


# ─── Models ───────────────────────────────────────────────────────────────

class ThinkRequest(BaseModel):
    mission: str
    history: List[dict] = []
    mission_type: str = "code"
    role: str = "strategist"


class ReActRequest(BaseModel):
    mission: str
    max_steps: int = 15
    mission_type: str = "general"
    timeout_per_step: int = 60


class CriticRequest(BaseModel):
    goal:          str
    action:        str                  # shell | vision | memory_search
    action_input:  str
    observation:   str
    step_num:      int   = 1
    exec_success:  bool  = True


class RollbackRequest(BaseModel):
    rollback_action: str
    timeout:         int = 15


class SuperviseRequest(BaseModel):
    mission:          str
    max_workers:      int = 5
    timeout_per_step: int = 60
    mission_type:     str = "general"


class ToTRequest(BaseModel):
    mission:    str
    max_depth:  int = 4    # profondeur max de l'arbre de pensées
    n_branches: int = 3    # pensées générées par noeud
    beam_width: int = 2    # top-K conservés par niveau (beam search)
    timeout:    int = 120  # secondes max au total


class CompressRequest(BaseModel):
    messages: List[dict]


@app.post("/think")
async def think(req: ThinkRequest):
    messages = req.history.copy()
    total_text = " ".join([m.get("content", "") for m in messages])
    if estimate_tokens(total_text) > COMPRESS_THRESHOLD:
        print(f"[Brain] Contexte > {COMPRESS_THRESHOLD} tokens → compression")
        compressed = await compress_context(messages)
        messages = [{"role": "assistant", "content": f"[Contexte résumé]: {compressed}"}]

    # C1 — contexte enrichi : domain + skills + mémoire sémantique (en parallèle)
    domain_ctx, skills_ctx, learnings_ctx = await asyncio.gather(
        _async_load_domain_context(req.mission_type),
        _async_load_skills_list(),
        load_recent_learnings(mission_hint=req.mission),   # sémantique si ChromaDB dispo
        return_exceptions=True,
    )
    domain_ctx   = domain_ctx   if isinstance(domain_ctx, str)   else ""
    skills_ctx   = skills_ctx   if isinstance(skills_ctx, str)   else ""
    learnings_ctx = learnings_ctx if isinstance(learnings_ctx, str) else ""

    context_blocks = []
    if domain_ctx:
        context_blocks.append(f"### Contexte domaine\n{domain_ctx[:800]}")
    if skills_ctx:
        context_blocks.append(skills_ctx)
    if learnings_ctx:
        context_blocks.append(learnings_ctx)
    extra_context = "\n\n".join(context_blocks)

    system_prompt = f"""Tu es le cerveau de Ghost OS Ultimate v2.0 — agent autonome hybride tournant 100% sur macOS.
LLM principal : Claude claude-opus-4-6 (Anthropic). Fallback chain : Kimi → OpenAI → Ollama local.
Tu analyses la mission et la décomposes en sous-tâches atomiques parallélisables.
Maximum {CONFIG['brain']['max_subtasks']} sous-tâches. Réponds UNIQUEMENT en JSON valide sans markdown.

## Format de réponse requis

{{
  "goal": "description concise de l'objectif",
  "subtasks": [
    {{
      "id": "1",
      "role": "shell|vision|worker|strategist",
      "instruction": "description humaine de la tâche",
      "command": "UNIQUEMENT pour role=shell : la commande bash exacte, ex: ls -la",
      "risk": "low|medium|high",
      "confidence": 0.85,
      "depends_on": [],
      "rollback": "comment annuler si ça échoue"
    }}
  ],
  "reasoning": "pourquoi cette décomposition",
  "estimated_duration": "Xs",
  "parallelizable": true
}}

## Règles de décomposition

- **low**: action sûre et réversible (lecture, affichage, status)
- **medium**: modification système (écriture fichier, installation)
- **high**: suppression ou changement critique (rm, format, shutdown) → HITL obligatoire
- **confidence**: 0.0–1.0 (ta certitude que cette sous-tâche va réussir)
- **depends_on**: IDs des sous-tâches qui doivent terminer avant celle-ci ([] = parallélisable)
- **rollback**: étape concrète pour annuler si la sous-tâche échoue

## Rôles disponibles

- **shell**: commande terminal via executor sandboxé
  ⚠️ IMPORTANT : pour role=shell, "instruction" doit être LA COMMANDE BASH EXACTE à exécuter,
  PAS une description en langage naturel. Exemples corrects :
  ✅ "ls -la"  ✅ "cat /etc/hosts"  ✅ "python3 script.py"
  ❌ "Exécuter la commande ls -la"  ❌ "Lister les fichiers"
- **vision**: capture + analyse visuelle de l'écran
- **worker**: tâche de réflexion/génération via LLM (instruction = prompt en langage naturel)
- **strategist**: planification ou analyse complexe via LLM haute qualité
{f"{chr(10)}{extra_context}" if extra_context else ""}"""
    messages.append({"role": "user", "content": req.mission})
    result = await llm(req.role, messages, system_prompt)
    raw_content = result["content"].strip()
    # Extraire le JSON même si le LLM ajoute du texte avant/après
    json_match = None
    brace_start = raw_content.find("{")
    brace_end = raw_content.rfind("}")
    if brace_start != -1 and brace_end != -1:
        json_match = raw_content[brace_start:brace_end + 1]
    try:
        plan = json.loads(json_match or raw_content)
    except Exception:
        plan = {}
    # Garantir la structure minimale attendue
    if not isinstance(plan.get("subtasks"), list) or not plan["subtasks"]:
        plan["subtasks"] = [
            {"id": "1", "role": "worker", "instruction": req.mission, "risk": "medium"}
        ]
    if not plan.get("goal"):
        plan["goal"] = req.mission
    if not plan.get("reasoning"):
        plan["reasoning"] = raw_content if not json_match else plan.get("reasoning", "")
    if not plan.get("estimated_duration"):
        plan["estimated_duration"] = "?"
    # Valider chaque subtask
    valid_roles = {"shell", "vision", "worker", "strategist", "repair"}
    valid_risks = set(CONFIG["brain"]["risk_levels"])
    for st in plan["subtasks"]:
        if st.get("role") not in valid_roles:
            st["role"] = "worker"
        if st.get("risk") not in valid_risks:
            st["risk"] = "medium"
        if not st.get("id"):
            st["id"] = str(plan["subtasks"].index(st) + 1)
        if not st.get("instruction"):
            st["instruction"] = req.mission
    return {
        "plan": plan,
        "provider": result["provider"],
        "model": result["model"],
        "tokens_estimated": estimate_tokens(total_text)
    }


@app.post("/compress")
async def compress(req: CompressRequest):
    compressed = await compress_context(req.messages)
    return {
        "compressed": compressed,
        "original_tokens": estimate_tokens(" ".join([m.get("content", "") for m in req.messages])),
        "compressed_tokens": estimate_tokens(compressed)
    }


@app.post("/critic")
async def critic_endpoint(req: CriticRequest):
    """Critic standalone — évalue une action/observation sans boucle ReAct.

    Utile pour tester le critic ou l'intégrer dans un pipeline externe.
    """
    result = await critic_evaluate(
        goal=req.goal,
        action=req.action,
        action_input=req.action_input,
        observation=req.observation,
        step_num=req.step_num,
        exec_success=req.exec_success,
    )
    return result


@app.post("/rollback")
async def rollback_endpoint(req: RollbackRequest):
    """Exécute un rollback bash via executor :8004."""
    result = await _execute_rollback(req.rollback_action, req.timeout)
    return result


@app.post("/react")
async def react(req: ReActRequest):
    """
    Boucle ReAct complète — Reason → Act → Observe → repeat.

    Contrairement à /think (planifie une fois + exécute), /react boucle
    jusqu'à atteindre l'objectif ou max_steps.

    Corps :
      mission          — la tâche à accomplir
      max_steps        — nombre max d'itérations (défaut: 15)
      mission_type     — contexte domaine (défaut: general)
      timeout_per_step — secondes max par action (défaut: 60)
    """
    return await react_loop(
        mission=req.mission,
        max_steps=req.max_steps,
        mission_type=req.mission_type,
        timeout_per_step=req.timeout_per_step,
    )


@app.post("/supervise")
async def supervise(req: SuperviseRequest):
    """
    Supervisor/Workers parallèles — décompose, exécute en vagues, synthétise.

    Le Superviseur décompose la mission en workers indépendants ou dépendants,
    les exécute en vagues parallèles (via asyncio.gather + DAG topologique),
    puis synthétise les résultats en une réponse unifiée.

    Corps :
      mission          — la tâche à accomplir
      max_workers      — nombre max de workers parallèles (défaut: 5)
      timeout_per_step — secondes max par worker (défaut: 60)
      mission_type     — contexte domaine (défaut: general)
    """
    return await supervise_loop(
        mission=req.mission,
        max_workers=req.max_workers,
        timeout_per_step=req.timeout_per_step,
    )


@app.post("/tot")
async def tree_of_thoughts(req: ToTRequest):
    """
    Tree of Thoughts BFS avec beam search — exploration multi-chemins parallèle.

    À chaque profondeur :
      1. Expand : génère n_branches pensées candidates par noeud du beam (en parallèle)
      2. Evaluate : score chaque pensée sur feasibility/relevance/safety (en parallèle)
      3. Prune : garde les beam_width meilleurs chemins
      4. Si is_solution=True → arrêt et génération du plan d'exécution final

    Corps :
      mission    — la tâche à résoudre
      max_depth  — profondeur max de l'arbre (défaut: 4)
      n_branches — branches générées par noeud (défaut: 3)
      beam_width — taille du beam / top-K conservés (défaut: 2)
      timeout    — secondes max total (défaut: 120)
    """
    return await tot_loop(
        mission=req.mission,
        max_depth=req.max_depth,
        n_branches=req.n_branches,
        beam_width=req.beam_width,
        timeout=req.timeout,
    )


# ─── Observabilité endpoints ──────────────────────────────────────────────────

@app.get("/metrics/snapshot")
async def metrics_snapshot():
    """Snapshot instantané : santé des 7 couches + système + alertes.
    Lance une collecte fraîche si l'historique est vide.
    """
    async with _METRICS_LOCK_OBS:
        if _METRICS_HISTORY:
            latest = _METRICS_HISTORY[-1]
            # Si le snapshot est récent (<12s), le retourner directement
            if time.time() - latest["timestamp"] < 12:
                return latest
    # Collecte fraîche
    return await _collect_snapshot()


@app.get("/metrics/history")
async def metrics_history(n: int = Query(30)):
    """Historique des n derniers snapshots (max 60 = 10min à 10s/snapshot)."""
    async with _METRICS_LOCK_OBS:
        history = list(_METRICS_HISTORY)
    # Extrait uniquement les champs légers pour l'historique (sparklines)
    slim = []
    for s in history[-min(n, 60):]:
        slim.append({
            "timestamp":    s["timestamp"],
            "cpu_percent":  s.get("system", {}).get("cpu_percent",  0),
            "ram_percent":  s.get("system", {}).get("ram_percent",  0),
            "disk_percent": s.get("system", {}).get("disk_percent", 0),
            "layers_ok":    s.get("layers_ok",    0),
            "alerts_count": s.get("alerts_count", 0),
            "missions_active": s.get("missions", {}).get("active", 0),
        })
    return {"history": slim, "count": len(slim)}


@app.get("/metrics/stream")
async def metrics_stream():
    """SSE — pousse un snapshot complet toutes les 10 secondes.
    Consomme via EventSource('/brain/metrics/stream') dans le dashboard.
    """
    async def generate():
        last_ts = 0.0
        keepalive_count = 0
        while True:
            await asyncio.sleep(2)
            async with _METRICS_LOCK_OBS:
                snap = _METRICS_HISTORY[-1] if _METRICS_HISTORY else None
            if snap and snap["timestamp"] != last_ts:
                last_ts = snap["timestamp"]
                yield f"data: {json.dumps(snap, ensure_ascii=False)}\n\n"
                keepalive_count = 0
            else:
                keepalive_count += 1
                if keepalive_count % 5 == 0:  # keepalive toutes les 10s
                    yield ": keepalive\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream", headers=_sse_headers())


# ─── SSE Streaming endpoints ──────────────────────────────────────────────────

def _sse_headers():
    return {"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"}


@app.get("/react/stream")
async def react_stream(
    mission:          str = Query(...),
    max_steps:        int = Query(15),
    mission_type:     str = Query("general"),
    timeout_per_step: int = Query(60),
):
    """SSE — stream la boucle ReAct étape par étape en temps réel.

    Événements émis : start | step_start | thought | observation | critic | rollback | done | error
    Consomme via EventSource('GET /react/stream?mission=...') dans le dashboard.
    """
    queue: asyncio.Queue = asyncio.Queue()

    async def on_event(event: dict):
        await queue.put(event)

    async def generate():
        task = asyncio.create_task(
            react_loop(mission, max_steps, mission_type, timeout_per_step, on_event=on_event)
        )
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=2.0)
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                if event.get("type") in ("done", "error"):
                    break
            except asyncio.TimeoutError:
                if task.done():
                    break
                yield ": keepalive\n\n"
        try:
            await task
        except Exception:
            pass

    return StreamingResponse(generate(), media_type="text/event-stream", headers=_sse_headers())


@app.get("/tot/stream")
async def tot_stream(
    mission:    str = Query(...),
    max_depth:  int = Query(4),
    n_branches: int = Query(3),
    beam_width: int = Query(2),
    timeout:    int = Query(120),
):
    """SSE — stream le Tree of Thoughts noeud par noeud en temps réel.

    Événements émis : start | depth_start | node_eval | beam_prune | solution_found |
                      generating_plan | plan_ready | done
    Consomme via EventSource('GET /tot/stream?mission=...') dans le dashboard.
    """
    queue: asyncio.Queue = asyncio.Queue()

    async def on_event(event: dict):
        await queue.put(event)

    async def generate():
        task = asyncio.create_task(
            tot_loop(mission, max_depth, n_branches, beam_width, timeout, on_event=on_event)
        )
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=2.0)
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                if event.get("type") in ("done", "error"):
                    break
            except asyncio.TimeoutError:
                if task.done():
                    break
                yield ": keepalive\n\n"
        try:
            await task
        except Exception:
            pass

    return StreamingResponse(generate(), media_type="text/event-stream", headers=_sse_headers())


# ─── Evolution proxy endpoints (/evolution/*  →  evolution.py :8005) ────────

EVOLUTION_URL = f"http://localhost:{_PORTS['evolution']}"


async def _proxy(method: str, path: str, body: Any = None, params: dict = None) -> dict:
    """Helper générique pour proxier vers un service interne."""
    try:
        async with httpx.AsyncClient(timeout=120) as c:
            if method == "GET":
                r = await c.get(f"{EVOLUTION_URL}{path}", params=params or {})
            elif method == "POST":
                r = await c.post(f"{EVOLUTION_URL}{path}", json=body or {}, params=params or {})
            elif method == "DELETE":
                r = await c.delete(f"{EVOLUTION_URL}{path}", params=params or {})
            else:
                return {"error": f"Méthode non supportée: {method}"}
            r.raise_for_status()
            return r.json()
    except httpx.ConnectError:
        return {"error": "Evolution service inaccessible (port 8005)"}
    except Exception as e:
        return {"error": str(e)}


@app.get("/evolution/skills")
async def evolution_list_skills():
    return await _proxy("GET", "/skills")


@app.get("/evolution/skills/{name}")
async def evolution_skill_detail(name: str):
    return await _proxy("GET", f"/skills/{name}")


@app.post("/evolution/generate")
async def evolution_generate(req: dict):
    return await _proxy("POST", "/generate-skill-node", req)


@app.post("/evolution/evolve")
async def evolution_evolve(req: dict):
    return await _proxy("POST", "/evolve", req)


@app.post("/evolution/evaluate")
async def evolution_evaluate(req: dict):
    return await _proxy("POST", "/evaluate", req)


@app.get("/evolution/log")
async def evolution_log(limit: int = Query(50)):
    return await _proxy("GET", "/evolution-log", params={"limit": limit})


@app.get("/evolution/metrics")
async def evolution_metrics():
    return await _proxy("GET", "/metrics")


@app.post("/evolution/analyze")
async def evolution_analyze():
    return await _proxy("POST", "/analyze-failures")


# ─── Memory proxy endpoints (/memory/*  →  memory.py :8006) ──────────────────

@app.get("/memory/search")
async def memory_search_proxy(q: str = Query(...), n: int = Query(5)):
    """Recherche sémantique dans la mémoire vectorielle. Proxié vers memory.py :8006."""
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(
                f"{MEMORY_URL}/semantic_search",
                json={"query": q, "n_results": n, "min_similarity": 0.25},
            )
            r.raise_for_status()
            return r.json()
    except Exception as e:
        return {"results": [], "error": str(e), "chroma_ready": False}


@app.get("/memory/stats")
async def memory_stats_proxy():
    """Statistiques mémoire vectorielle (total épisodes, ChromaDB, embed model)."""
    try:
        async with httpx.AsyncClient(timeout=8) as c:
            r = await c.get(f"{MEMORY_URL}/profile")
            r.raise_for_status()
            return r.json()
    except Exception as e:
        return {"total_episodes": 0, "chroma_indexed": 0, "chroma_ready": False, "error": str(e)}


@app.get("/memory/episodes")
async def memory_episodes_proxy(limit: int = Query(20)):
    """Liste des épisodes récents depuis la mémoire vectorielle."""
    try:
        async with httpx.AsyncClient(timeout=8) as c:
            r = await c.get(f"{MEMORY_URL}/episodes", params={"limit": limit})
            r.raise_for_status()
            return r.json()
    except Exception as e:
        return {"episodes": [], "error": str(e)}


@app.delete("/memory/{episode_id}")
async def memory_forget_proxy(episode_id: str):
    """Supprime un épisode de la mémoire vectorielle (JSONL + ChromaDB)."""
    try:
        async with httpx.AsyncClient(timeout=8) as c:
            r = await c.delete(f"{MEMORY_URL}/episode/{episode_id}")
            r.raise_for_status()
            return r.json()
    except Exception as e:
        return {"deleted": False, "error": str(e)}


@app.post("/memory/reindex")
async def memory_reindex_proxy():
    """Lance une ré-indexation complète de tous les épisodes dans ChromaDB."""
    try:
        async with httpx.AsyncClient(timeout=8) as c:
            r = await c.post(f"{MEMORY_URL}/reindex")
            r.raise_for_status()
            return r.json()
    except Exception as e:
        return {"started": False, "error": str(e)}


# ─── Planner proxy endpoints (/planner/*  →  planner.py :8008) ───────────────

PLANNER_URL = "http://localhost:8008"


async def _proxy_planner(method: str, path: str, body: Any = None, params: dict = None) -> dict:
    """Helper pour proxier vers le service Planner :8008."""
    try:
        async with httpx.AsyncClient(timeout=120) as c:
            if method == "GET":
                r = await c.get(f"{PLANNER_URL}{path}", params=params or {})
            elif method == "POST":
                r = await c.post(f"{PLANNER_URL}{path}", json=body or {}, params=params or {})
            elif method == "DELETE":
                r = await c.delete(f"{PLANNER_URL}{path}", params=params or {})
            else:
                return {"error": f"Méthode non supportée: {method}"}
            r.raise_for_status()
            return r.json()
    except httpx.ConnectError:
        return {"error": "Planner service inaccessible (port 8008)"}
    except Exception as e:
        return {"error": str(e)}


@app.post("/planner/plan")
async def planner_create(req: dict):
    return await _proxy_planner("POST", "/plan", req)


@app.post("/planner/execute")
async def planner_execute(req: dict):
    return await _proxy_planner("POST", "/plan/execute", req)


@app.get("/planner/plans")
async def planner_list(limit: int = Query(20)):
    return await _proxy_planner("GET", "/plans", params={"limit": limit})


@app.get("/planner/plan/{plan_id}")
async def planner_detail(plan_id: str):
    return await _proxy_planner("GET", f"/plan/{plan_id}")


@app.get("/planner/plan/{plan_id}/status")
async def planner_status(plan_id: str):
    return await _proxy_planner("GET", f"/plan/{plan_id}/status")


@app.post("/planner/replan")
async def planner_replan(req: dict):
    return await _proxy_planner("POST", "/plan/replan", req)


@app.post("/planner/search")
async def planner_search(req: dict):
    return await _proxy_planner("POST", "/plan/search", req)


@app.get("/planner/health")
async def planner_health():
    return await _proxy_planner("GET", "/health")


# ─── Learner proxy endpoints (/learner/*  →  learner.py :8009) ───────────────

LEARNER_URL = "http://localhost:8009"


async def _proxy_learner(method: str, path: str, body: Any = None, params: dict = None) -> dict:
    """Helper pour proxier vers le service Learner :8009."""
    try:
        async with httpx.AsyncClient(timeout=120) as c:
            if method == "GET":
                r = await c.get(f"{LEARNER_URL}{path}", params=params or {})
            elif method == "POST":
                r = await c.post(f"{LEARNER_URL}{path}", json=body or {}, params=params or {})
            else:
                return {"error": f"Méthode non supportée: {method}"}
            r.raise_for_status()
            return r.json()
    except httpx.ConnectError:
        return {"error": "Learner service inaccessible (port 8009)"}
    except Exception as e:
        return {"error": str(e)}


@app.post("/learner/learn")
async def learner_learn_one(req: dict):
    return await _proxy_learner("POST", "/learn", req)


@app.post("/learner/batch")
async def learner_batch(req: dict):
    return await _proxy_learner("POST", "/learn/batch", req)


@app.get("/learner/skills")
async def learner_skills():
    return await _proxy_learner("GET", "/learned-skills")


@app.get("/learner/stats")
async def learner_stats():
    return await _proxy_learner("GET", "/learning-stats")


@app.post("/learner/trigger")
async def learner_trigger(req: dict = {}):
    return await _proxy_learner("POST", "/learn/trigger", req)


@app.get("/learner/health")
async def learner_health():
    return await _proxy_learner("GET", "/health")


# ─── Goals proxy endpoints (/goals/*  →  goals.py :8010) ─────────────────────

GOALS_URL = "http://localhost:8010"


async def _proxy_goals(method: str, path: str, body: Any = None, params: dict = None) -> dict:
    """Helper pour proxier vers le service Goals :8010."""
    try:
        async with httpx.AsyncClient(timeout=60) as c:
            if method == "GET":
                r = await c.get(f"{GOALS_URL}{path}", params=params or {})
            elif method == "POST":
                r = await c.post(f"{GOALS_URL}{path}", json=body or {}, params=params or {})
            elif method == "DELETE":
                r = await c.delete(f"{GOALS_URL}{path}")
            elif method == "PATCH":
                r = await c.patch(f"{GOALS_URL}{path}", json=body or {})
            else:
                return {"error": f"Méthode non supportée: {method}"}
            r.raise_for_status()
            return r.json()
    except httpx.ConnectError:
        return {"error": "Goals service inaccessible (port 8010)"}
    except Exception as e:
        return {"error": str(e)}


@app.post("/goals")
async def goals_create(req: dict):
    return await _proxy_goals("POST", "/goals", req)


@app.get("/goals")
async def goals_list(status: str = Query("all"), limit: int = Query(100)):
    return await _proxy_goals("GET", "/goals", params={"status": status, "limit": limit})


@app.get("/goals/schedule")
async def goals_schedule():
    return await _proxy_goals("GET", "/goals/schedule")


@app.get("/goals/stats")
async def goals_stats():
    return await _proxy_goals("GET", "/goals/stats")


@app.get("/goals/{goal_id}")
async def goals_detail(goal_id: str):
    return await _proxy_goals("GET", f"/goals/{goal_id}")


@app.delete("/goals/{goal_id}")
async def goals_delete(goal_id: str):
    return await _proxy_goals("DELETE", f"/goals/{goal_id}")


@app.patch("/goals/{goal_id}/status")
async def goals_status(goal_id: str, req: dict):
    return await _proxy_goals("PATCH", f"/goals/{goal_id}/status", req)


@app.post("/goals/{goal_id}/execute")
async def goals_execute(goal_id: str):
    return await _proxy_goals("POST", f"/goals/{goal_id}/execute")


@app.post("/goals/{goal_id}/plan")
async def goals_plan(goal_id: str):
    return await _proxy_goals("POST", f"/goals/{goal_id}/plan")


@app.get("/goals/health")
async def goals_health():
    return await _proxy_goals("GET", "/health")


@app.post("/raw")
async def raw_llm(req: dict):
    result = await llm(
        req.get("role", "worker"),
        req.get("messages", [{"role": "user", "content": req.get("prompt", "")}]),
        req.get("system", "")
    )
    return result


@app.get("/health")
async def health():
    mlx_ok = mlx_available()
    claude_ok = claude_available()
    active_provider = "claude" if claude_ok else ("mlx" if mlx_ok else "ollama")
    return {
        "status": "ok",
        "layer": "brain",
        "active_provider": active_provider,
        "providers": {
            "claude": claude_ok,
            "mlx": mlx_ok,
            "ollama": OLLAMA_URL,
            "kimi": bool(os.environ.get("KIMI_API_KEY")),
        },
        "models": MODELS,
        "claude_model": CLAUDE_MODEL if claude_ok else None,
        "circuit_breakers": {k: {"failures": v, "open": v >= _PROVIDER_MAX_FAILURES} for k, v in _provider_failures.items()},
        "circuit_reset_count": _circuit_reset_count,
        "react_enabled":            True,
        "critic_enabled":           True,
        "supervisor_enabled":       True,
        "tot_enabled":              True,
        "vector_memory_enabled":    True,
        "observability_enabled":    True,
        "metrics_history_size":     len(_METRICS_HISTORY),
        "react_max_steps_default":         15,
        "supervisor_max_workers_default":  5,
        "tot_default_config": {"max_depth": 4, "n_branches": 3, "beam_width": 2},
        "memory_url": MEMORY_URL,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=CONFIG["ports"]["brain"])
