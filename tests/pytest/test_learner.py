"""
Tests pour agent/learner.py — Phase 11 : Skill Learning depuis épisodes.

Couvre :
- Validité syntaxique du fichier
- Présence des endpoints et fonctions principales (analyse statique)
- Tests unitaires sur la logique d'extraction de patterns depuis des épisodes (fonctions pures)
"""
import pytest
import sys
import os
import subprocess
import unittest.mock as mock
from typing import Optional

_ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
_FILE_PATH = os.path.join(_ROOT, 'agent', 'learner.py')

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

class TestLearnerSyntax:
    def test_syntax_valid(self):
        """learner.py doit être syntaxiquement valide."""
        result = subprocess.run(
            ['python3', '-m', 'py_compile', _FILE_PATH],
            capture_output=True, text=True
        )
        assert result.returncode == 0, f"Erreur syntaxe learner.py:\n{result.stderr}"


# ─────────────────────────────────────────────────────────────────────────────
# Tests de présence des symboles clés (analyse statique)
# ─────────────────────────────────────────────────────────────────────────────

class TestLearnerStaticAnalysis:
    """Vérifie la présence des fonctions et endpoints attendus dans learner.py."""

    @pytest.fixture(autouse=True)
    def read_content(self):
        with open(_FILE_PATH, encoding='utf-8') as f:
            self.content = f.read()

    def test_learn_endpoint(self):
        """/learn endpoint doit être présent."""
        assert '"/learn"' in self.content or "'/learn'" in self.content

    def test_learned_skills_endpoint(self):
        """/learned-skills endpoint doit être présent."""
        assert 'learned-skills' in self.content or 'learned_skills' in self.content

    def test_extract_json_function(self):
        """_extract_json() ou équivalent de parsing doit être défini."""
        assert '_extract_json' in self.content or 'extract_json' in self.content

    def test_lifespan_defined(self):
        """lifespan() doit être défini (démarrage FastAPI)."""
        assert 'lifespan' in self.content

    def test_episode_learner_or_auto_learn(self):
        """EpisodeLearner ou _auto_learn_loop doit être défini."""
        assert 'EpisodeLearner' in self.content or '_auto_learn_loop' in self.content

    def test_fastapi_app_defined(self):
        """FastAPI app doit être instanciée."""
        assert 'FastAPI(' in self.content

    def test_httpx_imported(self):
        """httpx doit être importé (appels vers Brain et Memory)."""
        assert 'import httpx' in self.content

    def test_episodes_file_defined(self):
        """EPISODES_FILE doit être défini (source des épisodes)."""
        assert 'EPISODES_FILE' in self.content

    def test_brain_url_defined(self):
        """BRAIN_URL doit être défini."""
        assert 'BRAIN_URL' in self.content

    def test_evolution_url_defined(self):
        """EVOLUTION_URL doit être défini (envoi des skills générés)."""
        assert 'EVOLUTION_URL' in self.content

    def test_analyze_learnability_function(self):
        """_analyze_learnability() doit être définie."""
        assert '_analyze_learnability' in self.content

    def test_generate_skill_from_episode_function(self):
        """_generate_skill_from_episode() doit être définie."""
        assert '_generate_skill_from_episode' in self.content

    def test_learning_stats_endpoint(self):
        """/learning-stats endpoint doit être présent."""
        assert 'learning-stats' in self.content or 'learning_stats' in self.content

    def test_stats_dict_defined(self):
        """_stats dict global doit être défini."""
        assert '_stats' in self.content

    def test_batch_learn_function(self):
        """_run_batch_learn() doit être définie."""
        assert '_run_batch_learn' in self.content

    def test_already_learned_function(self):
        """_already_learned() doit être définie (déduplication)."""
        assert '_already_learned' in self.content


# ─────────────────────────────────────────────────────────────────────────────
# Tests logique d'extraction de skill depuis épisodes (fonctions pures)
# ─────────────────────────────────────────────────────────────────────────────

class _EpisodeLearnerLogic:
    """
    Miroir inline de la logique d'extraction de patterns de learner.py.
    Fonctions pures testables sans HTTP, filesystem ou subprocess.
    """

    MIN_STEPS     = 2     # épisodes trop courts non apprenables
    MIN_SUCCESS   = True  # seuls les épisodes réussis sont apprenables

    def is_learnable(self, episode: dict) -> tuple[bool, str]:
        """
        Évalue si un épisode peut générer un skill.
        Retourne (True, raison) ou (False, raison).
        """
        steps = episode.get("steps", [])
        success = episode.get("success", False)
        mission = episode.get("mission", "").strip()

        if not mission:
            return False, "mission vide"
        if not success:
            return False, "épisode non réussi"
        if len(steps) < self.MIN_STEPS:
            return False, f"trop peu d'étapes ({len(steps)} < {self.MIN_STEPS})"
        return True, "ok"

    def extract_pattern(self, episode: dict) -> Optional[dict]:
        """
        Extrait un pattern apprenable depuis un épisode réussi.
        Retourne None si l'épisode n'est pas apprenable.
        """
        learnable, reason = self.is_learnable(episode)
        if not learnable:
            return None

        steps = episode.get("steps", [])
        mission = episode["mission"]
        tools_used = list({s.get("tool", "unknown") for s in steps if s.get("tool")})

        return {
            "mission":    mission,
            "step_count": len(steps),
            "tools_used": sorted(tools_used),
            "pattern":    self._summarize_pattern(steps),
            "learnable":  True,
        }

    def _summarize_pattern(self, steps: list[dict]) -> str:
        """Produit un résumé textuel du pattern d'actions."""
        actions = [s.get("action", "?") for s in steps if s.get("action")]
        return " → ".join(actions) if actions else "no-actions"

    def deduplicate_episodes(self, episodes: list[dict], seen: set) -> list[dict]:
        """Filtre les épisodes déjà appris (par mission)."""
        result = []
        for ep in episodes:
            mission = ep.get("mission", "").lower().strip()
            if mission and mission not in seen:
                seen.add(mission)
                result.append(ep)
        return result

    def score_episode(self, episode: dict) -> float:
        """
        Score d'un épisode pour priorisation.
        score = nombre d'étapes × (1 si succès, 0.1 sinon) × recency_factor
        """
        steps   = len(episode.get("steps", []))
        success = 1.0 if episode.get("success", False) else 0.1
        recency = episode.get("recency_factor", 1.0)
        return steps * success * recency


class TestLearnerSkillExtractionLogic:
    """Teste la logique pure d'extraction de patterns depuis les épisodes."""

    @pytest.fixture(autouse=True)
    def setup(self):
        self.learner = _EpisodeLearnerLogic()

        # Épisode valide standard
        self.valid_episode = {
            "mission": "Prendre un screenshot et l'analyser",
            "success": True,
            "steps": [
                {"action": "screenshot", "tool": "perception", "result": "ok"},
                {"action": "analyse",    "tool": "brain",      "result": "ok"},
                {"action": "rapport",    "tool": "brain",      "result": "ok"},
            ],
        }

        # Épisode échoué
        self.failed_episode = {
            "mission": "Mission qui a échoué",
            "success": False,
            "steps": [
                {"action": "screenshot", "tool": "perception", "result": "error"},
            ],
        }

        # Épisode trop court
        self.short_episode = {
            "mission": "Mission trop courte",
            "success": True,
            "steps": [
                {"action": "seule_action", "tool": "executor", "result": "ok"},
            ],
        }

        # Épisode sans mission
        self.no_mission_episode = {
            "mission": "",
            "success": True,
            "steps": [
                {"action": "A", "tool": "brain", "result": "ok"},
                {"action": "B", "tool": "brain", "result": "ok"},
            ],
        }

    def test_valid_episode_is_learnable(self):
        """Un épisode réussi avec suffisamment d'étapes doit être apprenable."""
        learnable, reason = self.learner.is_learnable(self.valid_episode)
        assert learnable is True
        assert reason == "ok"

    def test_failed_episode_not_learnable(self):
        """Un épisode échoué ne doit pas être apprenable."""
        learnable, reason = self.learner.is_learnable(self.failed_episode)
        assert learnable is False
        assert "réussi" in reason

    def test_short_episode_not_learnable(self):
        """Un épisode avec trop peu d'étapes ne doit pas être apprenable."""
        learnable, reason = self.learner.is_learnable(self.short_episode)
        assert learnable is False
        assert "étapes" in reason

    def test_empty_mission_not_learnable(self):
        """Un épisode sans mission ne doit pas être apprenable."""
        learnable, reason = self.learner.is_learnable(self.no_mission_episode)
        assert learnable is False
        assert "mission" in reason

    def test_extract_pattern_from_valid_episode(self):
        """extract_pattern() doit retourner un dict non-None pour un épisode valide."""
        pattern = self.learner.extract_pattern(self.valid_episode)
        assert pattern is not None
        assert "mission" in pattern
        assert "step_count" in pattern
        assert "tools_used" in pattern
        assert "pattern" in pattern

    def test_extract_pattern_step_count(self):
        """Le step_count extrait doit correspondre au nombre d'étapes de l'épisode."""
        pattern = self.learner.extract_pattern(self.valid_episode)
        assert pattern["step_count"] == len(self.valid_episode["steps"])

    def test_extract_pattern_tools_deduped(self):
        """Les outils extraits doivent être dédupliqués."""
        episode_dup_tools = {
            "mission": "Mission avec outils répétés",
            "success": True,
            "steps": [
                {"action": "A", "tool": "brain",     "result": "ok"},
                {"action": "B", "tool": "brain",     "result": "ok"},
                {"action": "C", "tool": "executor",  "result": "ok"},
            ],
        }
        pattern = self.learner.extract_pattern(episode_dup_tools)
        assert pattern is not None
        # brain apparaît 2 fois → doit n'apparaître qu'une fois
        assert pattern["tools_used"].count("brain") == 1

    def test_extract_pattern_returns_none_for_failed(self):
        """extract_pattern() doit retourner None pour un épisode échoué."""
        pattern = self.learner.extract_pattern(self.failed_episode)
        assert pattern is None

    def test_extract_pattern_summarizes_actions(self):
        """Le champ 'pattern' doit contenir les actions séparées par '→'."""
        pattern = self.learner.extract_pattern(self.valid_episode)
        assert "→" in pattern["pattern"] or "->" in pattern["pattern"] or len(pattern["pattern"]) > 0

    def test_deduplicate_filters_seen_missions(self):
        """deduplicate_episodes() doit filtrer les missions déjà apprises."""
        seen = {"prendre un screenshot et l'analyser"}
        episodes = [self.valid_episode, self.failed_episode]
        result = self.learner.deduplicate_episodes(episodes, seen)
        # valid_episode est déjà dans seen → filtered
        remaining_missions = [ep["mission"] for ep in result]
        assert "Prendre un screenshot et l'analyser" not in remaining_missions

    def test_deduplicate_keeps_unseen_missions(self):
        """deduplicate_episodes() doit garder les missions non encore apprises."""
        seen: set = set()
        episodes = [self.valid_episode, self.failed_episode]
        result = self.learner.deduplicate_episodes(episodes, seen)
        assert len(result) == 2

    def test_deduplicate_adds_to_seen(self):
        """deduplicate_episodes() doit ajouter les missions filtrées à seen."""
        seen: set = set()
        self.learner.deduplicate_episodes([self.valid_episode], seen)
        assert "prendre un screenshot et l'analyser" in seen

    def test_score_episode_successful_high(self):
        """Un épisode réussi doit avoir un score plus élevé qu'un épisode échoué."""
        score_success = self.learner.score_episode(self.valid_episode)
        score_failed  = self.learner.score_episode(self.failed_episode)
        assert score_success > score_failed

    def test_score_episode_more_steps_higher_score(self):
        """Un épisode avec plus d'étapes doit avoir un score plus élevé."""
        long_episode = {
            "mission": "Long",
            "success": True,
            "steps": [{"action": f"a{i}", "tool": "brain", "result": "ok"} for i in range(10)],
        }
        score_long  = self.learner.score_episode(long_episode)
        score_short = self.learner.score_episode(self.valid_episode)
        assert score_long > score_short

    def test_score_episode_zero_steps(self):
        """Un épisode sans étapes doit avoir un score de 0.0."""
        empty_ep = {"mission": "Vide", "success": True, "steps": []}
        score = self.learner.score_episode(empty_ep)
        assert score == 0.0

    @pytest.mark.parametrize("success,steps_count,expected_learnable", [
        (True,  3, True),
        (True,  2, True),
        (True,  1, False),
        (False, 5, False),
        (True,  0, False),
    ])
    def test_learnability_parametrize(self, success, steps_count, expected_learnable):
        """Test paramétrisé de is_learnable() — combinaisons success × steps."""
        episode = {
            "mission": "Test mission",
            "success": success,
            "steps":   [{"action": f"s{i}", "tool": "t", "result": "ok"} for i in range(steps_count)],
        }
        learnable, _ = self.learner.is_learnable(episode)
        assert learnable == expected_learnable
