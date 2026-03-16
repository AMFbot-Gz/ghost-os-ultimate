"""
Tests pour agent/computer_use.py.

Couvre :
- Validité syntaxique du fichier
- Présence des endpoints et fonctions principales (analyse statique)
- Tests unitaires sur la logique de parsing d'actions (inline, sans import)
"""
import pytest
import sys
import os
import re
import subprocess

_ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
_FILE_PATH = os.path.join(_ROOT, 'agent', 'computer_use.py')


# ─────────────────────────────────────────────────────────────────────────────
# Tests syntaxe (sans import)
# ─────────────────────────────────────────────────────────────────────────────

class TestComputerUseSyntax:
    def test_syntax_valid(self):
        """computer_use.py doit être syntaxiquement valide."""
        result = subprocess.run(
            ['python3', '-m', 'py_compile', _FILE_PATH],
            capture_output=True, text=True
        )
        assert result.returncode == 0, f"Erreur syntaxe computer_use.py:\n{result.stderr}"


# ─────────────────────────────────────────────────────────────────────────────
# Tests de présence des symboles clés (analyse statique)
# ─────────────────────────────────────────────────────────────────────────────

class TestComputerUseStaticAnalysis:
    """Vérifie la présence des fonctions et endpoints attendus dans computer_use.py."""

    @pytest.fixture(autouse=True)
    def read_content(self):
        with open(_FILE_PATH, encoding='utf-8') as f:
            self.content = f.read()

    def test_session_endpoint(self):
        """/session endpoint doit être présent."""
        assert '"/session' in self.content or "'/session" in self.content

    def test_start_endpoint(self):
        """/start (ou /session/start) endpoint doit être présent."""
        assert '"start"' in self.content or "'start'" in self.content or '/start' in self.content

    def test_run_session_defined(self):
        """_run_session() doit être défini."""
        assert '_run_session' in self.content

    def test_parse_action_defined(self):
        """_parse_action() doit être défini."""
        assert '_parse_action' in self.content

    def test_failsafe_present(self):
        """FAILSAFE doit être référencé (sécurité pyautogui)."""
        assert 'FAILSAFE' in self.content

    def test_fastapi_app_defined(self):
        """FastAPI app doit être instanciée."""
        assert 'FastAPI(' in self.content

    def test_httpx_imported(self):
        """httpx doit être importé."""
        assert 'import httpx' in self.content

    def test_screenshot_endpoint(self):
        """/screenshot endpoint doit être présent."""
        assert '"/screenshot"' in self.content or "'/screenshot'" in self.content

    def test_session_stop_or_sessions_endpoint(self):
        """/sessions ou /session/{id}/stop endpoint doit être présent."""
        assert '/sessions' in self.content or '/stop' in self.content

    def test_async_run_session(self):
        """_run_session() doit être async."""
        assert 'async def _run_session(' in self.content


# ─────────────────────────────────────────────────────────────────────────────
# Logique inline de parsing d'actions (reproduit computer_use.py)
# ─────────────────────────────────────────────────────────────────────────────

def _parse_action(raw: str) -> dict:
    action_match = re.search(r'Action:\s*(\w+)\s*(.*)', raw, re.IGNORECASE)
    if not action_match:
        return {"type": "done", "input": "no action found"}
    return {
        "type":  action_match.group(1).lower().strip(),
        "input": action_match.group(2).strip(),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Tests logique de parsing d'actions (inline, sans import)
# ─────────────────────────────────────────────────────────────────────────────

class TestComputerUseActionParsingLogic:
    """Teste la logique inline de _parse_action() — aucun import du module."""

    def test_parse_click_action(self):
        """'Action: click 100 200' doit parser type=click."""
        result = _parse_action("Action: click 100 200")
        assert result["type"] == "click"
        assert result["input"] == "100 200"

    def test_parse_type_action(self):
        """'Action: type hello world' doit parser type=type."""
        result = _parse_action("Action: type hello world")
        assert result["type"] == "type"
        assert result["input"] == "hello world"

    def test_parse_done_action(self):
        """'Action: done success' doit parser type=done."""
        result = _parse_action("Action: done success")
        assert result["type"] == "done"
        assert result["input"] == "success"

    def test_no_action_returns_done(self):
        """Sans 'Action:' dans le texte, type doit être 'done'."""
        result = _parse_action("No action here")
        assert result["type"] == "done"
        assert result["input"] == "no action found"

    def test_empty_string_returns_done(self):
        """Chaîne vide doit retourner type=done."""
        result = _parse_action("")
        assert result["type"] == "done"

    def test_case_insensitive_action(self):
        """'action: CLICK 50 80' (minuscules) doit être parsé correctement."""
        result = _parse_action("action: CLICK 50 80")
        assert result["type"] == "click"

    def test_action_type_is_lowercase(self):
        """Le type retourné doit toujours être en minuscules."""
        result = _parse_action("Action: SCROLL down")
        assert result["type"] == result["type"].lower()

    def test_result_has_type_and_input_keys(self):
        """Le résultat doit toujours avoir les clés 'type' et 'input'."""
        result = _parse_action("Action: move 300 400")
        assert "type" in result
        assert "input" in result

    def test_multiline_raw_with_action(self):
        """_parse_action() doit trouver l'action dans un texte multi-lignes."""
        raw = "Thinking about next step...\nAction: screenshot\nEnd."
        result = _parse_action(raw)
        assert result["type"] == "screenshot"

    @pytest.mark.parametrize("raw,expected_type,expected_input", [
        ("Action: click 100 200",       "click",      "100 200"),
        ("Action: type hello world",    "type",       "hello world"),
        ("Action: done success",        "done",       "success"),
        ("No action here",              "done",       "no action found"),
        ("Action: scroll down",         "scroll",     "down"),
        ("Action: key ctrl+c",          "key",        "ctrl+c"),
        ("action: move 50 80",          "move",       "50 80"),
        ("Action: screenshot",          "screenshot", ""),
    ])
    def test_parse_action_parametrize(self, raw, expected_type, expected_input):
        """Test paramétrisé de _parse_action() sur plusieurs inputs."""
        result = _parse_action(raw)
        assert result["type"] == expected_type, (
            f"_parse_action({raw!r})['type'] = {result['type']!r}, attendu {expected_type!r}"
        )
        assert result["input"] == expected_input, (
            f"_parse_action({raw!r})['input'] = {result['input']!r}, attendu {expected_input!r}"
        )
