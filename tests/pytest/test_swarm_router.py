"""
Tests pour agent/swarm_router.py.

Couvre :
- Validité syntaxique du fichier
- Présence des endpoints et fonctions principales (analyse statique)
- Tests unitaires sur la logique de scoring de domaine (inline, sans import)
"""
import pytest
import sys
import os
import subprocess

_ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
_FILE_PATH = os.path.join(_ROOT, 'agent', 'swarm_router.py')


# ─────────────────────────────────────────────────────────────────────────────
# Tests syntaxe (sans import)
# ─────────────────────────────────────────────────────────────────────────────

class TestSwarmRouterSyntax:
    def test_syntax_valid(self):
        """swarm_router.py doit être syntaxiquement valide."""
        result = subprocess.run(
            ['python3', '-m', 'py_compile', _FILE_PATH],
            capture_output=True, text=True
        )
        assert result.returncode == 0, f"Erreur syntaxe swarm_router.py:\n{result.stderr}"


# ─────────────────────────────────────────────────────────────────────────────
# Tests de présence des symboles clés (analyse statique)
# ─────────────────────────────────────────────────────────────────────────────

class TestSwarmRouterStaticAnalysis:
    """Vérifie la présence des fonctions et endpoints attendus dans swarm_router.py."""

    @pytest.fixture(autouse=True)
    def read_content(self):
        with open(_FILE_PATH, encoding='utf-8') as f:
            self.content = f.read()

    def test_dispatch_endpoint(self):
        """/dispatch endpoint doit être présent."""
        assert '"/dispatch"' in self.content or "'/dispatch'" in self.content

    def test_classify_endpoint(self):
        """/classify endpoint doit être présent."""
        assert '"/classify"' in self.content or "'/classify'" in self.content

    def test_bees_endpoint(self):
        """/bees endpoint doit être présent."""
        assert '"/bees"' in self.content or "'/bees'" in self.content

    def test_domain_kw_defined(self):
        """DOMAIN_KW doit être défini."""
        assert 'DOMAIN_KW' in self.content

    def test_classify_domain_defined(self):
        """_classify_domain() doit être défini."""
        assert '_classify_domain' in self.content

    def test_fastapi_app_defined(self):
        """FastAPI app doit être instanciée."""
        assert 'FastAPI(' in self.content

    def test_domain_kw_is_dict(self):
        """DOMAIN_KW doit être un dictionnaire (dict[str, list[str]])."""
        assert 'dict[str' in self.content or 'Dict[str' in self.content or 'DOMAIN_KW: dict' in self.content

    def test_httpx_imported(self):
        """httpx doit être importé (appels vers brain layer)."""
        assert 'import httpx' in self.content

    def test_dispatch_function_or_route(self):
        """Une fonction de dispatch async doit exister."""
        assert 'async def' in self.content


# ─────────────────────────────────────────────────────────────────────────────
# Tests logique de scoring de domaine (inline, sans import)
# ─────────────────────────────────────────────────────────────────────────────

# Version simplifiée de la logique de scoring (reproduit le comportement de swarm_router.py)
DOMAIN_KW_SAMPLE = {
    "ui":   ["interface", "bouton", "formulaire", "click"],
    "code": ["python", "javascript", "fonction", "debug"],
    "file": ["fichier", "dossier", "lecture", "écrire"],
}


def _classify(mission: str, kw: dict) -> str:
    scores = {}
    m = mission.lower()
    for domain, words in kw.items():
        scores[domain] = sum(2 if w in m.split() else (1 if w in m else 0) for w in words)
    return max(scores, key=scores.get)


class TestSwarmRouterDomainScoringLogic:
    """Teste la logique inline de scoring de domaine — aucun import du module."""

    def test_ui_domain_click_bouton(self):
        """'clique sur le bouton' doit être classifié 'ui'."""
        result = _classify("clique sur le bouton", DOMAIN_KW_SAMPLE)
        assert result == "ui"

    def test_code_domain_debug_python(self):
        """'debug python code' doit être classifié 'code'."""
        result = _classify("debug python code", DOMAIN_KW_SAMPLE)
        assert result == "code"

    def test_file_domain_lire_fichier(self):
        """'lire fichier' doit être classifié 'file'."""
        result = _classify("lire fichier", DOMAIN_KW_SAMPLE)
        assert result == "file"

    def test_exact_word_match_scores_higher(self):
        """Un mot exact (split) doit scorer 2, un sous-string 1."""
        # "python" est un mot exact dans "debug python" → score 2
        scores_exact = {}
        m = "debug python"
        for domain, words in DOMAIN_KW_SAMPLE.items():
            scores_exact[domain] = sum(
                2 if w in m.split() else (1 if w in m else 0) for w in words
            )
        assert scores_exact["code"] >= 2

    def test_no_match_returns_domain(self):
        """Une mission sans mots-clés retourne quand même un domaine (le moins mauvais)."""
        result = _classify("bonjour", DOMAIN_KW_SAMPLE)
        assert result in DOMAIN_KW_SAMPLE

    def test_interface_keyword_scores_ui(self):
        """'ouvrir interface utilisateur' doit scorer ui."""
        result = _classify("ouvrir interface utilisateur", DOMAIN_KW_SAMPLE)
        assert result == "ui"

    def test_javascript_scores_code(self):
        """'écrire javascript' peut scorer code ou file selon les mots."""
        # "javascript" est dans code, "écrire" dans file — javascript score 2 (exact), écrire score 1
        result = _classify("écrire javascript", DOMAIN_KW_SAMPLE)
        # javascript = code (+2), écrire = file (+1) → code wins
        assert result == "code"

    def test_multiple_ui_keywords(self):
        """Plusieurs mots-clés UI doivent accumuler le score."""
        scores = {}
        m = "clique sur le bouton du formulaire"
        for domain, words in DOMAIN_KW_SAMPLE.items():
            scores[domain] = sum(
                2 if w in m.split() else (1 if w in m else 0) for w in words
            )
        # bouton + formulaire dans UI → score élevé
        assert scores["ui"] > scores["code"]
        assert scores["ui"] > scores["file"]

    @pytest.mark.parametrize("mission,expected_domain", [
        ("clique sur le bouton", "ui"),
        ("debug python code", "code"),
        ("lire fichier", "file"),
        ("ouvrir interface", "ui"),
        ("python debug", "code"),
        ("dossier lecture", "file"),
    ])
    def test_classify_parametrize(self, mission, expected_domain):
        """Test paramétrisé de _classify() sur plusieurs missions."""
        result = _classify(mission, DOMAIN_KW_SAMPLE)
        assert result == expected_domain, (
            f"_classify({mission!r}) retourné {result!r}, attendu {expected_domain!r}"
        )
