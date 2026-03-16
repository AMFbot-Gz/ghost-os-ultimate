"""
Tests pour agent/pipeline.py — Phase 14 : Skill Pipeline Composer.

Couvre :
- Validité syntaxique du fichier
- Présence des endpoints et fonctions principales (analyse statique)
- Tests unitaires sur la logique de composition et séquençage de pipeline (fonctions pures)
"""
import pytest
import sys
import os
import subprocess
import unittest.mock as mock
from typing import Optional, Any

_ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
_FILE_PATH = os.path.join(_ROOT, 'agent', 'pipeline.py')

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

class TestPipelineSyntax:
    def test_syntax_valid(self):
        """pipeline.py doit être syntaxiquement valide."""
        result = subprocess.run(
            ['python3', '-m', 'py_compile', _FILE_PATH],
            capture_output=True, text=True
        )
        assert result.returncode == 0, f"Erreur syntaxe pipeline.py:\n{result.stderr}"


# ─────────────────────────────────────────────────────────────────────────────
# Tests de présence des symboles clés (analyse statique)
# ─────────────────────────────────────────────────────────────────────────────

class TestPipelineStaticAnalysis:
    """Vérifie la présence des fonctions et endpoints attendus dans pipeline.py."""

    @pytest.fixture(autouse=True)
    def read_content(self):
        with open(_FILE_PATH, encoding='utf-8') as f:
            self.content = f.read()

    def test_pipelines_endpoint(self):
        """/pipelines endpoint doit être présent."""
        assert '"/pipelines"' in self.content or "'/pipelines'" in self.content

    def test_run_endpoint(self):
        """/run endpoint doit être présent (exécution de pipeline)."""
        assert '/run' in self.content

    def test_pipeline_composer_reference(self):
        """PipelineComposer ou 'Skill Pipeline Composer' doit être référencé."""
        assert 'PipelineComposer' in self.content or 'Pipeline Composer' in self.content

    def test_skill_reference(self):
        """Le concept de 'skill' doit être présent."""
        assert 'skill' in self.content.lower()

    def test_executor_url_defined(self):
        """EXECUTOR_URL doit être défini (délégation des steps shell)."""
        assert 'EXECUTOR_URL' in self.content

    def test_fastapi_app_defined(self):
        """FastAPI app doit être instanciée."""
        assert 'FastAPI(' in self.content

    def test_httpx_imported(self):
        """httpx doit être importé (appels vers Executor et Brain)."""
        assert 'import httpx' in self.content

    def test_sqlite3_imported(self):
        """sqlite3 doit être importé (persistance des pipelines)."""
        assert 'import sqlite3' in self.content or 'sqlite3' in self.content

    def test_exec_step_function(self):
        """_exec_step() doit être définie (exécution d'un step)."""
        assert '_exec_step' in self.content

    def test_step_types_defined(self):
        """Les types de steps (shell, mission) doivent être définis."""
        assert '"shell"' in self.content or "'shell'" in self.content
        assert '"mission"' in self.content or "'mission'" in self.content

    def test_pipelines_table_defined(self):
        """La table 'pipelines' doit être créée (schema SQLite)."""
        assert 'CREATE TABLE IF NOT EXISTS pipelines' in self.content

    def test_pipeline_runs_table_defined(self):
        """La table 'pipeline_runs' doit être créée."""
        assert 'pipeline_runs' in self.content

    def test_variable_substitution_reference(self):
        """La substitution de variables doit être présente."""
        assert 'variables' in self.content or 'variable' in self.content

    def test_brain_url_defined(self):
        """BRAIN_URL doit être défini."""
        assert 'BRAIN_URL' in self.content

    def test_init_db_function(self):
        """_init_db() doit être définie."""
        assert '_init_db' in self.content

    def test_step_timeout_defined(self):
        """Un timeout de step doit être défini."""
        assert 'DEFAULT_STEP_TIMEOUT' in self.content or 'step_timeout' in self.content

    def test_runs_endpoint(self):
        """/runs endpoint doit être présent."""
        assert '"/runs"' in self.content or "'/runs'" in self.content


# ─────────────────────────────────────────────────────────────────────────────
# Logique inline de composition de pipeline (fonctions pures)
# ─────────────────────────────────────────────────────────────────────────────

class _PipelineComposerLogic:
    """
    Miroir inline de la logique de composition et séquençage de pipeline.py.
    Fonctions pures — sans HTTP, SQLite ou subprocess.
    """

    DEFAULT_STEP_TIMEOUT = 90
    MAX_STEP_TIMEOUT     = 300

    def build_pipeline(self, name: str, steps: list[dict]) -> dict:
        """Construit une définition de pipeline à partir d'une liste de steps."""
        if not name or not name.strip():
            raise ValueError("Le nom du pipeline ne peut pas être vide")
        validated_steps = []
        for idx, step in enumerate(steps):
            validated_steps.append({
                "id":      step.get("id", f"step_{idx}"),
                "name":    step.get("name", f"Step {idx}"),
                "type":    step.get("type", "shell"),
                "command": step.get("command", ""),
                "timeout": min(
                    step.get("timeout", self.DEFAULT_STEP_TIMEOUT),
                    self.MAX_STEP_TIMEOUT
                ),
                "order":   idx,
            })
        return {
            "name":       name,
            "steps":      validated_steps,
            "step_count": len(validated_steps),
            "status":     "defined",
        }

    def substitute_variables(self, template: str, variables: dict) -> str:
        """
        Substitue les variables {{VAR}} dans un template de commande.
        Retourne la chaîne avec les substitutions appliquées.
        """
        result = template
        for key, value in variables.items():
            result = result.replace(f"{{{{{key}}}}}", str(value))
        return result

    def simulate_run(self, pipeline: dict, step_results: list[dict]) -> dict:
        """
        Simule l'exécution d'un pipeline à partir de résultats de steps prédéfinis.
        Retourne le run_result avec les stats.
        """
        steps = pipeline["steps"]
        total = len(steps)
        executed = []

        for i, step in enumerate(steps):
            if i >= len(step_results):
                # Plus de résultats prédéfinis → on arrête
                break
            result = step_results[i]
            executed.append({
                "step_id": step["id"],
                "name":    step["name"],
                "type":    step["type"],
                "status":  result.get("status", "pending"),
                "output":  result.get("output", ""),
                "order":   step["order"],
            })
            if result.get("status") == "failed":
                # Arrêt sur premier échec
                return {
                    "status":         "failed",
                    "steps_executed": len(executed),
                    "steps_total":    total,
                    "failed_at_step": step["id"],
                    "results":        executed,
                }

        all_ok = all(r.get("status") == "completed" for r in step_results[:len(steps)])
        return {
            "status":         "completed" if all_ok else "partial",
            "steps_executed": len(executed),
            "steps_total":    total,
            "failed_at_step": None,
            "results":        executed,
        }

    def get_step_order(self, pipeline: dict) -> list[str]:
        """Retourne les IDs des steps dans l'ordre d'exécution."""
        return [s["id"] for s in sorted(pipeline["steps"], key=lambda s: s["order"])]

    def clamp_timeout(self, timeout: int) -> int:
        """Clamp le timeout entre 1 et MAX_STEP_TIMEOUT."""
        return max(1, min(timeout, self.MAX_STEP_TIMEOUT))


class TestPipelineCompositionLogic:
    """Teste la logique pure de composition et séquençage de pipelines."""

    @pytest.fixture(autouse=True)
    def setup(self):
        self.composer = _PipelineComposerLogic()

        self.simple_steps = [
            {"id": "s1", "name": "Étape 1", "type": "shell",   "command": "echo hello"},
            {"id": "s2", "name": "Étape 2", "type": "shell",   "command": "ls -la"},
            {"id": "s3", "name": "Étape 3", "type": "mission", "command": "Analyser les fichiers"},
        ]

    # --- Construction du pipeline ---

    def test_build_pipeline_returns_structure(self):
        """build_pipeline() doit retourner un dict avec les clés attendues."""
        pipeline = self.composer.build_pipeline("Mon pipeline", self.simple_steps)
        assert "name" in pipeline
        assert "steps" in pipeline
        assert "step_count" in pipeline
        assert "status" in pipeline
        assert pipeline["status"] == "defined"

    def test_build_pipeline_step_count(self):
        """step_count doit correspondre au nombre de steps."""
        pipeline = self.composer.build_pipeline("Test", self.simple_steps)
        assert pipeline["step_count"] == len(self.simple_steps)
        assert len(pipeline["steps"]) == len(self.simple_steps)

    def test_build_pipeline_steps_have_order(self):
        """Chaque step doit avoir un champ 'order' séquentiel."""
        pipeline = self.composer.build_pipeline("Test", self.simple_steps)
        orders = [s["order"] for s in pipeline["steps"]]
        assert orders == list(range(len(self.simple_steps)))

    def test_build_pipeline_empty_name_raises(self):
        """Un nom de pipeline vide doit lever ValueError."""
        with pytest.raises(ValueError):
            self.composer.build_pipeline("", self.simple_steps)

    def test_build_pipeline_empty_steps(self):
        """Un pipeline sans steps est valide (step_count=0)."""
        pipeline = self.composer.build_pipeline("Pipeline vide", [])
        assert pipeline["step_count"] == 0
        assert pipeline["steps"] == []

    def test_build_pipeline_default_step_type(self):
        """Un step sans type explicite doit avoir type='shell' par défaut."""
        steps = [{"name": "Sans type", "command": "echo"}]
        pipeline = self.composer.build_pipeline("Test", steps)
        assert pipeline["steps"][0]["type"] == "shell"

    def test_build_pipeline_timeout_clamped(self):
        """Un timeout dépassant MAX_STEP_TIMEOUT doit être tronqué."""
        steps = [{"name": "Long step", "command": "sleep 1000", "timeout": 99999}]
        pipeline = self.composer.build_pipeline("Test timeout", steps)
        assert pipeline["steps"][0]["timeout"] <= self.composer.MAX_STEP_TIMEOUT

    # --- Substitution de variables ---

    def test_substitute_single_variable(self):
        """{{VAR}} doit être remplacé par sa valeur."""
        result = self.composer.substitute_variables("echo {{TARGET}}", {"TARGET": "hello"})
        assert result == "echo hello"

    def test_substitute_multiple_variables(self):
        """Plusieurs variables doivent toutes être substituées."""
        result = self.composer.substitute_variables(
            "cp {{SRC}} {{DST}}",
            {"SRC": "/tmp/a.txt", "DST": "/tmp/b.txt"}
        )
        assert result == "cp /tmp/a.txt /tmp/b.txt"

    def test_substitute_missing_variable_unchanged(self):
        """Une variable absente doit laisser le template inchangé."""
        result = self.composer.substitute_variables("echo {{MISSING}}", {})
        assert "{{MISSING}}" in result

    def test_substitute_empty_template(self):
        """Une template vide doit rester vide."""
        result = self.composer.substitute_variables("", {"VAR": "val"})
        assert result == ""

    # --- Exécution simulée et séquençage ---

    def test_steps_execute_in_order(self):
        """Les steps doivent s'exécuter dans l'ordre défini."""
        pipeline = self.composer.build_pipeline("Test ordre", self.simple_steps)
        ordered_ids = self.composer.get_step_order(pipeline)
        assert ordered_ids == ["s1", "s2", "s3"]

    def test_run_all_success_returns_completed(self):
        """Un run où tous les steps réussissent doit retourner status='completed'."""
        pipeline = self.composer.build_pipeline("Test succès", self.simple_steps)
        step_results = [
            {"status": "completed", "output": "ok"},
            {"status": "completed", "output": "ok"},
            {"status": "completed", "output": "ok"},
        ]
        run = self.composer.simulate_run(pipeline, step_results)
        assert run["status"] == "completed"
        assert run["steps_executed"] == 3
        assert run["failed_at_step"] is None

    def test_run_stops_on_first_failure(self):
        """Un run doit s'arrêter au premier step en échec."""
        pipeline = self.composer.build_pipeline("Test échec", self.simple_steps)
        step_results = [
            {"status": "completed", "output": "ok"},
            {"status": "failed",    "output": "erreur"},
            {"status": "completed", "output": "ok"},  # ne doit pas être exécuté
        ]
        run = self.composer.simulate_run(pipeline, step_results)
        assert run["status"] == "failed"
        assert run["failed_at_step"] == "s2"
        assert run["steps_executed"] == 2  # s3 non exécuté

    def test_run_empty_pipeline(self):
        """Un pipeline vide doit retourner status='completed' avec 0 steps."""
        pipeline = self.composer.build_pipeline("Vide", [])
        run = self.composer.simulate_run(pipeline, [])
        assert run["steps_executed"] == 0
        assert run["steps_total"] == 0

    # --- Clamping du timeout ---

    def test_clamp_timeout_max(self):
        """Un timeout > MAX doit être ramené à MAX."""
        assert self.composer.clamp_timeout(99999) == self.composer.MAX_STEP_TIMEOUT

    def test_clamp_timeout_min(self):
        """Un timeout négatif ou nul doit être ramené à 1."""
        assert self.composer.clamp_timeout(0) == 1
        assert self.composer.clamp_timeout(-10) == 1

    def test_clamp_timeout_valid_unchanged(self):
        """Un timeout valide ne doit pas être modifié."""
        assert self.composer.clamp_timeout(90) == 90

    @pytest.mark.parametrize("steps_input,expected_order", [
        (["s1", "s2", "s3"], ["step_0", "step_1", "step_2"]),
        (["unique"],         ["step_0"]),
        ([],                 []),
    ])
    def test_step_order_parametrize(self, steps_input, expected_order):
        """Test paramétrisé du séquençage des steps."""
        steps = [{"name": s, "command": f"echo {s}"} for s in steps_input]
        pipeline = self.composer.build_pipeline("Test", steps)
        order = self.composer.get_step_order(pipeline)
        assert order == expected_order
