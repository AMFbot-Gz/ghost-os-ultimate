"""
Tests pour agent/optimizer.py — Phase 21 : Self-Optimization Engine.

Couvre :
- Validité syntaxique du fichier
- Présence des endpoints et fonctions principales (analyse statique)
- Tests unitaires sur la logique de cycle scoring et filtrage de gaps (fonctions pures)
"""
import pytest
import sys
import os
import subprocess
from typing import Optional

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
_FILE_PATH = os.path.join(_ROOT, 'agent', 'optimizer.py')


# ─────────────────────────────────────────────────────────────────────────────
# Tests syntaxe (sans import)
# ─────────────────────────────────────────────────────────────────────────────

class TestOptimizerSyntax:
    def test_syntax_valid(self):
        """optimizer.py doit être syntaxiquement valide."""
        result = subprocess.run(
            ['python3', '-m', 'py_compile', _FILE_PATH],
            capture_output=True, text=True
        )
        assert result.returncode == 0, f"Erreur syntaxe optimizer.py:\n{result.stderr}"


# ─────────────────────────────────────────────────────────────────────────────
# Tests de présence des symboles clés (analyse statique)
# ─────────────────────────────────────────────────────────────────────────────

class TestOptimizerStaticAnalysis:
    """Vérifie la présence des fonctions et endpoints attendus dans optimizer.py."""

    @pytest.fixture(autouse=True)
    def read_content(self):
        with open(_FILE_PATH, encoding='utf-8') as f:
            self.content = f.read()

    def test_optimize_endpoint(self):
        """/optimize endpoint doit être présent."""
        assert '"/optimize"' in self.content or "'/optimize'" in self.content

    def test_cycles_endpoint(self):
        """/cycles endpoint doit être présent."""
        assert '"/cycles"' in self.content or "'/cycles'" in self.content

    def test_actions_endpoint(self):
        """/actions endpoint doit être présent."""
        assert '"/actions"' in self.content or "'/actions'" in self.content

    def test_stats_endpoint(self):
        """/stats endpoint doit être présent."""
        assert '"/stats"' in self.content or "'/stats'" in self.content

    def test_health_endpoint(self):
        """/health endpoint doit être présent."""
        assert '"/health"' in self.content or "'/health'" in self.content

    def test_optimization_loop_defined(self):
        """_optimization_loop() doit être définie (boucle périodique)."""
        assert '_optimization_loop' in self.content

    def test_run_optimization_cycle_defined(self):
        """_run_optimization_cycle() doit être définie."""
        assert '_run_optimization_cycle' in self.content

    def test_fetch_top_gaps_defined(self):
        """_fetch_top_gaps() doit être définie (consultation du Miner)."""
        assert '_fetch_top_gaps' in self.content

    def test_generate_skill_defined(self):
        """_generate_skill() doit être définie (appel Evolution)."""
        assert '_generate_skill' in self.content

    def test_validate_skill_defined(self):
        """_validate_skill() doit être définie (appel Validator)."""
        assert '_validate_skill' in self.content

    def test_emit_signal_defined(self):
        """_emit_signal() doit être définie (publication phéromone)."""
        assert '_emit_signal' in self.content

    def test_miner_url_defined(self):
        """MINER_URL doit être défini."""
        assert 'MINER_URL' in self.content

    def test_evolution_url_defined(self):
        """EVOLUTION_URL doit être défini."""
        assert 'EVOLUTION_URL' in self.content

    def test_validator_url_defined(self):
        """VALIDATOR_URL doit être défini."""
        assert 'VALIDATOR_URL' in self.content

    def test_loop_interval_defined(self):
        """LOOP_INTERVAL_S doit être défini."""
        assert 'LOOP_INTERVAL_S' in self.content

    def test_gap_min_score_defined(self):
        """GAP_MIN_SCORE doit être défini (filtre des gaps significatifs)."""
        assert 'GAP_MIN_SCORE' in self.content

    def test_deploy_tiers_defined(self):
        """DEPLOY_TIERS doit être défini (gold + silver)."""
        assert 'DEPLOY_TIERS' in self.content

    def test_sqlite_cycles_table(self):
        """La table 'cycles' doit être créée dans le schéma SQLite."""
        assert 'cycles' in self.content

    def test_sqlite_actions_table(self):
        """La table 'actions' doit être créée dans le schéma SQLite."""
        assert 'actions' in self.content

    def test_fastapi_app_defined(self):
        """FastAPI app doit être instanciée."""
        assert 'FastAPI(' in self.content

    def test_httpx_imported(self):
        """httpx doit être importé (appels vers Miner, Evolution, Validator)."""
        assert 'import httpx' in self.content


# ─────────────────────────────────────────────────────────────────────────────
# Logique inline de filtrage et scoring de gaps (fonctions pures)
# ─────────────────────────────────────────────────────────────────────────────

class _OptimizerCycleLogic:
    """
    Miroir inline de la logique de filtrage et de décision du cycle optimizer.
    Fonctions pures — sans HTTP, SQLite ou filesystem.
    """

    GAP_MIN_SCORE  = 1.5
    DEPLOY_TIERS   = {"gold", "silver"}
    QUARANTINE_TIER = "quarantine"

    def filter_significant_gaps(self, gaps: list) -> list:
        """Filtre les gaps dont gap_score >= GAP_MIN_SCORE."""
        return [g for g in gaps if g.get("gap_score", 0) >= self.GAP_MIN_SCORE]

    def should_deploy(self, tier: str) -> bool:
        """Retourne True si le tier qualifie pour le déploiement automatique."""
        return tier in self.DEPLOY_TIERS

    def should_quarantine(self, tier: str) -> bool:
        """Retourne True si le skill doit être mis en quarantaine."""
        return tier == self.QUARANTINE_TIER

    def action_status(self, tier: str) -> str:
        """Détermine le statut d'une action selon le tier de validation."""
        if tier in self.DEPLOY_TIERS:
            return "deployed"
        if tier == self.QUARANTINE_TIER:
            return "quarantined"
        return "failed"

    def normalize_skill_name(self, pattern: str, max_len: int = 30) -> str:
        """Normalise un pattern en nom de skill valide."""
        import re
        return re.sub(r"[^a-z0-9_]", "_", pattern.lower())[:max_len].strip("_")

    def compute_cycle_summary(self, actions: list) -> dict:
        """
        Calcule le résumé d'un cycle à partir de la liste des actions.
        Retourne: gaps_found, skills_gen, skills_pass, skills_fail.
        """
        gaps_found  = len(actions)
        skills_gen  = sum(1 for a in actions if a.get("status") not in ("skipped", "gen_failed"))
        skills_pass = sum(1 for a in actions if a.get("status") == "deployed")
        skills_fail = sum(1 for a in actions if a.get("status") in ("failed", "quarantined", "gen_failed"))
        return {
            "gaps_found":  gaps_found,
            "skills_gen":  skills_gen,
            "skills_pass": skills_pass,
            "skills_fail": skills_fail,
        }

    def compute_deploy_rate(self, actions: list) -> float:
        """Taux de déploiement : skills déployés / total actions (hors skipped)."""
        relevant = [a for a in actions if a.get("status") != "skipped"]
        if not relevant:
            return 0.0
        deployed = sum(1 for a in relevant if a.get("status") == "deployed")
        return round(deployed / len(relevant), 3)

    def skill_already_covered(self, candidate: str, existing: set) -> bool:
        """Retourne True si le candidate skill est déjà dans l'ensemble des skills."""
        return candidate in existing or any(candidate in s for s in existing)

    def avg_confidence(self, actions: list) -> float:
        """Calcule la confiance moyenne sur les actions avec un score."""
        vals = [a.get("confidence") for a in actions if a.get("confidence") is not None]
        if not vals:
            return 0.0
        return round(sum(vals) / len(vals), 3)


class TestOptimizerCycleLogic:
    """Teste la logique pure du cycle d'optimisation."""

    @pytest.fixture(autouse=True)
    def setup(self):
        self.logic = _OptimizerCycleLogic()

    # --- filter_significant_gaps ---

    def test_filter_keeps_above_threshold(self):
        """Les gaps au-dessus du seuil doivent être conservés."""
        gaps = [{"gap_score": 2.0}, {"gap_score": 1.5}, {"gap_score": 0.5}]
        result = self.logic.filter_significant_gaps(gaps)
        assert len(result) == 2
        assert all(g["gap_score"] >= 1.5 for g in result)

    def test_filter_excludes_below_threshold(self):
        """Les gaps en-dessous du seuil doivent être filtrés."""
        gaps = [{"gap_score": 0.3}, {"gap_score": 1.4}]
        result = self.logic.filter_significant_gaps(gaps)
        assert len(result) == 0

    def test_filter_exact_threshold_included(self):
        """Un gap exactement égal au seuil doit être conservé (>=)."""
        gaps = [{"gap_score": 1.5}]
        result = self.logic.filter_significant_gaps(gaps)
        assert len(result) == 1

    def test_filter_empty_list(self):
        """Filtrer une liste vide retourne une liste vide."""
        assert self.logic.filter_significant_gaps([]) == []

    # --- should_deploy ---

    def test_gold_tier_deploys(self):
        """Le tier gold doit déclencher le déploiement."""
        assert self.logic.should_deploy("gold") is True

    def test_silver_tier_deploys(self):
        """Le tier silver doit déclencher le déploiement."""
        assert self.logic.should_deploy("silver") is True

    def test_bronze_tier_not_deploy(self):
        """Le tier bronze ne doit pas déclencher le déploiement auto."""
        assert self.logic.should_deploy("bronze") is False

    def test_quarantine_tier_not_deploy(self):
        """Le tier quarantine ne doit pas déclencher le déploiement."""
        assert self.logic.should_deploy("quarantine") is False

    # --- action_status ---

    def test_action_status_gold(self):
        assert self.logic.action_status("gold") == "deployed"

    def test_action_status_silver(self):
        assert self.logic.action_status("silver") == "deployed"

    def test_action_status_bronze(self):
        assert self.logic.action_status("bronze") == "failed"

    def test_action_status_quarantine(self):
        assert self.logic.action_status("quarantine") == "quarantined"

    # --- normalize_skill_name ---

    def test_normalize_lowercase(self):
        """Le nom normalisé doit être en minuscules."""
        name = self.logic.normalize_skill_name("ClickButton")
        assert name == name.lower()

    def test_normalize_spaces_replaced(self):
        """Les espaces doivent être remplacés par des underscores."""
        name = self.logic.normalize_skill_name("click safari button")
        assert " " not in name

    def test_normalize_max_length(self):
        """Le nom normalisé ne doit pas dépasser max_len."""
        name = self.logic.normalize_skill_name("a" * 100, max_len=30)
        assert len(name) <= 30

    def test_normalize_special_chars(self):
        """Les caractères spéciaux doivent être remplacés par _."""
        name = self.logic.normalize_skill_name("open-browser@url!")
        assert all(c.isalnum() or c == "_" for c in name)

    # --- compute_cycle_summary ---

    def test_summary_correct_counts(self):
        """compute_cycle_summary() doit compter correctement les statuts."""
        actions = [
            {"status": "deployed"},
            {"status": "deployed"},
            {"status": "quarantined"},
            {"status": "gen_failed"},
            {"status": "skipped"},
        ]
        summary = self.logic.compute_cycle_summary(actions)
        assert summary["gaps_found"]  == 5
        assert summary["skills_pass"] == 2
        assert summary["skills_fail"] == 2   # quarantined + gen_failed

    def test_summary_empty(self):
        """Un cycle vide doit avoir tous les compteurs à 0."""
        s = self.logic.compute_cycle_summary([])
        assert s == {"gaps_found": 0, "skills_gen": 0, "skills_pass": 0, "skills_fail": 0}

    # --- compute_deploy_rate ---

    def test_deploy_rate_all_deployed(self):
        """Taux = 1.0 si tout est déployé."""
        actions = [{"status": "deployed"}, {"status": "deployed"}]
        assert self.logic.compute_deploy_rate(actions) == 1.0

    def test_deploy_rate_none_deployed(self):
        """Taux = 0.0 si rien n'est déployé."""
        actions = [{"status": "failed"}, {"status": "quarantined"}]
        assert self.logic.compute_deploy_rate(actions) == 0.0

    def test_deploy_rate_skipped_excluded(self):
        """Les actions 'skipped' ne comptent pas dans le dénominateur."""
        actions = [
            {"status": "deployed"},
            {"status": "skipped"},
            {"status": "skipped"},
        ]
        assert self.logic.compute_deploy_rate(actions) == 1.0

    def test_deploy_rate_empty_gives_zero(self):
        """Taux = 0.0 si aucune action non-skipped."""
        assert self.logic.compute_deploy_rate([]) == 0.0

    # --- skill_already_covered ---

    def test_exact_match_covered(self):
        """Un skill avec le même nom exact doit être considéré couvert."""
        assert self.logic.skill_already_covered("click_safari", {"click_safari", "open_browser"})

    def test_substring_match_covered(self):
        """Un skill qui est une sous-chaîne d'un existant doit être considéré couvert."""
        assert self.logic.skill_already_covered("click", {"click_safari_navigate"})

    def test_no_match_not_covered(self):
        """Un skill sans correspondance ne doit pas être considéré couvert."""
        assert not self.logic.skill_already_covered("upload_file", {"click_button", "scroll_page"})

    def test_empty_existing_not_covered(self):
        """Avec un ensemble vide, aucun skill ne peut être couvert."""
        assert not self.logic.skill_already_covered("any_skill", set())

    # --- avg_confidence ---

    def test_avg_confidence_basic(self):
        """avg_confidence() doit calculer la moyenne correctement."""
        actions = [{"confidence": 0.9}, {"confidence": 0.7}, {"confidence": 0.5}]
        avg = self.logic.avg_confidence(actions)
        assert abs(avg - round((0.9 + 0.7 + 0.5) / 3, 3)) < 0.001

    def test_avg_confidence_ignores_none(self):
        """avg_confidence() doit ignorer les actions sans confidence."""
        actions = [{"confidence": 1.0}, {"confidence": None}, {"status": "gen_failed"}]
        avg = self.logic.avg_confidence(actions)
        assert avg == 1.0

    def test_avg_confidence_empty_gives_zero(self):
        """avg_confidence() avec liste vide doit retourner 0.0."""
        assert self.logic.avg_confidence([]) == 0.0

    # --- Scénario bout-en-bout ---

    @pytest.mark.parametrize("tier,expected_status,should_deploy", [
        ("gold",       "deployed",    True),
        ("silver",     "deployed",    True),
        ("bronze",     "failed",      False),
        ("quarantine", "quarantined", False),
        ("error",      "failed",      False),
    ])
    def test_end_to_end_tier_routing(self, tier, expected_status, should_deploy):
        """Test paramétrisé : tier → statut d'action attendu."""
        assert self.logic.action_status(tier) == expected_status
        assert self.logic.should_deploy(tier) == should_deploy
