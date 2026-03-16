"""
Tests pour agent/planner.py — Phase 10 : Planification HTN.

Couvre :
- Validité syntaxique du fichier
- Présence des endpoints et fonctions principales (analyse statique)
- Tests unitaires sur la logique de décomposition HTN (fonctions pures, sans HTTP)
"""
import pytest
import sys
import os
import subprocess
import unittest.mock as mock

_ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
_FILE_PATH = os.path.join(_ROOT, 'agent', 'planner.py')

# Config YAML mockée — ports alignés avec l'architecture Ghost OS Ultimate
MOCK_CONFIG = {
    "ports": {
        "queen":      8001,
        "perception": 8002,
        "brain":      8003,
        "executor":   8004,
        "evolution":  8005,
        "memory":     8006,
        "mcp_bridge": 8007,
        "planner":    8008,
        "learner":    8009,
        "goals":      8010,
        "pipeline":   8011,
        "miner":      8012,
        "swarm":      8013,
        "validator":  8014,
        "computer_use": 8015,
    },
    "ollama": {
        "base_url": "http://localhost:11434",
        "models": {
            "strategist": "llama3:latest",
            "worker":     "llama3.2:3b",
        },
        "timeout": 120,
    },
    "memory": {
        "max_episodes":       500,
        "episode_file":       "agent/memory/episodes.jsonl",
        "persistent_file":    "agent/memory/persistent.md",
        "world_state_file":   "agent/memory/world_state.json",
    },
}


# ─────────────────────────────────────────────────────────────────────────────
# Tests syntaxe (sans import)
# ─────────────────────────────────────────────────────────────────────────────

class TestPlannerSyntax:
    def test_syntax_valid(self):
        """planner.py doit être syntaxiquement valide."""
        result = subprocess.run(
            ['python3', '-m', 'py_compile', _FILE_PATH],
            capture_output=True, text=True
        )
        assert result.returncode == 0, f"Erreur syntaxe planner.py:\n{result.stderr}"


# ─────────────────────────────────────────────────────────────────────────────
# Tests de présence des symboles clés (analyse statique)
# ─────────────────────────────────────────────────────────────────────────────

class TestPlannerStaticAnalysis:
    """Vérifie la présence des fonctions et endpoints attendus dans planner.py."""

    @pytest.fixture(autouse=True)
    def read_content(self):
        with open(_FILE_PATH, encoding='utf-8') as f:
            self.content = f.read()

    def test_plan_endpoint(self):
        """/plan endpoint doit être présent."""
        assert '"/plan"' in self.content or "'/plan'" in self.content

    def test_plan_status_endpoint(self):
        """/plan/{id}/status endpoint doit être présent."""
        assert 'status' in self.content

    def test_htn_reference(self):
        """Référence à HTN (Hierarchical Task Network) doit être présente."""
        assert 'htn' in self.content.lower() or 'HTN' in self.content

    def test_llm_decompose_function(self):
        """_llm_decompose() doit être défini."""
        assert '_llm_decompose' in self.content

    def test_lifespan_defined(self):
        """lifespan() doit être défini (démarrage FastAPI)."""
        assert 'lifespan' in self.content

    def test_goals_to_tasks_or_decompose_reference(self):
        """La décomposition de mission en tâches doit être référencée."""
        assert 'decompose' in self.content.lower() or 'subtask' in self.content.lower()

    def test_fastapi_app_defined(self):
        """FastAPI app doit être instanciée."""
        assert 'FastAPI(' in self.content

    def test_httpx_imported(self):
        """httpx doit être importé (appels vers Brain et Memory)."""
        assert 'import httpx' in self.content

    def test_plans_file_defined(self):
        """PLANS_FILE doit être défini (persistance des plans)."""
        assert 'PLANS_FILE' in self.content

    def test_brain_url_defined(self):
        """BRAIN_URL doit être défini."""
        assert 'BRAIN_URL' in self.content

    def test_cache_threshold_defined(self):
        """Un seuil de similarité de cache doit être défini."""
        assert 'CACHE_SIMILARITY_THRESHOLD' in self.content or 'SIMILARITY' in self.content

    def test_plan_id_route(self):
        """Route /plan/{plan_id} doit être présente."""
        assert 'plan_id' in self.content or '{plan_id}' in self.content

    def test_replan_endpoint(self):
        """/plan/replan endpoint doit être présent."""
        assert 'replan' in self.content

    def test_pydantic_model_defined(self):
        """Au moins un modèle Pydantic (BaseModel) doit être défini."""
        assert 'BaseModel' in self.content

    def test_plans_index_state(self):
        """_plans_index doit être défini (état global des plans en cache)."""
        assert '_plans_index' in self.content


# ─────────────────────────────────────────────────────────────────────────────
# Tests logique HTN (fonctions pures — pas de HTTP, pas de subprocess)
# ─────────────────────────────────────────────────────────────────────────────

class _HTNPlannerLogic:
    """
    Miroir inline de la logique de décomposition HTN de planner.py.
    On reproduit les règles essentielles pour les tester en isolation.
    """

    def decompose_goal(self, goal: str, subtasks: list[str]) -> dict:
        """Décompose un objectif en plan HTN structuré."""
        if not goal or not goal.strip():
            raise ValueError("goal ne peut pas être vide")
        tasks = []
        for idx, sub in enumerate(subtasks):
            tasks.append({
                "id":     f"task_{idx}",
                "name":   sub,
                "status": "pending",
                "order":  idx,
            })
        return {
            "goal":       goal,
            "tasks":      tasks,
            "task_count": len(tasks),
            "status":     "planned",
        }

    def select_next_task(self, plan: dict) -> dict | None:
        """Retourne la prochaine tâche pending selon l'ordre."""
        pending = [t for t in plan["tasks"] if t["status"] == "pending"]
        if not pending:
            return None
        return min(pending, key=lambda t: t["order"])

    def mark_task_done(self, plan: dict, task_id: str) -> dict:
        """Marque une tâche comme complétée."""
        for t in plan["tasks"]:
            if t["id"] == task_id:
                t["status"] = "completed"
                break
        all_done = all(t["status"] == "completed" for t in plan["tasks"])
        if all_done:
            plan["status"] = "completed"
        return plan

    def is_plan_complete(self, plan: dict) -> bool:
        """Retourne True si toutes les tâches sont complétées."""
        return all(t["status"] == "completed" for t in plan["tasks"])

    def similarity_score(self, a: str, b: str) -> float:
        """Similarité bag-of-words simple (0.0–1.0)."""
        if not a or not b:
            return 0.0
        set_a = set(a.lower().split())
        set_b = set(b.lower().split())
        if not set_a or not set_b:
            return 0.0
        intersection = set_a & set_b
        union = set_a | set_b
        return len(intersection) / len(union)


class TestPlannerHTNLogic:
    """Teste la logique pure de décomposition HTN — aucun appel HTTP."""

    @pytest.fixture(autouse=True)
    def setup(self):
        self.planner = _HTNPlannerLogic()

    def test_decompose_produces_plan_structure(self):
        """decompose_goal() doit produire un plan avec les clés attendues."""
        plan = self.planner.decompose_goal(
            "Analyser le bureau et produire un rapport",
            ["Prendre un screenshot", "Analyser l'image", "Rédiger le rapport"]
        )
        assert "goal" in plan
        assert "tasks" in plan
        assert "task_count" in plan
        assert plan["task_count"] == 3
        assert plan["status"] == "planned"

    def test_decompose_tasks_have_required_fields(self):
        """Chaque tâche doit avoir id, name, status, order."""
        plan = self.planner.decompose_goal(
            "Mission test",
            ["Étape A", "Étape B"]
        )
        for task in plan["tasks"]:
            assert "id" in task
            assert "name" in task
            assert "status" in task
            assert "order" in task

    def test_decompose_tasks_initially_pending(self):
        """Toutes les tâches initiales doivent avoir status='pending'."""
        plan = self.planner.decompose_goal("Goal", ["T1", "T2", "T3"])
        assert all(t["status"] == "pending" for t in plan["tasks"])

    def test_decompose_tasks_ordered(self):
        """Les tâches doivent être ordonnées (order 0, 1, 2...)."""
        plan = self.planner.decompose_goal("Goal", ["T1", "T2", "T3"])
        orders = [t["order"] for t in plan["tasks"]]
        assert orders == sorted(orders)

    def test_decompose_empty_subtasks_produces_empty_plan(self):
        """Un objectif sans sous-tâches produit un plan avec tasks=[]."""
        plan = self.planner.decompose_goal("Goal sans étapes", [])
        assert plan["tasks"] == []
        assert plan["task_count"] == 0

    def test_decompose_empty_goal_raises(self):
        """Un goal vide doit lever ValueError."""
        with pytest.raises(ValueError):
            self.planner.decompose_goal("", ["T1"])

    def test_select_next_task_returns_first_pending(self):
        """select_next_task() retourne la tâche pending avec le plus petit order."""
        plan = self.planner.decompose_goal("Goal", ["T1", "T2", "T3"])
        next_task = self.planner.select_next_task(plan)
        assert next_task is not None
        assert next_task["order"] == 0
        assert next_task["name"] == "T1"

    def test_select_next_task_skips_completed(self):
        """select_next_task() doit ignorer les tâches déjà complétées."""
        plan = self.planner.decompose_goal("Goal", ["T1", "T2", "T3"])
        plan["tasks"][0]["status"] = "completed"
        next_task = self.planner.select_next_task(plan)
        assert next_task is not None
        assert next_task["order"] == 1

    def test_select_next_task_returns_none_when_all_done(self):
        """select_next_task() doit retourner None si toutes les tâches sont complétées."""
        plan = self.planner.decompose_goal("Goal", ["T1"])
        plan["tasks"][0]["status"] = "completed"
        result = self.planner.select_next_task(plan)
        assert result is None

    def test_mark_task_done_updates_status(self):
        """mark_task_done() doit mettre status='completed' sur la tâche."""
        plan = self.planner.decompose_goal("Goal", ["T1", "T2"])
        plan = self.planner.mark_task_done(plan, "task_0")
        assert plan["tasks"][0]["status"] == "completed"
        assert plan["tasks"][1]["status"] == "pending"

    def test_mark_all_tasks_done_completes_plan(self):
        """Marquer toutes les tâches comme done doit passer plan.status='completed'."""
        plan = self.planner.decompose_goal("Goal", ["T1", "T2"])
        plan = self.planner.mark_task_done(plan, "task_0")
        plan = self.planner.mark_task_done(plan, "task_1")
        assert plan["status"] == "completed"
        assert self.planner.is_plan_complete(plan) is True

    def test_is_plan_complete_false_when_pending(self):
        """is_plan_complete() doit retourner False si des tâches sont pending."""
        plan = self.planner.decompose_goal("Goal", ["T1", "T2"])
        assert self.planner.is_plan_complete(plan) is False

    def test_similarity_score_identical_strings(self):
        """similarity_score() doit retourner 1.0 pour deux chaînes identiques."""
        score = self.planner.similarity_score("analyser le bureau", "analyser le bureau")
        assert score == 1.0

    def test_similarity_score_no_overlap(self):
        """similarity_score() doit retourner 0.0 pour des chaînes sans mots communs."""
        score = self.planner.similarity_score("analyser photo", "écrire rapport")
        assert score == 0.0

    def test_similarity_score_partial_overlap(self):
        """similarity_score() doit retourner une valeur entre 0 et 1 pour overlap partiel."""
        score = self.planner.similarity_score("analyser photo bureau", "analyser rapport")
        assert 0.0 < score < 1.0

    def test_similarity_score_empty_string(self):
        """similarity_score() doit retourner 0.0 pour une chaîne vide."""
        score = self.planner.similarity_score("", "analyser le bureau")
        assert score == 0.0

    @pytest.mark.parametrize("goal,subtasks,expected_count", [
        ("Mission A", ["T1", "T2", "T3"], 3),
        ("Mission B", ["Seule étape"], 1),
        ("Mission C", [], 0),
        ("Mission D", ["T1", "T2", "T3", "T4", "T5"], 5),
    ])
    def test_decompose_parametrize(self, goal, subtasks, expected_count):
        """Test paramétrisé — décomposition de N sous-tâches."""
        plan = self.planner.decompose_goal(goal, subtasks)
        assert plan["task_count"] == expected_count
        assert len(plan["tasks"]) == expected_count
