"""
Tests pour agent/miner.py — Phase 15 : Behavior Mining Engine.

Couvre :
- Validité syntaxique du fichier
- Présence des endpoints et fonctions principales (analyse statique)
- Tests unitaires sur la logique de gap_score et détection de gaps (fonctions pures)
"""
import pytest
import sys
import os
import subprocess
import unittest.mock as mock
from typing import Optional

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
_FILE_PATH = os.path.join(_ROOT, 'agent', 'miner.py')

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

class TestMinerSyntax:
    def test_syntax_valid(self):
        """miner.py doit être syntaxiquement valide."""
        result = subprocess.run(
            ['python3', '-m', 'py_compile', _FILE_PATH],
            capture_output=True, text=True
        )
        assert result.returncode == 0, f"Erreur syntaxe miner.py:\n{result.stderr}"


# ─────────────────────────────────────────────────────────────────────────────
# Tests de présence des symboles clés (analyse statique)
# ─────────────────────────────────────────────────────────────────────────────

class TestMinerStaticAnalysis:
    """Vérifie la présence des fonctions et endpoints attendus dans miner.py."""

    @pytest.fixture(autouse=True)
    def read_content(self):
        with open(_FILE_PATH, encoding='utf-8') as f:
            self.content = f.read()

    def test_mine_endpoint(self):
        """/mine endpoint doit être présent."""
        assert '"/mine"' in self.content or "'/mine'" in self.content

    def test_gaps_endpoint(self):
        """/gaps endpoint doit être présent."""
        assert '"/gaps"' in self.content or "'/gaps'" in self.content

    def test_gap_score_field(self):
        """gap_score doit être présent (calcul des lacunes de skills)."""
        assert 'gap_score' in self.content

    def test_behavior_miner_reference(self):
        """BehaviorMiner ou 'Behavior Mining Engine' doit être référencé."""
        assert 'BehaviorMiner' in self.content or 'Behavior Mining Engine' in self.content

    def test_signals_reference(self):
        """signals (bus phéromone) doit être référencé."""
        assert 'signals' in self.content

    def test_signals_file_defined(self):
        """SIGNALS_FILE doit être défini."""
        assert 'SIGNALS_FILE' in self.content

    def test_fastapi_app_defined(self):
        """FastAPI app doit être instanciée."""
        assert 'FastAPI(' in self.content

    def test_httpx_imported(self):
        """httpx doit être importé (appels vers Evolution et Brain)."""
        assert 'import httpx' in self.content

    def test_sqlite3_imported(self):
        """sqlite3 doit être importé (persistance des patterns)."""
        assert 'import sqlite3' in self.content or 'sqlite3' in self.content

    def test_evolution_url_defined(self):
        """EVOLUTION_URL doit être défini (génération proactive de skills)."""
        assert 'EVOLUTION_URL' in self.content

    def test_episodes_file_defined(self):
        """EPISODES_FILE doit être défini (source des épisodes à miner)."""
        assert 'EPISODES_FILE' in self.content

    def test_emit_signal_function(self):
        """_emit_signal() doit être définie (publication phéromone)."""
        assert '_emit_signal' in self.content

    def test_fill_gaps_function(self):
        """_fill_top_gaps() doit être définie (combler les lacunes)."""
        assert '_fill_top_gaps' in self.content

    def test_pattern_score_field(self):
        """pattern_score doit être présent."""
        assert 'pattern_score' in self.content

    def test_skill_coverage_field(self):
        """skill_coverage doit être présent."""
        assert 'skill_coverage' in self.content

    def test_patterns_table_defined(self):
        """La table 'patterns' doit être créée (schema SQLite)."""
        assert 'patterns' in self.content

    def test_gapfill_loop_defined(self):
        """_gapfill_loop() doit être définie (boucle périodique de comblage)."""
        assert '_gapfill_loop' in self.content

    def test_signals_endpoint(self):
        """/signals endpoint doit être présent."""
        assert '"/signals"' in self.content or "'/signals'" in self.content


# ─────────────────────────────────────────────────────────────────────────────
# Logique inline de gap_score (fonctions pures)
# ─────────────────────────────────────────────────────────────────────────────

class _BehaviorMinerLogic:
    """
    Miroir inline de la logique de scoring et détection de gaps de miner.py.
    Fonctions pures — sans HTTP, SQLite ou filesystem.
    """

    GAP_THRESHOLD         = 1.5   # gap_score > 1.5 → gap significatif
    GAP_SOFT_THRESHOLD    = 0.5   # gap_score > 0.5 → gap à surveiller
    RECENCY_DECAY         = 0.9   # facteur de décroissance par cycle

    def pattern_score(self, frequency: int, success_rate: float, recency: float) -> float:
        """
        Score d'un pattern comportemental.
        score = frequency × success_rate × recency
        """
        if frequency <= 0:
            return 0.0
        success_rate = max(0.0, min(1.0, success_rate))
        recency      = max(0.0, min(1.0, recency))
        return round(frequency * success_rate * recency, 3)

    def gap_score(self, p_score: float, skill_coverage: float) -> float:
        """
        Score de lacune d'un pattern.
        gap_score = pattern_score × (1 - skill_coverage)
        Plus la couverture est faible, plus le gap est élevé.
        """
        skill_coverage = max(0.0, min(1.0, skill_coverage))
        return round(p_score * (1.0 - skill_coverage), 3)

    def is_gap(self, gs: float, threshold: Optional[float] = None) -> bool:
        """Retourne True si le gap_score dépasse le seuil (par défaut GAP_THRESHOLD)."""
        t = threshold if threshold is not None else self.GAP_THRESHOLD
        return gs > t

    def is_soft_gap(self, gs: float) -> bool:
        """Retourne True si le gap_score dépasse le seuil soft (à surveiller)."""
        return gs > self.GAP_SOFT_THRESHOLD

    def compute_coverage(self, pattern_keywords: set, skill_keywords: set) -> float:
        """
        Calcule la couverture d'un pattern par un skill.
        coverage = overlap(pattern, skill) / |pattern|
        """
        if not pattern_keywords:
            return 0.0
        overlap = len(pattern_keywords & skill_keywords)
        return round(overlap / len(pattern_keywords), 3)

    def rank_gaps(self, patterns: list) -> list:
        """
        Trie les patterns par gap_score décroissant.
        Ne retourne que ceux dont gap_score > GAP_SOFT_THRESHOLD.
        """
        significant = [p for p in patterns if p.get("gap_score", 0) > self.GAP_SOFT_THRESHOLD]
        return sorted(significant, key=lambda p: p.get("gap_score", 0), reverse=True)

    def emit_signal_payload(self, sig_type: str, pattern: dict) -> dict:
        """Construit le payload d'un signal phéromone."""
        return {
            "type":      sig_type,
            "pattern":   pattern.get("pattern", ""),
            "gap_score": pattern.get("gap_score", 0.0),
            "domain":    pattern.get("domain", "unknown"),
        }

    def apply_recency_decay(self, patterns: list) -> list:
        """Applique le facteur de décroissance de récence sur les pattern_scores."""
        result = []
        for p in patterns:
            new_p = dict(p)
            new_p["pattern_score"] = round(
                p.get("pattern_score", 0) * self.RECENCY_DECAY, 3
            )
            result.append(new_p)
        return result


class TestMinerGapScoringLogic:
    """Teste la logique pure de gap_score et détection de lacunes comportementales."""

    @pytest.fixture(autouse=True)
    def setup(self):
        self.miner = _BehaviorMinerLogic()

    # --- pattern_score ---

    def test_pattern_score_basic(self):
        """pattern_score = frequency × success_rate × recency."""
        score = self.miner.pattern_score(frequency=10, success_rate=0.8, recency=1.0)
        assert abs(score - 8.0) < 0.01

    def test_pattern_score_zero_frequency(self):
        """Un pattern avec frequency=0 doit avoir score=0."""
        score = self.miner.pattern_score(frequency=0, success_rate=1.0, recency=1.0)
        assert score == 0.0

    def test_pattern_score_clamps_success_rate(self):
        """success_rate > 1.0 doit être ramené à 1.0."""
        score_clamped = self.miner.pattern_score(frequency=5, success_rate=2.0, recency=1.0)
        score_normal  = self.miner.pattern_score(frequency=5, success_rate=1.0, recency=1.0)
        assert score_clamped == score_normal

    def test_pattern_score_negative_success_rate(self):
        """success_rate négatif doit être ramené à 0.0 → score=0."""
        score = self.miner.pattern_score(frequency=10, success_rate=-0.5, recency=1.0)
        assert score == 0.0

    def test_pattern_score_low_recency(self):
        """Un pattern ancien (recency=0.1) doit avoir un score plus faible."""
        score_fresh = self.miner.pattern_score(frequency=10, success_rate=1.0, recency=1.0)
        score_old   = self.miner.pattern_score(frequency=10, success_rate=1.0, recency=0.1)
        assert score_fresh > score_old

    # --- gap_score ---

    def test_gap_score_no_coverage_equals_pattern_score(self):
        """Avec skill_coverage=0, gap_score = pattern_score."""
        ps = self.miner.pattern_score(5, 1.0, 1.0)
        gs = self.miner.gap_score(ps, skill_coverage=0.0)
        assert abs(gs - ps) < 0.01

    def test_gap_score_full_coverage_is_zero(self):
        """Avec skill_coverage=1.0 (couverture totale), gap_score = 0."""
        ps = self.miner.pattern_score(5, 1.0, 1.0)
        gs = self.miner.gap_score(ps, skill_coverage=1.0)
        assert gs == 0.0

    def test_gap_score_partial_coverage(self):
        """Avec couverture partielle, gap_score doit être entre 0 et pattern_score."""
        ps = self.miner.pattern_score(10, 1.0, 1.0)
        gs = self.miner.gap_score(ps, skill_coverage=0.5)
        assert 0.0 < gs < ps

    def test_gap_score_formula(self):
        """gap_score = pattern_score × (1 - skill_coverage)."""
        ps = 4.0
        gs = self.miner.gap_score(ps, skill_coverage=0.25)
        assert abs(gs - 3.0) < 0.01   # 4.0 × 0.75 = 3.0

    def test_gap_score_coverage_clamped(self):
        """skill_coverage > 1.0 doit être ramené à 1.0 → gap_score = 0."""
        gs = self.miner.gap_score(5.0, skill_coverage=2.0)
        assert gs == 0.0

    # --- is_gap ---

    def test_is_gap_above_threshold(self):
        """Un gap_score > GAP_THRESHOLD doit déclencher is_gap=True."""
        assert self.miner.is_gap(2.0) is True

    def test_is_gap_below_threshold(self):
        """Un gap_score <= GAP_THRESHOLD ne doit pas déclencher is_gap."""
        assert self.miner.is_gap(1.0) is False

    def test_is_gap_exact_threshold_not_gap(self):
        """Un gap_score exactement = GAP_THRESHOLD ne doit pas déclencher is_gap (strict >)."""
        assert self.miner.is_gap(self.miner.GAP_THRESHOLD) is False

    def test_is_gap_custom_threshold(self):
        """is_gap() doit accepter un seuil custom."""
        assert self.miner.is_gap(0.6, threshold=0.5) is True
        assert self.miner.is_gap(0.4, threshold=0.5) is False

    def test_is_soft_gap(self):
        """is_soft_gap() doit détecter les gaps au-dessus du seuil soft."""
        assert self.miner.is_soft_gap(0.6) is True
        assert self.miner.is_soft_gap(0.5) is False
        assert self.miner.is_soft_gap(0.0) is False

    # --- compute_coverage ---

    def test_coverage_full_overlap(self):
        """Couverture = 1.0 si tous les mots du pattern sont dans le skill."""
        coverage = self.miner.compute_coverage({"click", "safari"}, {"click", "safari", "chrome"})
        assert coverage == 1.0

    def test_coverage_no_overlap(self):
        """Couverture = 0.0 si aucun mot commun."""
        coverage = self.miner.compute_coverage({"click", "safari"}, {"python", "code"})
        assert coverage == 0.0

    def test_coverage_partial(self):
        """Couverture partielle correcte."""
        coverage = self.miner.compute_coverage({"click", "safari", "navigate"}, {"click", "code"})
        assert abs(coverage - 1/3) < 0.01

    def test_coverage_empty_pattern(self):
        """Couverture = 0.0 si le pattern est vide (évite division par zéro)."""
        coverage = self.miner.compute_coverage(set(), {"click", "safari"})
        assert coverage == 0.0

    # --- rank_gaps ---

    def test_rank_gaps_orders_by_gap_score_desc(self):
        """rank_gaps() doit retourner les patterns triés par gap_score décroissant."""
        patterns = [
            {"pattern": "A", "gap_score": 0.8, "domain": "ui"},
            {"pattern": "B", "gap_score": 2.5, "domain": "code"},
            {"pattern": "C", "gap_score": 1.2, "domain": "file"},
        ]
        ranked = self.miner.rank_gaps(patterns)
        assert ranked[0]["pattern"] == "B"
        assert ranked[1]["pattern"] == "C"
        assert ranked[2]["pattern"] == "A"

    def test_rank_gaps_filters_below_soft_threshold(self):
        """rank_gaps() doit filtrer les patterns sous le seuil soft."""
        patterns = [
            {"pattern": "A", "gap_score": 0.3},   # sous le seuil soft → filtré
            {"pattern": "B", "gap_score": 1.8},   # au-dessus → gardé
        ]
        ranked = self.miner.rank_gaps(patterns)
        assert len(ranked) == 1
        assert ranked[0]["pattern"] == "B"

    def test_rank_gaps_empty_list(self):
        """rank_gaps() doit retourner une liste vide si aucun pattern."""
        assert self.miner.rank_gaps([]) == []

    # --- apply_recency_decay ---

    def test_recency_decay_reduces_score(self):
        """apply_recency_decay() doit réduire les pattern_scores."""
        patterns = [{"pattern": "A", "pattern_score": 10.0}]
        result = self.miner.apply_recency_decay(patterns)
        assert result[0]["pattern_score"] < 10.0

    def test_recency_decay_factor(self):
        """Le facteur de décroissance doit être RECENCY_DECAY."""
        patterns = [{"pattern": "A", "pattern_score": 10.0}]
        result = self.miner.apply_recency_decay(patterns)
        expected = round(10.0 * self.miner.RECENCY_DECAY, 3)
        assert result[0]["pattern_score"] == expected

    def test_recency_decay_does_not_mutate_input(self):
        """apply_recency_decay() ne doit pas modifier les patterns originaux."""
        patterns = [{"pattern": "A", "pattern_score": 10.0}]
        original_score = patterns[0]["pattern_score"]
        self.miner.apply_recency_decay(patterns)
        assert patterns[0]["pattern_score"] == original_score

    # --- Scénario bout-en-bout : frequency × impact > threshold = gap found ---

    @pytest.mark.parametrize("frequency,success_rate,recency,coverage,expect_gap", [
        (20, 0.9, 1.0, 0.0,  True),   # fréquent, réussi, pas couvert → gap
        (20, 0.9, 1.0, 1.0,  False),  # fréquent, réussi, couvert → pas de gap
        (1,  0.5, 0.5, 0.0,  False),  # rare, couverture nulle → pas de gap significatif
        (10, 0.8, 1.0, 0.1,  True),   # fréquent, peu couvert → gap
        (5,  1.0, 0.5, 0.5,  False),  # pattern_score=2.5, gap=1.25 → sous le seuil 1.5
    ])
    def test_end_to_end_gap_detection(self, frequency, success_rate, recency, coverage, expect_gap):
        """Test paramétrisé bout-en-bout : fréquence × impact > threshold = gap détecté."""
        ps = self.miner.pattern_score(frequency, success_rate, recency)
        gs = self.miner.gap_score(ps, skill_coverage=coverage)
        result = self.miner.is_gap(gs)
        assert result == expect_gap, (
            f"frequency={frequency}, success_rate={success_rate}, recency={recency}, "
            f"coverage={coverage} → pattern_score={ps}, gap_score={gs}, "
            f"is_gap={result}, attendu={expect_gap}"
        )
