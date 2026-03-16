"""
Couche planification HTN — port 8008
Décompose les missions complexes en réseaux de tâches hiérarchiques (HTN)
AVANT que la boucle ReAct ne s'exécute dans Brain.

Architecture :
  - POST /plan          → décomposition LLM → arbre HTN
  - POST /plan/execute  → exécution pas-à-pas (appels Brain /react par sous-tâche)
  - GET  /plans         → liste des plans en cache (plans.jsonl)
  - GET  /plan/{id}     → détails d'un plan
  - GET  /plan/{id}/status → statut d'exécution
  - POST /plan/replan   → re-planification sur échec partiel
  - POST /plan/search   → recherche sémantique dans les plans passés (via Memory)
  - GET  /health        → état du service
"""

import os
import json
import time
import asyncio
import hashlib
import re
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from contextlib import asynccontextmanager

# ─── Configuration ──────────────────────────────────────────────────────────

PLANNER_PORT    = int(os.getenv("PLANNER_PORT", "8008"))
BRAIN_URL       = os.getenv("BRAIN_URL",  "http://localhost:8003")
MEMORY_URL      = os.getenv("MEMORY_URL", "http://localhost:8006")
SKILLS_REGISTRY = Path(__file__).parent.parent / "skills" / "registry.json"
PLANS_FILE      = Path(__file__).parent / "plans.jsonl"
PLANS_LOCK      = asyncio.Lock()

# Seuils de correspondance
CACHE_SIMILARITY_THRESHOLD = 0.85
SKILL_MATCH_THRESHOLD      = 0.60

# ─── State global ───────────────────────────────────────────────────────────

_skills: list[dict] = []          # entrées du registry chargées au démarrage
_plans_index: dict[str, dict] = {}  # id → plan (cache mémoire)


# ─── Lifespan ────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Chargement du registre de skills + initialisation du fichier plans au démarrage."""
    global _skills, _plans_index

    # Charge le registre de skills
    if SKILLS_REGISTRY.exists():
        try:
            data = json.loads(SKILLS_REGISTRY.read_text(encoding="utf-8"))
            _skills = data.get("skills", [])
            print(f"[Planner] {len(_skills)} skills chargés depuis {SKILLS_REGISTRY.name}")
        except Exception as e:
            print(f"[Planner] ⚠️  Impossible de charger registry.json : {e}")
            _skills = []
    else:
        print(f"[Planner] ⚠️  registry.json introuvable à {SKILLS_REGISTRY}")

    # Initialise le fichier de plans
    PLANS_FILE.parent.mkdir(parents=True, exist_ok=True)
    if not PLANS_FILE.exists():
        PLANS_FILE.write_text("", encoding="utf-8")

    # Charge les plans existants en mémoire
    _plans_index = {p["id"]: p for p in _read_plans_safe()}
    print(f"[Planner] {len(_plans_index)} plans chargés depuis {PLANS_FILE.name}")

    yield

    print("[Planner] Arrêt propre.")


# ─── App FastAPI ─────────────────────────────────────────────────────────────

app = FastAPI(title="Ghost OS Planner", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Modèles Pydantic ────────────────────────────────────────────────────────

class PlanRequest(BaseModel):
    mission: str
    context: str = ""
    priority: int = 3
    force_replan: bool = False

class ExecuteRequest(BaseModel):
    plan_id: str
    dry_run: bool = False

class ReplanRequest(BaseModel):
    plan_id: str
    failed_task_id: str
    error: str = ""

class SearchRequest(BaseModel):
    query: str
    limit: int = 5


# ─── Helpers JSONL ───────────────────────────────────────────────────────────

def _read_plans_safe() -> list[dict]:
    """Lit plans.jsonl en ignorant les lignes corrompues."""
    plans = []
    if not PLANS_FILE.exists():
        return plans
    for line in PLANS_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            plans.append(json.loads(line))
        except json.JSONDecodeError as e:
            print(f"[Planner] Ligne corrompue ignorée : {e} — {line[:80]}")
    return plans


async def _append_plan(plan: dict) -> None:
    """Ajoute ou met à jour un plan dans le JSONL (append-only) + index mémoire."""
    global _plans_index
    _plans_index[plan["id"]] = plan
    async with PLANS_LOCK:
        with open(PLANS_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(plan, ensure_ascii=False) + "\n")


async def _update_plan(plan: dict) -> None:
    """Met à jour un plan existant dans le JSONL (réécrit le fichier) + index mémoire."""
    global _plans_index
    plan["updated_at"] = _now()
    _plans_index[plan["id"]] = plan
    async with PLANS_LOCK:
        all_plans = _read_plans_safe()
        # Remplace le plan existant par son id, ou l'ajoute s'il est absent
        updated = False
        new_lines = []
        for p in all_plans:
            if p["id"] == plan["id"]:
                new_lines.append(json.dumps(plan, ensure_ascii=False))
                updated = True
            else:
                new_lines.append(json.dumps(p, ensure_ascii=False))
        if not updated:
            new_lines.append(json.dumps(plan, ensure_ascii=False))
        PLANS_FILE.write_text("\n".join(new_lines) + "\n", encoding="utf-8")


# ─── Utilitaires ─────────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _plan_id(mission: str) -> str:
    """ID déterministe basé sur le texte normalisé de la mission."""
    normalized = _normalize_mission(mission)
    return "plan_" + hashlib.sha256(normalized.encode()).hexdigest()[:8]


def _normalize_mission(mission: str) -> str:
    """Normalise la mission pour la comparaison : minuscules, sans ponctuation."""
    return re.sub(r"[^\w\s]", "", mission.lower()).strip()


def _trigram_similarity(a: str, b: str) -> float:
    """Similarité trigramme entre deux chaînes normalisées."""
    def trigrams(s: str) -> set:
        s = f"  {s}  "
        return {s[i:i+3] for i in range(len(s) - 2)}

    ta, tb = trigrams(a), trigrams(b)
    if not ta and not tb:
        return 1.0
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def _find_cached_plan(mission: str) -> Optional[dict]:
    """Cherche un plan similaire dans le cache (similarité trigramme > seuil)."""
    norm = _normalize_mission(mission)
    best_plan = None
    best_score = 0.0
    for plan in _plans_index.values():
        score = _trigram_similarity(norm, _normalize_mission(plan["mission"]))
        if score > best_score:
            best_score = score
            best_plan = plan
    if best_score >= CACHE_SIMILARITY_THRESHOLD:
        print(f"[Planner] Cache hit (score={best_score:.2f}) pour : {mission[:60]}")
        return best_plan
    return None


def _match_skill(description: str) -> Optional[str]:
    """Associe une description de sous-tâche au skill le plus proche (trigramme)."""
    if not _skills:
        return None
    best_name = None
    best_score = 0.0
    desc_norm = _normalize_mission(description)
    for skill in _skills:
        skill_text = f"{skill['name']} {skill.get('description', '')}"
        score = _trigram_similarity(desc_norm, _normalize_mission(skill_text))
        if score > best_score:
            best_score = score
            best_name = skill["name"]
    if best_score >= SKILL_MATCH_THRESHOLD:
        return best_name
    return None


def _enrich_subtasks(subtasks: list[dict]) -> list[dict]:
    """Enrichit les sous-tâches avec le skill correspondant et les champs d'exécution."""
    enriched = []
    for task in subtasks:
        task.setdefault("skill", _match_skill(task.get("description", "")))
        task.setdefault("status", "pending")
        task.setdefault("result", None)
        task.setdefault("duration_ms", None)
        task.setdefault("type", "atomic")
        task.setdefault("preconditions", [])
        task.setdefault("postconditions", [])
        # Récursion pour les sous-tâches composites
        if task.get("subtasks"):
            task["subtasks"] = _enrich_subtasks(task["subtasks"])
        else:
            task["subtasks"] = []
        enriched.append(task)
    return enriched


def _build_plan(mission: str, llm_result: dict, source: str = "llm") -> dict:
    """Construit la structure de plan complète à partir de la réponse LLM."""
    subtasks = _enrich_subtasks(llm_result.get("subtasks", []))
    plan_id = _plan_id(mission)
    now = _now()
    return {
        "id":               plan_id,
        "mission":          mission,
        "goal":             llm_result.get("goal", mission),
        "complexity":       llm_result.get("complexity", "moderate"),
        "subtasks":         subtasks,
        "status":           "pending",
        "created_at":       now,
        "updated_at":       now,
        "execution_time_ms": None,
        "replan_count":     0,
        "source":           source,
    }


def _count_subtasks(subtasks: list[dict]) -> int:
    """Compte récursivement toutes les sous-tâches atomiques."""
    total = 0
    for t in subtasks:
        total += 1
        total += _count_subtasks(t.get("subtasks", []))
    return total


def _flatten_atomic(subtasks: list[dict]) -> list[dict]:
    """Retourne la liste à plat des tâches atomiques (parcours DFS)."""
    result = []
    for t in subtasks:
        if t.get("subtasks"):
            result.extend(_flatten_atomic(t["subtasks"]))
        else:
            result.append(t)
    return result


def _skills_used_in_plan(subtasks: list[dict]) -> list[str]:
    """Collecte tous les skills utilisés dans le plan."""
    skills = []
    for t in subtasks:
        if t.get("skill"):
            skills.append(t["skill"])
        skills.extend(_skills_used_in_plan(t.get("subtasks", [])))
    return list(set(skills))


# ─── LLM — Décomposition HTN ─────────────────────────────────────────────────

DECOMPOSE_PROMPT_TEMPLATE = """Tu es un planificateur de tâches pour un agent IA autonome. Décompose cette mission en réseau de tâches hiérarchique (HTN).

MISSION : {mission}

SKILLS DISPONIBLES : {skill_names}

Retourne un objet JSON valide (sans markdown) :
{{
  "goal": "énoncé clair de l'objectif",
  "complexity": "simple|moderate|complex",
  "subtasks": [
    {{
      "id": "t1",
      "description": "action atomique précise",
      "type": "atomic",
      "skill": "nom_du_skill_si_applicable_ou_null",
      "preconditions": ["ce qui doit être vrai avant"],
      "postconditions": ["ce qui sera vrai après"]
    }}
  ]
}}

RÈGLES :
- simple   = 1-2 étapes (retourne tel quel, pas de décomposition)
- moderate = 3-5 étapes
- complex  = 6+ étapes
- Les tâches atomiques doivent pouvoir être exécutées par un skill OU par un appel Brain /react
- Les tâches composites contiennent des subtasks imbriquées
- Utilise les skills existants quand c'est applicable
- Profondeur maximale : 3 niveaux
- Largeur maximale : 7 sous-tâches par niveau"""


async def _llm_decompose(mission: str, context: str = "") -> dict:
    """Appelle Brain /raw pour décomposer une mission en plan HTN JSON."""
    skill_names = ", ".join(s["name"] for s in _skills) if _skills else "(aucun skill disponible)"
    prompt = DECOMPOSE_PROMPT_TEMPLATE.format(mission=mission, skill_names=skill_names)
    if context:
        prompt = f"CONTEXTE : {context}\n\n{prompt}"

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{BRAIN_URL}/raw",
                json={"prompt": prompt, "system": "Tu es un planificateur JSON. Réponds uniquement avec du JSON valide, sans markdown ni explication."},
            )
            resp.raise_for_status()
            raw_text = resp.json().get("response", "")

        # Extrait le JSON de la réponse (Brain peut entourer de markdown)
        json_match = re.search(r"\{[\s\S]+\}", raw_text)
        if not json_match:
            raise ValueError(f"Pas de JSON dans la réponse LLM : {raw_text[:200]}")
        return json.loads(json_match.group(0))

    except Exception as e:
        print(f"[Planner] ⚠️  Erreur LLM decompose : {e}")
        # Fallback : plan minimal avec la mission comme tâche unique
        return {
            "goal": mission,
            "complexity": "simple",
            "subtasks": [{
                "id": "t1",
                "description": mission,
                "type": "atomic",
                "skill": _match_skill(mission),
                "preconditions": [],
                "postconditions": ["mission exécutée"],
            }],
        }


# ─── Exécution du plan ────────────────────────────────────────────────────────

async def _execute_task(task: dict, context_summary: str, dry_run: bool = False) -> dict:
    """Exécute une sous-tâche atomique via Brain."""
    task["status"] = "running"
    start_ms = int(time.time() * 1000)

    if dry_run:
        await asyncio.sleep(0.1)
        task["status"] = "done"
        task["result"] = f"[dry_run] {task['description']}"
        task["duration_ms"] = int(time.time() * 1000) - start_ms
        return task

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            if task.get("skill"):
                # Exécute via Brain /brain (appel de skill via evolution layer)
                resp = await client.post(
                    f"{BRAIN_URL}/brain",
                    json={"skill": task["skill"], "params": {"task": task["description"], "context": context_summary}},
                )
            else:
                # Exécute via Brain /react (boucle ReAct)
                mission_with_context = task["description"]
                if context_summary:
                    mission_with_context = f"{task['description']}\n\nContexte des tâches précédentes : {context_summary}"
                resp = await client.post(
                    f"{BRAIN_URL}/react",
                    json={"mission": mission_with_context},
                )
            resp.raise_for_status()
            data = resp.json()

        task["result"] = data.get("result") or data.get("response") or str(data)
        task["status"] = "done"
    except Exception as e:
        print(f"[Planner] ⚠️  Tâche {task['id']} échouée : {e}")
        task["status"] = "failed"
        task["result"] = str(e)

    task["duration_ms"] = int(time.time() * 1000) - start_ms
    return task


async def _run_plan_execution(plan: dict, dry_run: bool = False) -> None:
    """Exécute un plan en arrière-plan, tâche par tâche."""
    global _plans_index

    plan["status"] = "executing"
    await _update_plan(plan)

    start_ms = int(time.time() * 1000)
    atomic_tasks = _flatten_atomic(plan["subtasks"])
    failure_count = 0
    context_parts: list[str] = []

    for task in atomic_tasks:
        context_summary = " | ".join(context_parts[-3:])  # 3 derniers résultats comme contexte
        task = await _execute_task(task, context_summary, dry_run=dry_run)
        await _update_plan(plan)  # Sauvegarde après chaque tâche

        if task["status"] == "done" and task.get("result"):
            context_parts.append(f"{task['id']}: {str(task['result'])[:150]}")
        elif task["status"] == "failed":
            failure_count += 1
            if failure_count > 2:
                print(f"[Planner] Plus de 2 échecs — arrêt de l'exécution du plan {plan['id']}")
                plan["status"] = "failed"
                break

    plan["execution_time_ms"] = int(time.time() * 1000) - start_ms

    if plan["status"] != "failed":
        all_done = all(t["status"] == "done" for t in atomic_tasks)
        plan["status"] = "done" if all_done else "failed"

    await _update_plan(plan)

    # Envoie un épisode à Memory
    await _save_episode(plan)


async def _save_episode(plan: dict) -> None:
    """Enregistre le résultat du plan comme épisode dans Memory."""
    atomic_tasks = _flatten_atomic(plan["subtasks"])
    total = len(atomic_tasks)
    done_count = sum(1 for t in atomic_tasks if t["status"] == "done")
    success_rate = round(done_count / total * 100) if total else 0
    skills_used = _skills_used_in_plan(plan["subtasks"])

    episode = {
        "mission":    plan["mission"],
        "result":     f"Plan {plan['id']} terminé avec {done_count}/{total} tâches réussies.",
        "learned":    f"Plan décomposé en {total} tâches. Skills utilisés : {', '.join(skills_used) or 'aucun'}. Taux de succès : {success_rate}%.",
        "success":    plan["status"] == "done",
        "model":      "planner-v1",
        "model_used": "planner-v1",
        "duration_ms": plan.get("execution_time_ms") or 0,
        "loop_type":  "plan",
        "skills_used": skills_used,
        "machine_id": "",
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(f"{MEMORY_URL}/episode", json=episode)
            print(f"[Planner] Épisode sauvegardé dans Memory pour plan {plan['id']}")
    except Exception as e:
        print(f"[Planner] ⚠️  Impossible de sauvegarder l'épisode : {e}")


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.post("/plan")
async def create_plan(req: PlanRequest, background_tasks: BackgroundTasks):
    """Décompose une mission en plan HTN via LLM, avec vérification du cache."""
    if not req.force_replan:
        cached = _find_cached_plan(req.mission)
        if cached:
            # Clone le plan pour ne pas modifier le cache
            cloned = dict(cached)
            cloned["source"] = "cache"
            cloned["id"] = _plan_id(req.mission + _now())  # ID unique pour cette instance
            cloned["created_at"] = _now()
            cloned["updated_at"] = _now()
            cloned["status"] = "pending"
            # Réinitialise les statuts des tâches
            def reset_tasks(tasks):
                for t in tasks:
                    t["status"] = "pending"
                    t["result"] = None
                    t["duration_ms"] = None
                    reset_tasks(t.get("subtasks", []))
            import copy
            cloned["subtasks"] = copy.deepcopy(cached["subtasks"])
            reset_tasks(cloned["subtasks"])
            background_tasks.add_task(_append_plan, cloned)
            return {"plan_id": cloned["id"], "source": "cache", "plan": cloned}

    # Décomposition LLM
    llm_result = await _llm_decompose(req.mission, req.context)
    plan = _build_plan(req.mission, llm_result, source="llm")
    background_tasks.add_task(_append_plan, plan)
    print(f"[Planner] Plan créé : {plan['id']} | complexité={plan['complexity']} | {len(plan['subtasks'])} sous-tâches")
    return {"plan_id": plan["id"], "source": "llm", "plan": plan}


@app.post("/plan/execute")
async def execute_plan(req: ExecuteRequest, background_tasks: BackgroundTasks):
    """Lance l'exécution d'un plan en arrière-plan. Retourne immédiatement le plan_id."""
    plan = _plans_index.get(req.plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail=f"Plan {req.plan_id} introuvable")
    if plan["status"] == "executing":
        return {"message": "Plan déjà en cours d'exécution", "plan_id": req.plan_id}
    if plan["status"] in ("done",) and not req.dry_run:
        return {"message": "Plan déjà terminé", "plan_id": req.plan_id, "status": plan["status"]}

    # Exécution en arrière-plan
    background_tasks.add_task(_run_plan_execution, plan, req.dry_run)
    return {"message": "Exécution lancée", "plan_id": req.plan_id, "dry_run": req.dry_run}


@app.post("/plan/replan")
async def replan(req: ReplanRequest, background_tasks: BackgroundTasks):
    """Re-planifie une sous-tâche échouée en demandant au LLM une approche alternative."""
    plan = _plans_index.get(req.plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail=f"Plan {req.plan_id} introuvable")

    # Trouve la tâche échouée
    atomic_tasks = _flatten_atomic(plan["subtasks"])
    failed_task = next((t for t in atomic_tasks if t["id"] == req.failed_task_id), None)
    if not failed_task:
        raise HTTPException(status_code=404, detail=f"Tâche {req.failed_task_id} introuvable dans le plan")

    # Contexte des tâches réussies
    done_tasks = [t for t in atomic_tasks if t["status"] == "done"]
    done_summary = " | ".join(f"{t['id']}: {str(t.get('result',''))[:100]}" for t in done_tasks)

    replan_prompt = (
        f"Une tâche a échoué dans un plan d'exécution.\n\n"
        f"TÂCHE ÉCHOUÉE : {failed_task['description']}\n"
        f"ERREUR : {req.error}\n"
        f"TÂCHES RÉUSSIES : {done_summary or 'aucune'}\n\n"
        f"Propose une approche alternative pour accomplir la tâche échouée. "
        f"Retourne UN objet JSON avec les champs : "
        f'{{ "description": "nouvelle description", "type": "atomic", '
        f'"skill": "skill_ou_null", "preconditions": [], "postconditions": [] }}'
    )

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{BRAIN_URL}/raw",
                json={"prompt": replan_prompt, "system": "Tu es un planificateur JSON. Réponds uniquement avec du JSON valide."},
            )
            resp.raise_for_status()
            raw_text = resp.json().get("response", "")
        json_match = re.search(r"\{[\s\S]+\}", raw_text)
        if json_match:
            alternative = json.loads(json_match.group(0))
        else:
            raise ValueError("Pas de JSON dans la réponse de re-planification")
    except Exception as e:
        print(f"[Planner] ⚠️  Erreur re-planification : {e}")
        alternative = {
            "description": f"[replan] {failed_task['description']}",
            "type": "atomic",
            "skill": None,
            "preconditions": [],
            "postconditions": [],
        }

    # Remplace la tâche échouée par l'alternative
    alternative["id"] = failed_task["id"] + "_r"
    alternative["status"] = "pending"
    alternative["result"] = None
    alternative["duration_ms"] = None
    alternative.setdefault("skill", _match_skill(alternative.get("description", "")))
    alternative.setdefault("subtasks", [])

    def replace_task(tasks, old_id, new_task):
        for i, t in enumerate(tasks):
            if t["id"] == old_id:
                tasks[i] = new_task
                return True
            if replace_task(t.get("subtasks", []), old_id, new_task):
                return True
        return False

    replace_task(plan["subtasks"], req.failed_task_id, alternative)
    plan["replan_count"] = plan.get("replan_count", 0) + 1
    plan["status"] = "replanning"
    await _update_plan(plan)

    # Enregistre l'événement de re-planification dans Memory
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(f"{MEMORY_URL}/episode", json={
                "mission":    f"[replan] {plan['mission']}",
                "result":     f"Re-planification de la tâche {req.failed_task_id} : {req.error[:200]}",
                "learned":    f"Alternative générée : {alternative['description'][:200]}",
                "success":    True,
                "model_used": "planner-v1",
                "duration_ms": 0,
                "skills_used": [],
                "machine_id": "",
            })
    except Exception as e:
        print(f"[Planner] ⚠️  Épisode replan non sauvegardé : {e}")

    print(f"[Planner] Re-planification #{plan['replan_count']} pour plan {plan['id']}, tâche {req.failed_task_id}")
    return {
        "plan_id":       plan["id"],
        "replan_count":  plan["replan_count"],
        "replaced_task": req.failed_task_id,
        "new_task":      alternative,
    }


@app.post("/plan/search")
async def search_plans(req: SearchRequest):
    """Recherche sémantique dans les plans passés via la couche Memory."""
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{MEMORY_URL}/search",
                json={"keywords": req.query.split(), "machine_id": ""},
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:
        print(f"[Planner] ⚠️  Erreur recherche Memory : {e}")
        # Fallback : recherche locale par mots-clés dans les plans
        keywords = req.query.lower().split()
        local_results = []
        for plan in list(_plans_index.values())[-50:]:
            plan_text = (plan["mission"] + plan.get("goal", "")).lower()
            if any(kw in plan_text for kw in keywords):
                local_results.append({"plan_id": plan["id"], "mission": plan["mission"], "status": plan["status"]})
        return {"results": local_results[:req.limit], "source": "local_fallback"}

    results = data.get("results", [])[:req.limit]
    return {"results": results, "source": data.get("method", "memory"), "total": len(results)}


@app.get("/plans")
async def list_plans(limit: int = 20, status: Optional[str] = None):
    """Liste les plans en cache, du plus récent au plus ancien."""
    plans = list(_plans_index.values())
    if status:
        plans = [p for p in plans if p.get("status") == status]
    # Tri par date de création décroissante
    plans.sort(key=lambda p: p.get("created_at", ""), reverse=True)
    return {
        "plans":       plans[:limit],
        "total":       len(_plans_index),
        "filtered":    len(plans),
    }


@app.get("/plan/{plan_id}")
async def get_plan(plan_id: str):
    """Retourne le détail complet d'un plan."""
    plan = _plans_index.get(plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail=f"Plan {plan_id} introuvable")
    return plan


@app.get("/plan/{plan_id}/status")
async def get_plan_status(plan_id: str):
    """Retourne le statut d'exécution d'un plan avec la progression des sous-tâches."""
    plan = _plans_index.get(plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail=f"Plan {plan_id} introuvable")

    atomic_tasks = _flatten_atomic(plan["subtasks"])
    total = len(atomic_tasks)
    by_status = {
        "pending": 0, "running": 0, "done": 0, "failed": 0, "skipped": 0,
    }
    for t in atomic_tasks:
        by_status[t.get("status", "pending")] = by_status.get(t.get("status", "pending"), 0) + 1

    progress_pct = round(by_status["done"] / total * 100) if total else 0

    return {
        "plan_id":          plan_id,
        "status":           plan["status"],
        "progress_pct":     progress_pct,
        "tasks_total":      total,
        "tasks_by_status":  by_status,
        "replan_count":     plan.get("replan_count", 0),
        "execution_time_ms": plan.get("execution_time_ms"),
        "updated_at":       plan.get("updated_at"),
    }


@app.get("/health")
async def health():
    """État du service Planner."""
    return {
        "status":        "ok",
        "layer":         "planner",
        "plans_count":   len(_plans_index),
        "skills_loaded": len(_skills),
        "port":          PLANNER_PORT,
        "plans_file":    str(PLANS_FILE),
        "brain_url":     BRAIN_URL,
        "memory_url":    MEMORY_URL,
    }


# ─── Entrée principale ───────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PLANNER_PORT)
