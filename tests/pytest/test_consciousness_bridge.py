"""
Tests pour agent/consciousness_bridge.py.

Couvre :
- Validité syntaxique du fichier
- Présence des endpoints et fonctions principales (analyse statique)
- Tests unitaires sur la config PYTHON_LAYERS (inline, lecture du fichier source)
"""
import pytest
import sys
import os
import re
import subprocess

_ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
_FILE_PATH = os.path.join(_ROOT, 'agent', 'consciousness_bridge.py')


# ─────────────────────────────────────────────────────────────────────────────
# Tests syntaxe (sans import)
# ─────────────────────────────────────────────────────────────────────────────

class TestConsciousnessBridgeSyntax:
    def test_syntax_valid(self):
        """consciousness_bridge.py doit être syntaxiquement valide."""
        result = subprocess.run(
            ['python3', '-m', 'py_compile', _FILE_PATH],
            capture_output=True, text=True
        )
        assert result.returncode == 0, f"Erreur syntaxe consciousness_bridge.py:\n{result.stderr}"


# ─────────────────────────────────────────────────────────────────────────────
# Tests de présence des symboles clés (analyse statique)
# ─────────────────────────────────────────────────────────────────────────────

class TestConsciousnessBridgeStaticAnalysis:
    """Vérifie la présence des fonctions et endpoints attendus dans consciousness_bridge.py."""

    @pytest.fixture(autouse=True)
    def read_content(self):
        with open(_FILE_PATH, encoding='utf-8') as f:
            self.content = f.read()

    def test_ws_endpoint(self):
        """/ws websocket endpoint doit être présent."""
        assert '"/ws"' in self.content or "'/ws'" in self.content

    def test_emit_endpoint(self):
        """/emit endpoint doit être présent."""
        assert '"/emit"' in self.content or "'/emit'" in self.content

    def test_layers_endpoint(self):
        """/layers endpoint doit être présent."""
        assert '"/layers"' in self.content or "'/layers'" in self.content

    def test_signals_endpoint(self):
        """/signals endpoint doit être présent."""
        assert '"/signals"' in self.content or "'/signals'" in self.content

    def test_python_layers_defined(self):
        """PYTHON_LAYERS doit être défini."""
        assert 'PYTHON_LAYERS' in self.content

    def test_tail_signals_defined(self):
        """_tail_signals() doit être défini."""
        assert '_tail_signals' in self.content

    def test_poll_layers_defined(self):
        """_poll_layers() doit être défini."""
        assert '_poll_layers' in self.content

    def test_fastapi_app_defined(self):
        """FastAPI app doit être instanciée."""
        assert 'FastAPI(' in self.content

    def test_health_interval_defined(self):
        """HEALTH_INTERVAL_S doit être défini."""
        assert 'HEALTH_INTERVAL_S' in self.content

    def test_signal_poll_ms_defined(self):
        """SIGNAL_POLL_MS doit être défini."""
        assert 'SIGNAL_POLL_MS' in self.content


# ─────────────────────────────────────────────────────────────────────────────
# Tests logique PYTHON_LAYERS (lecture fichier source, sans import)
# ─────────────────────────────────────────────────────────────────────────────

class TestConsciousnessBridgeLayerConfigLogic:
    """Teste la config PYTHON_LAYERS via lecture du fichier source — aucun import du module."""

    @pytest.fixture(autouse=True)
    def read_content(self):
        with open(_FILE_PATH, encoding='utf-8') as f:
            self.content = f.read()

    def test_port_8001_present(self):
        """Port 8001 (Queen) doit être présent dans PYTHON_LAYERS."""
        assert '8001' in self.content

    def test_port_8015_present(self):
        """Port 8015 (ComputerUse) doit être présent dans PYTHON_LAYERS."""
        assert '8015' in self.content

    def test_all_ports_8001_to_8015_present(self):
        """Les ports 8001 à 8015 doivent tous être présents dans le fichier."""
        missing = []
        for port in range(8001, 8016):
            if str(port) not in self.content:
                missing.append(port)
        assert missing == [], f"Ports manquants dans consciousness_bridge.py: {missing}"

    def test_no_duplicate_ports_in_python_layers(self):
        """PYTHON_LAYERS ne doit pas contenir de ports dupliqués."""
        # Extrait les ports depuis les entrées dict {"port": XXXX}
        ports_found = re.findall(r'"port":\s*(\d{4})', self.content)
        # Filtre sur la plage 8001-8015 (les ports des couches Python)
        layer_ports = [p for p in ports_found if 8001 <= int(p) <= 8015]
        # Vérifie qu'il n'y a pas de duplicats
        assert len(layer_ports) == len(set(layer_ports)), (
            f"Ports dupliqués détectés dans PYTHON_LAYERS: "
            f"{[p for p in layer_ports if layer_ports.count(p) > 1]}"
        )

    def test_health_interval_is_30(self):
        """HEALTH_INTERVAL_S doit être égal à 30."""
        match = re.search(r'HEALTH_INTERVAL_S\s*=\s*(\d+)', self.content)
        assert match is not None, "HEALTH_INTERVAL_S non trouvé dans le fichier"
        assert int(match.group(1)) == 30, (
            f"HEALTH_INTERVAL_S = {match.group(1)}, attendu 30"
        )

    def test_signal_poll_ms_is_500(self):
        """SIGNAL_POLL_MS doit être égal à 500."""
        match = re.search(r'SIGNAL_POLL_MS\s*=\s*(\d+)', self.content)
        assert match is not None, "SIGNAL_POLL_MS non trouvé dans le fichier"
        assert int(match.group(1)) == 500, (
            f"SIGNAL_POLL_MS = {match.group(1)}, attendu 500"
        )

    def test_python_layers_has_16_entries(self):
        """PYTHON_LAYERS doit contenir 16 couches (ports 8001-8017)."""
        # Compte les ports via entrées dict {"port": XXXX}
        ports_found = re.findall(r'"port":\s*(\d{4})', self.content)
        # Ports attendus : 8001-8015 + 8017 (Optimizer, Phase 21)
        expected = {str(p) for p in range(8001, 8016)} | {"8017"}
        layer_ports_found = set(p for p in ports_found if p in expected)
        assert len(layer_ports_found) == 16, (
            f"Attendu 16 ports dans PYTHON_LAYERS, trouvé {len(layer_ports_found)}: {sorted(layer_ports_found)}"
        )

    def test_python_layers_is_list(self):
        """PYTHON_LAYERS doit être déclaré comme une liste."""
        assert 'PYTHON_LAYERS: list[dict]' in self.content or \
               'PYTHON_LAYERS = [' in self.content or \
               'PYTHON_LAYERS: list' in self.content

    def test_consciousness_bridge_port_8016(self):
        """Le port 8016 (propre à consciousness_bridge) doit être référencé."""
        assert '8016' in self.content

    @pytest.mark.parametrize("port", list(range(8001, 8016)) + [8017])
    def test_each_layer_port_present(self, port):
        """Chaque port de couche Python (8001-8015 + 8017) doit apparaître dans le fichier."""
        assert str(port) in self.content, (
            f"Port {port} manquant dans consciousness_bridge.py"
        )
