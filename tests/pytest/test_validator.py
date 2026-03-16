"""
Tests pour agent/validator.py.

Couvre :
- Validité syntaxique du fichier
- Présence des endpoints et fonctions principales (analyse statique)
- Tests unitaires sur la logique de scoring de confiance (inline, sans import)
"""
import pytest
import sys
import os
import subprocess

_ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
_FILE_PATH = os.path.join(_ROOT, 'agent', 'validator.py')


# ─────────────────────────────────────────────────────────────────────────────
# Tests syntaxe (sans import)
# ─────────────────────────────────────────────────────────────────────────────

class TestValidatorSyntax:
    def test_syntax_valid(self):
        """validator.py doit être syntaxiquement valide."""
        result = subprocess.run(
            ['python3', '-m', 'py_compile', _FILE_PATH],
            capture_output=True, text=True
        )
        assert result.returncode == 0, f"Erreur syntaxe validator.py:\n{result.stderr}"


# ─────────────────────────────────────────────────────────────────────────────
# Tests de présence des symboles clés (analyse statique)
# ─────────────────────────────────────────────────────────────────────────────

class TestValidatorStaticAnalysis:
    """Vérifie la présence des fonctions et endpoints attendus dans validator.py."""

    @pytest.fixture(autouse=True)
    def read_content(self):
        with open(_FILE_PATH, encoding='utf-8') as f:
            self.content = f.read()

    def test_validate_endpoint(self):
        """/validate endpoint doit être présent."""
        assert '"/validate"' in self.content or "'/validate'" in self.content

    def test_quarantine_endpoint(self):
        """/quarantine endpoint doit être présent."""
        assert '"/quarantine"' in self.content or "'/quarantine'" in self.content

    def test_check_weights_defined(self):
        """CHECK_WEIGHTS doit être défini."""
        assert 'CHECK_WEIGHTS' in self.content

    def test_compute_confidence_defined(self):
        """_compute_confidence() doit être défini."""
        assert '_compute_confidence' in self.content

    def test_confidence_tier_defined(self):
        """_confidence_tier() doit être défini."""
        assert '_confidence_tier' in self.content

    def test_fastapi_app_defined(self):
        """FastAPI app doit être instanciée."""
        assert 'FastAPI(' in self.content

    def test_httpx_imported(self):
        """httpx doit être importé (appels réseau)."""
        assert 'import httpx' in self.content

    def test_security_weight_present(self):
        """Le poids 'security' doit être défini dans CHECK_WEIGHTS."""
        assert '"security"' in self.content or "'security'" in self.content

    def test_gold_tier_present(self):
        """Le tier 'gold' doit être référencé."""
        assert '"gold"' in self.content or "'gold'" in self.content

    def test_quarantine_tier_present(self):
        """Le tier 'quarantine' doit être référencé."""
        assert '"quarantine"' in self.content or "'quarantine'" in self.content


# ─────────────────────────────────────────────────────────────────────────────
# Logique inline de scoring de confiance (reproduit validator.py)
# ─────────────────────────────────────────────────────────────────────────────

CHECK_WEIGHTS = {
    "security":  0.30,
    "execution": 0.28,
    "syntax":    0.18,
    "output":    0.14,
    "structure": 0.10,
}

TIER_THRESHOLDS = {"gold": 0.85, "silver": 0.65, "bronze": 0.40}


def _score_check(name, result):
    if result.get("skipped"):
        return 0.5
    passed = result.get("passed", False)
    if name in ("security", "syntax", "structure"):
        return 1.0 if passed else 0.0
    if name == "execution":
        if passed:
            return 1.0
        detail = result.get("detail", "").lower()
        if "timeout" in detail:
            return 0.0
        if "exit code" in detail:
            return 0.10
        return 0.20
    if name == "output":
        return 1.0 if passed else 0.0
    return 1.0 if passed else 0.0


def _compute_confidence(checks):
    if not checks.get("security", {}).get("passed") and not checks.get("security", {}).get("skipped"):
        return 0.0
    total_w = sum(CHECK_WEIGHTS.values())
    return sum(CHECK_WEIGHTS.get(n, 0) * _score_check(n, r) for n, r in checks.items()) / total_w


def _tier(score):
    if score >= 0.85:
        return "gold"
    if score >= 0.65:
        return "silver"
    if score >= 0.40:
        return "bronze"
    return "quarantine"


# ─────────────────────────────────────────────────────────────────────────────
# Tests logique de confiance (inline, sans import)
# ─────────────────────────────────────────────────────────────────────────────

class TestValidatorConfidenceLogic:
    """Teste la logique inline de scoring de confiance — aucun import du module."""

    def test_all_checks_pass_gives_gold(self):
        """Tous les checks passés → tier gold (score ≥ 0.85)."""
        checks = {
            "security":  {"passed": True},
            "execution": {"passed": True},
            "syntax":    {"passed": True},
            "output":    {"passed": True},
            "structure": {"passed": True},
        }
        score = _compute_confidence(checks)
        assert score >= 0.85
        assert _tier(score) == "gold"

    def test_security_fail_gives_zero(self):
        """Security fail → confidence = 0.0 → quarantine."""
        checks = {
            "security":  {"passed": False},
            "execution": {"passed": True},
            "syntax":    {"passed": True},
            "output":    {"passed": True},
            "structure": {"passed": True},
        }
        score = _compute_confidence(checks)
        assert score == 0.0
        assert _tier(score) == "quarantine"

    def test_execution_timeout_reduces_confidence(self):
        """Execution timeout (score=0.0) doit réduire significativement la confiance."""
        checks_ok = {
            "security":  {"passed": True},
            "execution": {"passed": True},
            "syntax":    {"passed": True},
            "output":    {"passed": True},
            "structure": {"passed": True},
        }
        checks_timeout = {
            "security":  {"passed": True},
            "execution": {"passed": False, "detail": "timeout after 30s"},
            "syntax":    {"passed": True},
            "output":    {"passed": True},
            "structure": {"passed": True},
        }
        score_ok = _compute_confidence(checks_ok)
        score_timeout = _compute_confidence(checks_timeout)
        # Timeout doit réduire la confiance par rapport à tout OK
        assert score_timeout < score_ok
        # La pénalité doit être significative (poids execution = 0.28)
        assert score_ok - score_timeout > 0.2

    def test_skipped_check_returns_half_score(self):
        """Un check skipped doit retourner un score de 0.5."""
        assert _score_check("execution", {"skipped": True}) == 0.5
        assert _score_check("security", {"skipped": True}) == 0.5
        assert _score_check("syntax", {"skipped": True}) == 0.5

    def test_security_skipped_not_zero(self):
        """Security skipped (pas failed) ne doit pas forcer confidence à 0."""
        checks = {
            "security":  {"skipped": True},
            "execution": {"passed": True},
            "syntax":    {"passed": True},
            "output":    {"passed": True},
            "structure": {"passed": True},
        }
        score = _compute_confidence(checks)
        assert score > 0.0

    def test_execution_exit_code_partial_score(self):
        """Execution avec 'exit code' dans detail doit scorer 0.10."""
        assert _score_check("execution", {"passed": False, "detail": "exit code 1"}) == 0.10

    def test_execution_other_failure_partial_score(self):
        """Execution failure sans timeout ni exit code doit scorer 0.20."""
        assert _score_check("execution", {"passed": False, "detail": "unknown error"}) == 0.20

    def test_check_weights_sum_to_one(self):
        """La somme des poids de CHECK_WEIGHTS doit être égale à 1.0."""
        total = sum(CHECK_WEIGHTS.values())
        assert abs(total - 1.0) < 1e-9

    @pytest.mark.parametrize("score,expected_tier", [
        (0.86, "gold"),
        (0.85, "gold"),
        (0.70, "silver"),
        (0.65, "silver"),
        (0.50, "bronze"),
        (0.40, "bronze"),
        (0.30, "quarantine"),
        (0.00, "quarantine"),
    ])
    def test_tier_thresholds_parametrize(self, score, expected_tier):
        """Test paramétrisé des seuils de tier."""
        result = _tier(score)
        assert result == expected_tier, (
            f"_tier({score}) retourné {result!r}, attendu {expected_tier!r}"
        )

    @pytest.mark.parametrize("check_name,result_dict,expected_score", [
        ("security",  {"passed": True},  1.0),
        ("security",  {"passed": False}, 0.0),
        ("syntax",    {"passed": True},  1.0),
        ("syntax",    {"passed": False}, 0.0),
        ("structure", {"passed": True},  1.0),
        ("structure", {"passed": False}, 0.0),
        ("output",    {"passed": True},  1.0),
        ("output",    {"passed": False}, 0.0),
        ("execution", {"passed": True},  1.0),
        ("execution", {"passed": False, "detail": "timeout"}, 0.0),
        ("execution", {"passed": False, "detail": "exit code 1"}, 0.10),
        ("execution", {"passed": False, "detail": "error"}, 0.20),
        ("security",  {"skipped": True}, 0.5),
    ])
    def test_score_check_parametrize(self, check_name, result_dict, expected_score):
        """Test paramétrisé de _score_check() pour toutes les combinaisons."""
        result = _score_check(check_name, result_dict)
        assert result == expected_score, (
            f"_score_check({check_name!r}, {result_dict}) retourné {result}, attendu {expected_score}"
        )
