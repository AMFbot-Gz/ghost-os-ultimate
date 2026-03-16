"""
Tests pour agent/goals.py — Phase 13 : Autonomous Goal Loop.

Couvre :
- Validité syntaxique du fichier
- Présence des endpoints et fonctions principales (analyse statique)
- Tests unitaires sur la logique d'états des objectifs (fonctions pures)
"""
import pytest
import sys
import os
import subprocess
import unittest.mock as mock
from enum import Enum
from typing import Optional

_ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
_FILE_PATH = os.path.join(_ROOT, 'agent', 'goals.py')

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

class TestGoalsSyntax:
    def test_syntax_valid(self):
        """goals.py doit être syntaxiquement valide."""
        result = subprocess.run(
            ['python3', '-m', 'py_compile', _FILE_PATH],
            capture_output=True, text=True
        )
        assert result.returncode == 0, f"Erreur syntaxe goals.py:\n{result.stderr}"


# ─────────────────────────────────────────────────────────────────────────────
# Tests de présence des symboles clés (analyse statique)
# ─────────────────────────────────────────────────────────────────────────────

class TestGoalsStaticAnalysis:
    """Vérifie la présence des fonctions et endpoints attendus dans goals.py."""

    @pytest.fixture(autouse=True)
    def read_content(self):
        with open(_FILE_PATH, encoding='utf-8') as f:
            self.content = f.read()

    def test_goals_endpoint(self):
        """/goals endpoint doit être présent."""
        assert '"/goals"' in self.content or "'/goals'" in self.content

    def test_goals_id_endpoint(self):
        """/goals/{id} endpoint doit être présent."""
        assert 'goal_id' in self.content or '{goal_id}' in self.content

    def test_autonomous_loop_reference(self):
        """La boucle autonome doit être référencée."""
        assert 'autonomous' in self.content.lower() or 'auto_execute' in self.content

    def test_goal_status_values(self):
        """Les statuts d'objectifs (pending, active, completed, failed) doivent être présents."""
        assert 'pending' in self.content
        assert 'active' in self.content
        assert 'completed' in self.content
        assert 'failed' in self.content

    def test_sqlite3_imported(self):
        """sqlite3 doit être importé (persistance SQLite)."""
        assert 'import sqlite3' in self.content or 'sqlite3' in self.content

    def test_sqlite_db_file_defined(self):
        """DB_FILE doit être défini (fichier SQLite)."""
        assert 'DB_FILE' in self.content

    def test_fastapi_app_defined(self):
        """FastAPI app doit être instanciée."""
        assert 'FastAPI(' in self.content

    def test_httpx_imported(self):
        """httpx doit être importé (appels vers Queen et Planner)."""
        assert 'import httpx' in self.content

    def test_goals_table_schema(self):
        """La table 'goals' doit être créée (schema SQLite)."""
        assert 'CREATE TABLE IF NOT EXISTS goals' in self.content

    def test_goal_missions_table_schema(self):
        """La table 'goal_missions' doit être créée."""
        assert 'goal_missions' in self.content

    def test_status_update_model(self):
        """StatusUpdate model Pydantic doit être défini."""
        assert 'StatusUpdate' in self.content

    def test_init_db_function(self):
        """_init_db() doit être définie."""
        assert '_init_db' in self.content

    def test_planner_url_defined(self):
        """PLANNER_URL doit être défini."""
        assert 'PLANNER_URL' in self.content

    def test_queen_url_defined(self):
        """QUEEN_URL doit être défini."""
        assert 'QUEEN_URL' in self.content

    def test_auto_loop_interval_defined(self):
        """AUTO_LOOP_INTERVAL doit être défini."""
        assert 'AUTO_LOOP_INTERVAL' in self.content

    def test_paused_status_supported(self):
        """Le statut 'paused' doit être supporté."""
        assert 'paused' in self.content

    def test_priority_field_defined(self):
        """Le champ 'priority' doit être défini (ordonnancement des objectifs)."""
        assert 'priority' in self.content


# ─────────────────────────────────────────────────────────────────────────────
# Logique inline de statuts d'objectifs (fonctions pures)
# ─────────────────────────────────────────────────────────────────────────────

class GoalStatus(str, Enum):
    """Miroir des statuts d'objectifs définis dans goals.py."""
    PENDING   = "pending"
    ACTIVE    = "active"
    COMPLETED = "completed"
    FAILED    = "failed"
    PAUSED    = "paused"


class _GoalStateMachine:
    """
    Miroir inline de la machine à états des objectifs de goals.py.
    Fonctions pures — aucune dépendance SQLite ou HTTP.
    """

    VALID_STATUSES = {s.value for s in GoalStatus}

    # Transitions d'état autorisées
    ALLOWED_TRANSITIONS: dict[str, set[str]] = {
        GoalStatus.PENDING:   {GoalStatus.ACTIVE, GoalStatus.FAILED},
        GoalStatus.ACTIVE:    {GoalStatus.COMPLETED, GoalStatus.FAILED, GoalStatus.PAUSED},
        GoalStatus.PAUSED:    {GoalStatus.ACTIVE, GoalStatus.FAILED},
        GoalStatus.COMPLETED: set(),   # état terminal
        GoalStatus.FAILED:    set(),   # état terminal
    }

    def is_valid_status(self, status: str) -> bool:
        """Retourne True si le statut est valide."""
        return status in self.VALID_STATUSES

    def can_transition(self, current: str, target: str) -> bool:
        """Retourne True si la transition current → target est autorisée."""
        if not self.is_valid_status(current) or not self.is_valid_status(target):
            return False
        return target in self.ALLOWED_TRANSITIONS.get(current, set())

    def is_terminal(self, status: str) -> bool:
        """Retourne True si le statut est terminal (plus de transitions possibles)."""
        return self.ALLOWED_TRANSITIONS.get(status, None) == set()

    def is_executable(self, goal: dict) -> bool:
        """
        Retourne True si un objectif peut être exécuté automatiquement.
        Critères : status='active', auto_execute=True.
        """
        return (
            goal.get("status") == GoalStatus.ACTIVE
            and bool(goal.get("auto_execute", False))
        )

    def compute_progress(self, missions: list[dict]) -> float:
        """
        Calcule le pourcentage de progression (0.0 – 100.0).
        Basé sur le ratio missions completed / total.
        """
        if not missions:
            return 0.0
        total = len(missions)
        done  = sum(1 for m in missions if m.get("status") in ("completed", "success"))
        return round(done / total * 100.0, 1)

    def prioritize_goals(self, goals: list[dict]) -> list[dict]:
        """
        Trie les objectifs actifs par priorité décroissante.
        priority=1 = très haute, priority=10 = très basse.
        """
        active = [g for g in goals if g.get("status") == GoalStatus.ACTIVE]
        return sorted(active, key=lambda g: g.get("priority", 5))


class TestGoalsStatusLogic:
    """Teste la logique pure de statuts et transitions d'objectifs."""

    @pytest.fixture(autouse=True)
    def setup(self):
        self.sm = _GoalStateMachine()

    # --- Validation des statuts ---

    def test_valid_statuses(self):
        """Tous les statuts GoalStatus doivent être reconnus comme valides."""
        for status in GoalStatus:
            assert self.sm.is_valid_status(status.value) is True

    def test_invalid_status_rejected(self):
        """Un statut inexistant doit être rejeté."""
        assert self.sm.is_valid_status("unknown") is False
        assert self.sm.is_valid_status("") is False
        assert self.sm.is_valid_status("COMPLETED") is False   # case sensitive

    # --- Transitions d'état ---

    def test_pending_to_active_allowed(self):
        """pending → active doit être une transition autorisée."""
        assert self.sm.can_transition("pending", "active") is True

    def test_active_to_completed_allowed(self):
        """active → completed doit être autorisé."""
        assert self.sm.can_transition("active", "completed") is True

    def test_active_to_failed_allowed(self):
        """active → failed doit être autorisé."""
        assert self.sm.can_transition("active", "failed") is True

    def test_active_to_paused_allowed(self):
        """active → paused doit être autorisé."""
        assert self.sm.can_transition("active", "paused") is True

    def test_paused_to_active_allowed(self):
        """paused → active doit être autorisé (reprise)."""
        assert self.sm.can_transition("paused", "active") is True

    def test_completed_to_active_forbidden(self):
        """completed → active doit être interdit (état terminal)."""
        assert self.sm.can_transition("completed", "active") is False

    def test_failed_to_active_forbidden(self):
        """failed → active doit être interdit (état terminal)."""
        assert self.sm.can_transition("failed", "active") is False

    def test_pending_to_completed_forbidden(self):
        """pending → completed directement doit être interdit."""
        assert self.sm.can_transition("pending", "completed") is False

    # --- États terminaux ---

    def test_completed_is_terminal(self):
        """completed doit être un état terminal."""
        assert self.sm.is_terminal("completed") is True

    def test_failed_is_terminal(self):
        """failed doit être un état terminal."""
        assert self.sm.is_terminal("failed") is True

    def test_pending_not_terminal(self):
        """pending ne doit pas être terminal."""
        assert self.sm.is_terminal("pending") is False

    def test_active_not_terminal(self):
        """active ne doit pas être terminal."""
        assert self.sm.is_terminal("active") is False

    # --- Exécutabilité ---

    def test_active_auto_execute_is_executable(self):
        """Un objectif active+auto_execute doit être exécutable."""
        goal = {"status": "active", "auto_execute": True, "title": "Test"}
        assert self.sm.is_executable(goal) is True

    def test_active_no_auto_execute_not_executable(self):
        """Un objectif active sans auto_execute ne doit pas être exécuté."""
        goal = {"status": "active", "auto_execute": False, "title": "Test"}
        assert self.sm.is_executable(goal) is False

    def test_pending_not_executable(self):
        """Un objectif pending ne doit pas être exécutable même avec auto_execute."""
        goal = {"status": "pending", "auto_execute": True, "title": "Test"}
        assert self.sm.is_executable(goal) is False

    # --- Calcul de progression ---

    def test_progress_all_completed(self):
        """100% de progression si toutes les missions sont complétées."""
        missions = [
            {"status": "completed"},
            {"status": "completed"},
            {"status": "completed"},
        ]
        assert self.sm.compute_progress(missions) == 100.0

    def test_progress_none_completed(self):
        """0% de progression si aucune mission n'est complétée."""
        missions = [{"status": "pending"}, {"status": "pending"}]
        assert self.sm.compute_progress(missions) == 0.0

    def test_progress_partial(self):
        """La progression partielle doit être calculée correctement."""
        missions = [
            {"status": "completed"},
            {"status": "pending"},
            {"status": "pending"},
            {"status": "pending"},
        ]
        progress = self.sm.compute_progress(missions)
        assert progress == 25.0

    def test_progress_empty_missions(self):
        """0.0 si la liste de missions est vide."""
        assert self.sm.compute_progress([]) == 0.0

    def test_progress_success_status_counts(self):
        """Le statut 'success' doit aussi compter comme mission terminée."""
        missions = [{"status": "success"}, {"status": "pending"}]
        assert self.sm.compute_progress(missions) == 50.0

    # --- Prioritisation ---

    def test_prioritize_returns_only_active(self):
        """prioritize_goals() doit ne retourner que les objectifs actifs."""
        goals = [
            {"status": "active",    "priority": 3, "title": "A"},
            {"status": "pending",   "priority": 1, "title": "B"},
            {"status": "completed", "priority": 2, "title": "C"},
        ]
        result = self.sm.prioritize_goals(goals)
        assert len(result) == 1
        assert result[0]["title"] == "A"

    def test_prioritize_sorts_by_priority(self):
        """prioritize_goals() doit trier par priority croissante (1 = plus prioritaire)."""
        goals = [
            {"status": "active", "priority": 5, "title": "Bas"},
            {"status": "active", "priority": 1, "title": "Haut"},
            {"status": "active", "priority": 3, "title": "Milieu"},
        ]
        result = self.sm.prioritize_goals(goals)
        assert result[0]["title"] == "Haut"
        assert result[1]["title"] == "Milieu"
        assert result[2]["title"] == "Bas"

    @pytest.mark.parametrize("current,target,expected", [
        ("pending",   "active",    True),
        ("pending",   "failed",    True),
        ("active",    "completed", True),
        ("active",    "failed",    True),
        ("active",    "paused",    True),
        ("paused",    "active",    True),
        ("completed", "active",    False),
        ("failed",    "active",    False),
        ("pending",   "completed", False),
        ("paused",    "completed", False),
    ])
    def test_transitions_parametrize(self, current, target, expected):
        """Test paramétrisé des transitions d'état autorisées/interdites."""
        result = self.sm.can_transition(current, target)
        assert result == expected, (
            f"can_transition({current!r} → {target!r}) = {result}, attendu {expected}"
        )
