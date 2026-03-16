"""
Couche apprentissage — port 8009
Extrait des skills Node.js réutilisables depuis les traces d'épisodes ReAct/ToT réussis.

Architecture :
  - POST /learn              → analyse UN épisode par ID ou mission → génère un skill si apprennable
  - POST /learn/batch        → scanne les N derniers épisodes, extrait tous les patterns apprenables
  - GET  /learned-skills     → liste tous les skills générés par le Learner
  - GET  /learning-stats     → stats : épisodes scannés, skills générés, taux de validation, dernier run
  - POST /learn/trigger      → déclenchement manuel (batch limit=50)
  - GET  /health             → état du service
"""

import os
import json
import asyncio
import re
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from contextlib import asynccontextmanager

# ─── Configuration ──────────────────────────────────────────────────────────

LEARNER_PORT    = int(os.getenv("LEARNER_PORT",    "8009"))
BRAIN_URL       = os.getenv("BRAIN_URL",        "http://localhost:8003")
MEMORY_URL      = os.getenv("MEMORY_URL",       "http://localhost:8006")
EVOLUTION_URL   = os.getenv("EVOLUTION_URL",    "http://localhost:8005")
EPISODES_FILE   = Path(__file__).parent / "memory" / "episodes.jsonl"
LEARNED_LOG     = Path(__file__).parent / "learned_skills.jsonl"
SKILLS_REGISTRY = Path(__file__).parent.parent / "skills" / "registry.json"

_LEARN_LOCK = asyncio.Lock()

# ─── State global ────────────────────────────────────────────────────────────

_stats: dict = {
    "episodes_scanned_total":  0,
    "skills_generated":        0,
    "skills_failed_validation": 0,
    "last_run_at":             None,
    "last_run_learned":        0,
    "background_task_active":  False,
}

# ─── Lifespan ─────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialisation des fichiers + lancement de la boucle d'auto-apprentissage."""
    global _stats

    # Création des répertoires et fichiers nécessaires
    EPISODES_FILE.parent.mkdir(parents=True, exist_ok=True)
    if not EPISODES_FILE.exists():
        EPISODES_FILE.write_text("", encoding="utf-8")

    if not LEARNED_LOG.exists():
        LEARNED_LOG.write_text("", encoding="utf-8")

    # Compte les skills déjà générés au démarrage
    existing = _read_learned_safe()
    _stats["skills_generated"] = len(existing)

    print(f"[Learner] Démarrage — {len(existing)} skills appris, épisodes: {EPISODES_FILE.name}")

    # Lance la boucle d'auto-apprentissage en arrière-plan
    task = asyncio.create_task(_auto_learn_loop())
    _stats["background_task_active"] = True
    print(f"[Learner] Boucle auto-apprentissage lancée (cycle 4h)")

    yield

    task.cancel()
    _stats["background_task_active"] = False
    print("[Learner] Arrêt propre.")


# ─── App FastAPI ──────────────────────────────────────────────────────────────

app = FastAPI(title="Ghost OS Learner", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Modèles Pydantic ─────────────────────────────────────────────────────────

class LearnRequest(BaseModel):
    episode_id: Optional[str] = None
    mission:    Optional[str] = None  # alternative : recherche par texte de mission

class BatchLearnRequest(BaseModel):
    limit: int  = 30
    force: bool = False  # réapprendre les épisodes déjà traités

class TriggerRequest(BaseModel):
    limit: int = 50


# ─── Helpers JSONL ────────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _read_episodes_safe() -> list[dict]:
    """Lit episodes.jsonl en ignorant les lignes corrompues."""
    episodes = []
    if not EPISODES_FILE.exists():
        return episodes
    for line in EPISODES_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            episodes.append(json.loads(line))
        except json.JSONDecodeError as e:
            print(f"[Learner] Ligne épisode corrompue ignorée : {e} — {line[:60]}")
    return episodes


def _read_learned_safe() -> list[dict]:
    """Lit learned_skills.jsonl en ignorant les lignes corrompues."""
    entries = []
    if not LEARNED_LOG.exists():
        return entries
    for line in LEARNED_LOG.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            entries.append(json.loads(line))
        except json.JSONDecodeError as e:
            print(f"[Learner] Ligne learned corrompue ignorée : {e} — {line[:60]}")
    return entries


async def _append_learned(entry: dict) -> None:
    """Ajoute une entrée dans learned_skills.jsonl (thread-safe)."""
    async with _LEARN_LOCK:
        with open(LEARNED_LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def _already_learned(mission: str) -> bool:
    """Vérifie si un épisode (par texte de mission) a déjà été appris."""
    for entry in _read_learned_safe():
        if entry.get("source_mission", "").strip() == mission.strip():
            return True
    return False


def _extract_json(text: str) -> Optional[dict]:
    """Extrait le premier objet JSON valide d'une réponse LLM (gère le markdown)."""
    # Retire les balises markdown éventuelles
    text = re.sub(r"```(?:json)?\n?", "", text).replace("```", "").strip()
    match = re.search(r"\{[\s\S]+\}", text)
    if not match:
        return None
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError:
        return None


# ─── Prompt d'analyse d'apprenabilité ────────────────────────────────────────

_LEARNABILITY_PROMPT_TEMPLATE = """Tu analyses un épisode d'agent autonome pour déterminer s'il peut devenir un skill réutilisable.

ÉPISODE:
Mission: {mission}
Résultat: {result}
Durée: {duration_ms}ms
Appris: {learned}

Un épisode est réutilisable si:
- La mission correspond à une ACTION RÉPÉTABLE (ex: "liste les fichiers", "fetch une URL", "lit un fichier")
- Le résultat montre une MÉTHODE CLAIRE et GÉNÉRALISTE
- Le skill peut s'appliquer à d'autres missions similaires avec des paramètres différents

Un épisode N'EST PAS réutilisable si:
- La mission est trop spécifique (nom de fichier exact, date précise, contexte unique)
- Le résultat est une analyse ponctuelle sans méthode généralisable
- La mission demande une décision subjective ou créative

Réponds UNIQUEMENT en JSON valide:
{{
  "learnable": true|false,
  "skill_name": "snake_case_nom_court",
  "goal": "Description claire du skill en 1 phrase (action + objet)",
  "params": {{"param1": "description", "param2": "description (optionnel)"}},
  "reason": "Pourquoi ce skill est/n'est pas réutilisable (max 80 chars)"
}}"""


# ─── Fonctions principales ────────────────────────────────────────────────────

async def _analyze_learnability(episode: dict) -> Optional[dict]:
    """
    Appelle Brain /raw pour évaluer si l'épisode peut devenir un skill réutilisable.
    Retourne un dict avec learnable, skill_name, goal, params, reason — ou None si erreur.
    """
    prompt = _LEARNABILITY_PROMPT_TEMPLATE.format(
        mission     = episode.get("mission",     ""),
        result      = episode.get("result",      "")[:500],
        duration_ms = episode.get("duration_ms", 0),
        learned     = episode.get("learned",     ""),
    )

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                f"{BRAIN_URL}/raw",
                json={
                    "prompt": prompt,
                    "system": (
                        "Tu es un analyseur d'épisodes d'agent. "
                        "Réponds uniquement avec du JSON valide, sans markdown ni explication."
                    ),
                },
            )
            resp.raise_for_status()
            raw_text = resp.json().get("response") or resp.json().get("content", "")

        analysis = _extract_json(raw_text)
        if not analysis:
            print(f"[Learner] Pas de JSON dans la réponse d'analyse : {raw_text[:120]}")
            return None

        # Valide les champs obligatoires
        if not isinstance(analysis.get("learnable"), bool):
            return None

        return analysis

    except Exception as e:
        print(f"[Learner] Erreur analyse apprenabilité : {e}")
        return None


async def _generate_skill_from_episode(episode: dict, analysis: dict) -> dict:
    """
    Appelle Evolution /generate-skill-node avec les données extraites de l'épisode.
    Retourne le résultat brut de l'endpoint Evolution.
    """
    payload = {
        "name":        analysis["skill_name"],
        "goal":        analysis["goal"],
        "description": f"Appris depuis: {episode.get('mission', '')[:80]}",
        "examples": [
            {
                "mission": episode.get("mission", ""),
                "result":  episode.get("result",  "")[:200],
            }
        ],
        "params": analysis.get("params", {}),
    }

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                f"{EVOLUTION_URL}/generate-skill-node",
                json=payload,
            )
            resp.raise_for_status()
            return resp.json()
    except Exception as e:
        print(f"[Learner] Erreur génération skill '{analysis['skill_name']}' : {e}")
        return {"created": False, "error": str(e)}


async def _run_batch_learn(limit: int = 30, force: bool = False) -> dict:
    """
    Cœur du processus d'apprentissage par lot :
    1. Lit les `limit` derniers épisodes réussis
    2. Filtre les déjà appris (sauf si force=True)
    3. Pour chaque candidat : analyse apprenabilité → génère le skill si learnable
    4. Logue dans learned_skills.jsonl
    5. Retourne le résumé
    """
    global _stats

    episodes   = _read_episodes_safe()
    successful = [ep for ep in episodes if ep.get("success") is True]
    candidates = successful[-limit:]  # les N derniers épisodes réussis

    scanned   = 0
    skipped   = 0
    learned   = 0
    failed    = 0
    generated = []

    for episode in candidates:
        mission = episode.get("mission", "").strip()
        if not mission:
            skipped += 1
            continue

        scanned += 1
        _stats["episodes_scanned_total"] += 1

        # Ignore les épisodes déjà appris (sauf en mode force)
        if not force and _already_learned(mission):
            skipped += 1
            continue

        print(f"[Learner] Analyse : {mission[:70]}")

        # Étape 1 — Analyse apprenabilité
        analysis = await _analyze_learnability(episode)
        if analysis is None:
            failed += 1
            continue

        if not analysis.get("learnable"):
            print(f"[Learner] Non-apprennable : {analysis.get('reason', '')[:80]}")
            # Logue quand même pour éviter de ré-analyser à chaque cycle
            await _append_learned({
                "timestamp":        _now(),
                "skill_name":       None,
                "source_mission":   mission,
                "goal":             None,
                "syntax_ok":        None,
                "version":          None,
                "learnable_reason": analysis.get("reason", ""),
                "episode_timestamp": episode.get("timestamp", ""),
                "learnable":        False,
            })
            skipped += 1
            continue

        skill_name = analysis.get("skill_name", "")
        if not skill_name or not re.match(r'^[a-zA-Z0-9_\-]+$', skill_name):
            print(f"[Learner] Nom de skill invalide : '{skill_name}' — ignoré")
            failed += 1
            continue

        print(f"[Learner] Génération skill '{skill_name}' — {analysis.get('goal', '')[:60]}")

        # Étape 2 — Génération du skill via Evolution
        gen_result = await _generate_skill_from_episode(episode, analysis)

        syntax_ok = gen_result.get("syntax_ok", False)
        created   = gen_result.get("created",   False)
        version   = gen_result.get("version",   "1.0.0")

        if not created:
            print(f"[Learner] Génération échouée : {gen_result.get('error', '?')}")
            _stats["skills_failed_validation"] += 1
            failed += 1
        else:
            learned += 1
            _stats["skills_generated"] += 1
            if not syntax_ok:
                _stats["skills_failed_validation"] += 1
            print(f"[Learner] Skill '{skill_name}' créé — syntax_ok={syntax_ok}")
            generated.append({
                "skill_name": skill_name,
                "goal":       analysis["goal"],
                "syntax_ok":  syntax_ok,
                "version":    version,
            })

        # Logue dans learned_skills.jsonl
        await _append_learned({
            "timestamp":         _now(),
            "skill_name":        skill_name if created else None,
            "source_mission":    mission,
            "goal":              analysis.get("goal", ""),
            "syntax_ok":         syntax_ok if created else None,
            "version":           version if created else None,
            "learnable_reason":  analysis.get("reason", ""),
            "episode_timestamp": episode.get("timestamp", ""),
            "learnable":         True,
            "created":           created,
        })

    _stats["last_run_at"]      = _now()
    _stats["last_run_learned"] = learned

    return {
        "scanned": scanned,
        "skipped": skipped,
        "learned": learned,
        "failed":  failed,
        "skills":  generated,
    }


# ─── Boucle d'auto-apprentissage ─────────────────────────────────────────────

async def _auto_learn_loop() -> None:
    """Boucle d'apprentissage automatique — cycle 4h, analyse les 20 derniers épisodes."""
    print("[Learner] Boucle auto-learn démarrée (cycle 4h)")
    await asyncio.sleep(60)  # Laisse les autres couches s'initialiser

    while True:
        try:
            print("[Learner] Auto-scan en cours...")
            summary = await _run_batch_learn(limit=20, force=False)
            print(
                f"[Learner] Auto-scan : {summary['learned']} nouveaux skills générés "
                f"(scannés={summary['scanned']}, ignorés={summary['skipped']}, "
                f"échecs={summary['failed']})"
            )
        except asyncio.CancelledError:
            raise
        except Exception as e:
            print(f"[Learner] Erreur boucle auto-learn : {e}")

        await asyncio.sleep(4 * 3600)  # 4 heures


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.post("/learn")
async def learn_one(req: LearnRequest):
    """
    Analyse UN épisode (par ID ou texte de mission) et génère un skill si apprennable.
    Recherche dans les épisodes par mission (comparaison exacte ou partielle).
    """
    if not req.episode_id and not req.mission:
        return {"error": "Fournir episode_id ou mission"}

    episodes = _read_episodes_safe()

    # Recherche de l'épisode
    episode = None
    if req.mission:
        search_text = req.mission.lower()
        for ep in reversed(episodes):  # du plus récent
            if search_text in ep.get("mission", "").lower():
                episode = ep
                break
    elif req.episode_id:
        for ep in episodes:
            if ep.get("timestamp", "") == req.episode_id or ep.get("id", "") == req.episode_id:
                episode = ep
                break

    if not episode:
        return {"error": f"Épisode introuvable (id={req.episode_id}, mission={req.mission})"}

    if not episode.get("success"):
        return {"error": "Épisode non réussi — apprentissage impossible", "episode": episode}

    mission = episode.get("mission", "").strip()
    if _already_learned(mission):
        return {
            "message": "Épisode déjà appris",
            "source_mission": mission,
        }

    # Analyse apprenabilité
    analysis = await _analyze_learnability(episode)
    if analysis is None:
        return {"error": "Échec de l'analyse d'apprenabilité (Brain inaccessible ?)"}

    if not analysis.get("learnable"):
        return {
            "learnable": False,
            "reason":    analysis.get("reason", ""),
            "mission":   mission,
        }

    skill_name = analysis.get("skill_name", "")
    if not skill_name or not re.match(r'^[a-zA-Z0-9_\-]+$', skill_name):
        return {"error": f"Nom de skill généré invalide : '{skill_name}'"}

    # Génération
    gen_result = await _generate_skill_from_episode(episode, analysis)

    created   = gen_result.get("created", False)
    syntax_ok = gen_result.get("syntax_ok", False)
    version   = gen_result.get("version", "1.0.0")

    if created:
        _stats["skills_generated"] += 1
        if not syntax_ok:
            _stats["skills_failed_validation"] += 1
    else:
        _stats["skills_failed_validation"] += 1

    await _append_learned({
        "timestamp":         _now(),
        "skill_name":        skill_name if created else None,
        "source_mission":    mission,
        "goal":              analysis.get("goal", ""),
        "syntax_ok":         syntax_ok if created else None,
        "version":           version if created else None,
        "learnable_reason":  analysis.get("reason", ""),
        "episode_timestamp": episode.get("timestamp", ""),
        "learnable":         True,
        "created":           created,
    })

    _stats["last_run_at"]      = _now()
    _stats["last_run_learned"] = 1 if created else 0

    return {
        "learnable":   True,
        "skill_name":  skill_name,
        "goal":        analysis.get("goal", ""),
        "created":     created,
        "syntax_ok":   syntax_ok,
        "version":     version,
        "reason":      analysis.get("reason", ""),
        "gen_details": gen_result,
    }


@app.post("/learn/batch")
async def learn_batch(req: BatchLearnRequest):
    """
    Scanne les N derniers épisodes réussis, extrait les patterns apprenables
    et génère les skills correspondants via Evolution.
    """
    summary = await _run_batch_learn(limit=req.limit, force=req.force)
    return summary


@app.post("/learn/trigger")
async def trigger_learn(req: TriggerRequest):
    """Déclenchement manuel d'un scan complet (équivalent batch avec limit=50)."""
    print(f"[Learner] Déclenchement manuel — limit={req.limit}")
    summary = await _run_batch_learn(limit=req.limit, force=False)
    return {"triggered": True, **summary}


@app.get("/learned-skills")
async def list_learned_skills(limit: int = 100, only_created: bool = False):
    """Liste tous les skills générés par le Learner (depuis learned_skills.jsonl)."""
    entries = _read_learned_safe()

    if only_created:
        entries = [e for e in entries if e.get("created") is True]

    # Du plus récent au plus ancien
    entries_sorted = sorted(entries, key=lambda e: e.get("timestamp", ""), reverse=True)

    return {
        "skills":      entries_sorted[:limit],
        "total":       len(entries),
        "total_created": sum(1 for e in entries if e.get("created") is True),
    }


@app.get("/learning-stats")
async def learning_stats():
    """
    Statistiques du Learner :
    - épisodes scannés, skills générés, taux de validation, dernier run.
    """
    total_skills  = _stats["skills_generated"]
    total_failed  = _stats["skills_failed_validation"]
    total_attempts = total_skills + total_failed

    validation_rate = (
        round(total_skills / total_attempts, 3)
        if total_attempts > 0
        else 0.0
    )

    return {
        "episodes_scanned_total":    _stats["episodes_scanned_total"],
        "skills_generated":          total_skills,
        "skills_failed_validation":  total_failed,
        "validation_rate":           validation_rate,
        "last_run_at":               _stats["last_run_at"],
        "last_run_learned":          _stats["last_run_learned"],
        "background_task_active":    _stats["background_task_active"],
    }


@app.get("/health")
async def health():
    """État du service Learner."""
    return {
        "status":               "ok",
        "layer":                "learner",
        "port":                 LEARNER_PORT,
        "skills_generated":     _stats["skills_generated"],
        "episodes_file_exists": EPISODES_FILE.exists(),
        "learned_log_exists":   LEARNED_LOG.exists(),
        "brain_url":            BRAIN_URL,
        "evolution_url":        EVOLUTION_URL,
        "memory_url":           MEMORY_URL,
    }


# ─── Entrée principale ────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=LEARNER_PORT)
