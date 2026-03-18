"""
agent/reflexion.py — Couche 18 : Reflexion Engine  (Phase 22)
FastAPI :8018

Moteur de réflexion méta-cognitive de la ruche :
  1. Analyse les épisodes échoués depuis memory-hub (8006) ou data/episodes.jsonl
  2. Appelle brain :8003 /think avec un prompt méta-apprentissage
     « qu'est-ce qui a mal tourné et comment mieux faire ? »
  3. Sauvegarde la réflexion dans data/reflexions.jsonl
  4. Injecte les leçons apprises dans data/reflexion-injections.jsonl
  5. Boucle autonome toutes les 3600s — max 5 réflexions par cycle
"""
from __future__ import annotations

import asyncio
import json
import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

REFLEXION_PORT  = int(os.getenv("REFLEXION_PORT",  "8018"))
BRAIN_URL       = os.getenv("BRAIN_URL",        "http://localhost:8003")
MEMORY_HUB_URL  = os.getenv("MEMORY_HUB_URL",   "http://localhost:8006")

ROOT              = Path(__file__).parent.parent
DATA_DIR          = ROOT / "data"
EPISODES_FILE     = DATA_DIR / "episodes.jsonl"
REFLEXIONS_FILE   = DATA_DIR / "reflexions.jsonl"
INJECTIONS_FILE   = DATA_DIR / "reflexion-injections.jsonl"

# Paramètres du cycle
LOOP_INTERVAL_S       = int(os.getenv("REFLEXION_INTERVAL_S",   "3600"))  # 1h
MAX_REFLEXIONS_CYCLE  = int(os.getenv("REFLEXION_MAX_PER_CYCLE", "5"))
STARTUP_DELAY_S       = 90   # Attendre que brain et memory-hub soient prêts

# Mots-clés indiquant un épisode en échec
FAILURE_KEYWORDS = {"error", "failed", "failure", "échec", "erreur", "exception"}

# ---------------------------------------------------------------------------
# État global
# ---------------------------------------------------------------------------

_reflexion_running: bool = False
_last_cycle_ts: str | None = None
_episodes_processed: int = 0
_improvements_suggested: int = 0
_seen_episode_ids: set[str] = set()   # Évite de re-traiter les mêmes épisodes

# ---------------------------------------------------------------------------
# Helpers JSONL
# ---------------------------------------------------------------------------

def _ensure_data_dir() -> None:
    """Crée le répertoire data/ s'il n'existe pas."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def _read_jsonl(path: Path) -> list[dict]:
    """Lit un fichier JSONL et retourne la liste des entrées. Ignore les lignes invalides."""
    if not path.exists():
        return []
    entries: list[dict] = []
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entries.append(json.loads(line))
                except json.JSONDecodeError:
                    pass  # Ligne corrompue — on l'ignore silencieusement
    except OSError:
        pass
    return entries


def _append_jsonl(path: Path, entry: dict) -> None:
    """Ajoute une entrée JSON à la fin du fichier JSONL."""
    _ensure_data_dir()
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def _get_reflexion_stats() -> dict:
    """Retourne des statistiques rapides sur les fichiers JSONL."""
    reflexions  = _read_jsonl(REFLEXIONS_FILE)
    injections  = _read_jsonl(INJECTIONS_FILE)
    return {
        "episodes_processed":     _episodes_processed,
        "improvements_suggested": _improvements_suggested,
        "reflexions_total":       len(reflexions),
        "injections_total":       len(injections),
        "last_cycle_ts":          _last_cycle_ts,
        "loop_running":           _reflexion_running,
    }

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class ReflectRequest(BaseModel):
    episode_id: str
    result:     str = ""
    error:      str = ""


class ReflectResponse(BaseModel):
    reflexion_id: str
    episode_id:   str
    lesson:       str
    suggestions:  list[str]
    ts:           str


class InjectRequest(BaseModel):
    lesson:       str
    target_skill: str = ""


class InjectResponse(BaseModel):
    injection_id: str
    lesson:       str
    target_skill: str
    ts:           str

# ---------------------------------------------------------------------------
# Helpers async — appels HTTP
# ---------------------------------------------------------------------------

async def _fetch_episode_from_hub(episode_id: str) -> dict | None:
    """Tente de récupérer un épisode depuis memory-hub :8006."""
    try:
        async with httpx.AsyncClient(timeout=8) as c:
            r = await c.get(f"{MEMORY_HUB_URL}/episodes/{episode_id}")
            if r.status_code == 200:
                return r.json()
    except Exception:
        pass
    return None


def _fetch_episode_from_file(episode_id: str) -> dict | None:
    """Cherche un épisode par id dans data/episodes.jsonl."""
    for ep in _read_jsonl(EPISODES_FILE):
        if ep.get("id") == episode_id or ep.get("episode_id") == episode_id:
            return ep
    return None


async def _load_episode(episode_id: str) -> dict | None:
    """
    Charge un épisode en tentant memory-hub d'abord,
    puis le fichier local en fallback.
    """
    ep = await _fetch_episode_from_hub(episode_id)
    if ep:
        return ep
    return _fetch_episode_from_file(episode_id)


async def _call_brain_think(prompt: str) -> str:
    """
    Appelle brain :8003 /think avec le prompt méta-apprentissage.
    Retourne le texte de réponse ou un message d'erreur générique.
    """
    try:
        async with httpx.AsyncClient(timeout=60) as c:
            r = await c.post(
                f"{BRAIN_URL}/think",
                json={"prompt": prompt, "max_tokens": 512},
            )
            r.raise_for_status()
            data = r.json()
            # Brain peut retourner {"response":...} ou {"text":...} ou {"result":...}
            return (
                data.get("response")
                or data.get("text")
                or data.get("result")
                or json.dumps(data)
            )
    except httpx.HTTPStatusError as e:
        return f"[brain_error] HTTP {e.response.status_code}: {e.response.text[:200]}"
    except Exception as e:
        return f"[brain_error] {e}"


def _extract_suggestions(brain_response: str) -> list[str]:
    """
    Extrait une liste de suggestions actionables depuis la réponse du brain.
    Cherche des lignes commençant par un tiret, numéro ou bullet.
    """
    suggestions: list[str] = []
    for line in brain_response.splitlines():
        line = line.strip()
        # Lignes de type "- suggestion" / "1. suggestion" / "• suggestion"
        if line and (
            line.startswith("-") or
            line.startswith("•") or
            (len(line) > 2 and line[0].isdigit() and line[1] in ".)")
        ):
            # Nettoyer le préfixe
            cleaned = line.lstrip("-•0123456789.)").strip()
            if cleaned:
                suggestions.append(cleaned)
    # Si aucune liste détectée, retourner la réponse entière comme suggestion unique
    if not suggestions and brain_response and not brain_response.startswith("[brain_error]"):
        suggestions = [brain_response[:300]]
    return suggestions[:10]   # Limiter à 10 suggestions

# ---------------------------------------------------------------------------
# Cœur : analyse d'un épisode échoué
# ---------------------------------------------------------------------------

async def _analyze_episode(
    episode_id: str,
    result: str,
    error: str,
    episode_data: dict | None = None,
) -> ReflectResponse:
    """
    Analyse un épisode échoué via brain et produit une réflexion.
    Sauvegarde le résultat dans data/reflexions.jsonl.
    """
    global _episodes_processed, _improvements_suggested

    # Construire le contexte de l'épisode
    ep_text = ""
    if episode_data:
        ep_text = (
            f"Texte/commande : {episode_data.get('text') or episode_data.get('command', 'inconnu')}\n"
            f"Source         : {episode_data.get('source', 'inconnu')}\n"
            f"Tags           : {', '.join(episode_data.get('tags', []))}\n"
        )

    if result:
        ep_text += f"Résultat obtenu : {result[:500]}\n"
    if error:
        ep_text += f"Erreur rencontrée : {error[:500]}\n"

    # Prompt méta-apprentissage
    meta_prompt = (
        "Tu es le moteur de réflexion de Ghost OS Ultimate, un agent IA autonome. "
        "Analyse l'épisode échoué suivant et réponds en français :\n\n"
        f"=== ÉPISODE ÉCHOUÉ : {episode_id} ===\n"
        f"{ep_text}\n"
        "=== FIN ÉPISODE ===\n\n"
        "Questions clés :\n"
        "1. Qu'est-ce qui a mal tourné exactement ?\n"
        "2. Quelle est la cause racine probable ?\n"
        "3. Comment éviter cette erreur à l'avenir ?\n"
        "4. Quelles améliorations de skill ou de stratégie suggères-tu ?\n\n"
        "Formule ta réponse avec une leçon principale claire, "
        "puis une liste d'améliorations concrètes (tirets)."
    )

    brain_response = await _call_brain_think(meta_prompt)

    # Extraire la leçon principale (première ligne non vide)
    lesson_lines = [l.strip() for l in brain_response.splitlines() if l.strip()]
    lesson = lesson_lines[0] if lesson_lines else "Aucune leçon extraite"
    # Tronquer si trop long
    if len(lesson) > 300:
        lesson = lesson[:297] + "..."

    suggestions = _extract_suggestions(brain_response)

    # Construire l'entrée de réflexion
    reflexion_id = f"rfx_{uuid.uuid4().hex[:8]}"
    ts           = datetime.now(timezone.utc).isoformat()

    reflexion_entry = {
        "reflexion_id":  reflexion_id,
        "episode_id":    episode_id,
        "ts":            ts,
        "lesson":        lesson,
        "suggestions":   suggestions,
        "full_analysis": brain_response[:2000],   # Limiter la taille stockée
        "result":        result[:200] if result else "",
        "error":         error[:200]  if error  else "",
    }

    _append_jsonl(REFLEXIONS_FILE, reflexion_entry)

    _episodes_processed  += 1
    _improvements_suggested += len(suggestions)

    print(
        f"[Reflexion] Réflexion {reflexion_id} — épisode {episode_id} — "
        f"{len(suggestions)} suggestion(s)"
    )

    return ReflectResponse(
        reflexion_id=reflexion_id,
        episode_id=episode_id,
        lesson=lesson,
        suggestions=suggestions,
        ts=ts,
    )

# ---------------------------------------------------------------------------
# Boucle autonome
# ---------------------------------------------------------------------------

def _is_failed_episode(ep: dict) -> bool:
    """Détermine si un épisode est en échec (résultat ou champ error)."""
    result = str(ep.get("result", "")).lower()
    error  = str(ep.get("error", "")).lower()
    status = str(ep.get("status", "")).lower()
    return any(
        kw in text
        for kw in FAILURE_KEYWORDS
        for text in (result, error, status)
    )


async def _run_reflexion_cycle() -> None:
    """
    Cycle complet de réflexion autonome :
      1. Lit data/episodes.jsonl
      2. Filtre les épisodes en échec non encore traités
      3. Pour chaque épisode (max MAX_REFLEXIONS_CYCLE), appelle /reflect
    """
    global _reflexion_running, _last_cycle_ts

    if _reflexion_running:
        print("[Reflexion] Cycle déjà en cours — skip")
        return

    _reflexion_running = True
    _last_cycle_ts     = datetime.now(timezone.utc).isoformat()

    print(f"[Reflexion] Cycle démarré — {_last_cycle_ts}")

    try:
        episodes = _read_jsonl(EPISODES_FILE)

        # Filtrer les épisodes en échec non encore traités
        new_failures = [
            ep for ep in episodes
            if _is_failed_episode(ep)
            and (ep.get("id") or ep.get("episode_id", "")) not in _seen_episode_ids
        ]

        # Limiter à MAX_REFLEXIONS_CYCLE par cycle
        to_process = new_failures[:MAX_REFLEXIONS_CYCLE]

        if not to_process:
            print("[Reflexion] Aucun nouvel épisode en échec — idle")
            return

        print(f"[Reflexion] {len(to_process)} épisode(s) en échec à analyser")

        for ep in to_process:
            ep_id = ep.get("id") or ep.get("episode_id") or f"unknown_{uuid.uuid4().hex[:6]}"
            _seen_episode_ids.add(ep_id)

            try:
                await _analyze_episode(
                    episode_id=ep_id,
                    result=str(ep.get("result", "")),
                    error=str(ep.get("error", "")),
                    episode_data=ep,
                )
            except Exception as e:
                print(f"[Reflexion] Erreur analyse épisode {ep_id}: {e}")

    except Exception as e:
        print(f"[Reflexion] Erreur cycle: {e}")

    finally:
        _reflexion_running = False
        print(f"[Reflexion] Cycle terminé — traités={_episodes_processed}")


async def _reflexion_loop() -> None:
    """Boucle périodique — un cycle toutes les LOOP_INTERVAL_S secondes."""
    await asyncio.sleep(STARTUP_DELAY_S)
    while True:
        try:
            await _run_reflexion_cycle()
        except Exception as e:
            print(f"[Reflexion] Boucle erreur: {e}")
        await asyncio.sleep(LOOP_INTERVAL_S)

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    _ensure_data_dir()
    # Précharger les ids d'épisodes déjà traités depuis le fichier de réflexions
    for rfx in _read_jsonl(REFLEXIONS_FILE):
        ep_id = rfx.get("episode_id")
        if ep_id:
            _seen_episode_ids.add(ep_id)
    print(f"  {len(_seen_episode_ids)} épisode(s) déjà traités — chargés depuis {REFLEXIONS_FILE.name}")

    asyncio.create_task(_reflexion_loop())

    print(f"🧠 Ghost OS Ultimate — Reflexion Engine actif — port {REFLEXION_PORT}")
    print(f"  Cycle         : {LOOP_INTERVAL_S // 60}min (startup +{STARTUP_DELAY_S}s)")
    print(f"  Max/cycle     : {MAX_REFLEXIONS_CYCLE} réflexions")
    print(f"  Brain         : {BRAIN_URL}")
    print(f"  Memory Hub    : {MEMORY_HUB_URL}")
    print(f"  Réflexions    : {REFLEXIONS_FILE}")
    print(f"  Injections    : {INJECTIONS_FILE}")
    yield


app = FastAPI(
    title="Ghost OS — Reflexion Engine",
    description="Phase 22 : Méta-apprentissage — analyse d'épisodes échoués → leçons → injections",
    version="1.0.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)

# ── Routes ──────────────────────────────────────────────────────────────────

@app.get("/")
async def root():
    return {"layer": "reflexion", "port": REFLEXION_PORT, "phase": 22}


@app.get("/health")
async def health():
    return {"status": "ok", "layer": "reflexion", "port": 8018}


@app.get("/status")
async def get_status():
    """État courant du moteur de réflexion."""
    return {
        "running":          _reflexion_running,
        "last_cycle_ts":    _last_cycle_ts,
        "seen_episodes":    len(_seen_episode_ids),
        "loop_interval_s":  LOOP_INTERVAL_S,
        "max_per_cycle":    MAX_REFLEXIONS_CYCLE,
        "brain_url":        BRAIN_URL,
        "memory_hub_url":   MEMORY_HUB_URL,
    }


@app.get("/stats")
async def get_stats():
    """Statistiques globales du moteur de réflexion."""
    return _get_reflexion_stats()


@app.get("/reflexions")
async def list_reflexions(limit: int = Query(20, ge=1, le=200)):
    """Retourne les dernières réflexions enregistrées (ordre antéchronologique)."""
    all_rfx = _read_jsonl(REFLEXIONS_FILE)
    # Retourner les plus récentes en premier
    recent = list(reversed(all_rfx))[:limit]
    return {"reflexions": recent, "total": len(all_rfx)}


@app.get("/injections")
async def list_injections():
    """Retourne toutes les leçons injectées."""
    all_inj = _read_jsonl(INJECTIONS_FILE)
    return {"injections": all_inj, "total": len(all_inj)}


@app.post("/reflect", response_model=ReflectResponse)
async def reflect(req: ReflectRequest):
    """
    Analyse un épisode échoué et extrait une leçon via le brain.

    - Charge l'épisode depuis memory-hub ou data/episodes.jsonl
    - Appelle brain :8003 /think avec un prompt méta-apprentissage
    - Sauvegarde la réflexion dans data/reflexions.jsonl
    """
    # Valider que l'épisode a bien échoué (result ou error non vide)
    if not req.result and not req.error:
        raise HTTPException(
            status_code=422,
            detail="Au moins 'result' ou 'error' doit être renseigné pour analyser l'échec",
        )

    # Charger les données complètes de l'épisode si disponibles
    episode_data = await _load_episode(req.episode_id)

    # Analyser et sauvegarder la réflexion
    reflexion = await _analyze_episode(
        episode_id=req.episode_id,
        result=req.result,
        error=req.error,
        episode_data=episode_data,
    )

    # Marquer l'épisode comme traité pour éviter la redondance dans la boucle auto
    _seen_episode_ids.add(req.episode_id)

    return reflexion


@app.post("/inject", response_model=InjectResponse)
async def inject(req: InjectRequest):
    """
    Injecte une leçon apprise dans data/reflexion-injections.jsonl.

    La leçon sera prise en compte lors des prochaines exécutions de skills.
    """
    if not req.lesson.strip():
        raise HTTPException(status_code=422, detail="La leçon ne peut pas être vide")

    injection_id = f"inj_{uuid.uuid4().hex[:8]}"
    ts           = datetime.now(timezone.utc).isoformat()

    injection_entry = {
        "injection_id": injection_id,
        "lesson":       req.lesson,
        "target_skill": req.target_skill,
        "ts":           ts,
    }

    _append_jsonl(INJECTIONS_FILE, injection_entry)

    print(
        f"[Reflexion] Injection {injection_id} — skill={req.target_skill or 'global'} — "
        f"{req.lesson[:80]}..."
    )

    return InjectResponse(
        injection_id=injection_id,
        lesson=req.lesson,
        target_skill=req.target_skill,
        ts=ts,
    )


@app.post("/trigger")
async def trigger_cycle():
    """Déclenche manuellement un cycle de réflexion."""
    if _reflexion_running:
        raise HTTPException(
            status_code=409,
            detail="Un cycle de réflexion est déjà en cours — veuillez patienter",
        )
    asyncio.create_task(_run_reflexion_cycle())
    return {"message": "Cycle de réflexion déclenché", "interval_s": LOOP_INTERVAL_S}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("agent.reflexion:app", host="0.0.0.0", port=REFLEXION_PORT, reload=False)
