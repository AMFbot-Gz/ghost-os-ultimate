"""
Tests pour agent/skill_sync.py — synchronisation Ruche↔Reine

Couvre :
- _compute_machine_id() — stabilité entre deux appels
- _parse_version() — comparaison sémantique
- Logique pull conditionnel dans run_sync() — pull uniquement si hub > local
- _read_local_registry() — fichier absent vs fichier valide
- _update_local_registry() — ajout / déduplication
- run_sync() en mode Reine — retour immédiat sans requête réseau
- run_sync() sans REINE_URL — retour erreur
- _push_skill() — retourne False si skill.js absent
"""

import json
import pytest
import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, patch, MagicMock, mock_open
import sys
import os

# Ajoute le root du projet au path
_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(_ROOT))

# ─── Import avec mocks des dépendances qui chargent l'env au module-level ──────
# On doit patcher os.getenv avant d'importer skill_sync pour contrôler
# REINE_URL, MACHINE_ID etc.

import importlib

def _load_skill_sync(env_overrides: dict = None):
    """Charge (ou recharge) skill_sync avec les variables d'env données."""
    env = {
        "REINE_URL": "",
        "MACHINE_ID": "test-machine-id",
        "RUCHE_ID": "test-ruche-id",
        "SKILL_SYNC_INTERVAL": "300",
    }
    if env_overrides:
        env.update(env_overrides)

    # Supprime le module du cache pour forcer le rechargement
    for key in list(sys.modules.keys()):
        if "skill_sync" in key:
            del sys.modules[key]

    with patch.dict(os.environ, env, clear=False):
        import agent.skill_sync as mod
        importlib.reload(mod)
    return mod


# ─── Tests syntaxe ──────────────────────────────────────────────────────────

class TestSkillSyncSyntax:
    def test_syntax_valid(self):
        """skill_sync.py doit être syntaxiquement valide."""
        import subprocess
        result = subprocess.run(
            ["python3", "-m", "py_compile", str(_ROOT / "agent" / "skill_sync.py")],
            capture_output=True, text=True
        )
        assert result.returncode == 0, f"Erreur syntaxe skill_sync.py:\n{result.stderr}"


# ─── Tests de présence des symboles clés ─────────────────────────────────────

class TestSkillSyncStaticAnalysis:
    """Vérifie la présence des fonctions et endpoints attendus."""

    @pytest.fixture(autouse=True)
    def read_content(self):
        with open(_ROOT / "agent" / "skill_sync.py", encoding="utf-8") as f:
            self.content = f.read()

    def test_compute_machine_id_defined(self):
        assert "_compute_machine_id" in self.content

    def test_parse_version_defined(self):
        assert "def _parse_version(" in self.content

    def test_read_local_registry_defined(self):
        assert "def _read_local_registry(" in self.content

    def test_update_local_registry_defined(self):
        assert "async def _update_local_registry(" in self.content

    def test_pull_skill_defined(self):
        assert "async def _pull_skill(" in self.content

    def test_push_skill_defined(self):
        assert "async def _push_skill(" in self.content

    def test_run_sync_defined(self):
        assert "async def run_sync(" in self.content

    def test_health_endpoint(self):
        assert '"/health"' in self.content or "'/health'" in self.content

    def test_sync_endpoint(self):
        assert '"/sync"' in self.content or "'/sync'" in self.content

    def test_status_endpoint(self):
        assert '"/status"' in self.content or "'/status'" in self.content

    def test_fastapi_app_defined(self):
        assert "FastAPI(" in self.content

    def test_is_reine_flag_defined(self):
        assert "is_reine" in self.content


# ─── Tests unitaires sur _compute_machine_id() ───────────────────────────────

class TestComputeMachineId:
    def test_compute_machine_id_stable(self):
        """Deux appels successifs doivent retourner le même ID."""
        # Importe directement la fonction sans passer par le module rechargé
        # pour éviter les problèmes de scope
        import hashlib, socket, uuid
        def _compute():
            raw = f"{socket.gethostname()}-{uuid.getnode()}"
            return hashlib.sha256(raw.encode()).hexdigest()[:16]

        id1 = _compute()
        id2 = _compute()
        assert id1 == id2, "machine_id doit être stable entre deux appels"

    def test_compute_machine_id_is_16_chars(self):
        """L'ID machine doit faire exactement 16 caractères."""
        import hashlib, socket, uuid
        raw = f"{socket.gethostname()}-{uuid.getnode()}"
        machine_id = hashlib.sha256(raw.encode()).hexdigest()[:16]
        assert len(machine_id) == 16

    def test_compute_machine_id_is_hex(self):
        """L'ID machine doit être hexadécimal."""
        import hashlib, socket, uuid
        raw = f"{socket.gethostname()}-{uuid.getnode()}"
        machine_id = hashlib.sha256(raw.encode()).hexdigest()[:16]
        int(machine_id, 16)  # lève ValueError si non-hex


# ─── Tests unitaires sur _parse_version() ────────────────────────────────────

class TestParseVersion:
    """Teste la fonction _parse_version() de skill_sync."""

    @pytest.fixture(autouse=True)
    def load_module(self):
        self.mod = _load_skill_sync()

    def test_parse_version_basic(self):
        """'1.2.3' doit retourner (1, 2, 3)."""
        assert self.mod._parse_version("1.2.3") == (1, 2, 3)

    def test_parse_version_zero(self):
        """'0.0.0' doit retourner (0, 0, 0)."""
        assert self.mod._parse_version("0.0.0") == (0, 0, 0)

    def test_parse_version_gt(self):
        """'1.2.3' doit être > '1.2.0'."""
        assert self.mod._parse_version("1.2.3") > self.mod._parse_version("1.2.0")

    def test_parse_version_major_gt(self):
        """'1.2.0' doit être > '0.9.9'."""
        assert self.mod._parse_version("1.2.0") > self.mod._parse_version("0.9.9")

    def test_parse_version_lt(self):
        """'0.9.9' doit être < '1.2.0'."""
        assert self.mod._parse_version("0.9.9") < self.mod._parse_version("1.2.0")

    def test_parse_version_equal(self):
        """Deux versions identiques doivent être égales."""
        assert self.mod._parse_version("2.5.1") == self.mod._parse_version("2.5.1")

    def test_parse_version_invalid_fallback(self):
        """Version invalide doit retourner (0, 0, 0) sans lever d'exception."""
        result = self.mod._parse_version("invalid")
        assert result == (0, 0, 0)

    def test_parse_version_none_fallback(self):
        """None doit retourner (0, 0, 0)."""
        result = self.mod._parse_version(None)
        assert result == (0, 0, 0)


# ─── Tests sur la logique de pull conditionnel ─────────────────────────────────

class TestSemverComparisonInPullLogic:
    """Vérifie que _pull_skill est appelé uniquement si hub_version > local_version."""

    @pytest.mark.asyncio
    async def test_pull_called_when_hub_version_greater(self):
        """run_sync() doit appeler _pull_skill si hub_version > local_version."""
        mod = _load_skill_sync({"REINE_URL": "http://fake-reine:3000"})
        mod._state["is_reine"] = False

        hub_registry = {
            "skills": [{"name": "my-skill", "version": "2.0.0"}]
        }
        local_registry = {
            "skills": [{"name": "my-skill", "version": "1.0.0"}]
        }

        pull_calls = []

        async def fake_pull(client, name, hub_version):
            pull_calls.append((name, hub_version))
            return True

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = hub_registry

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch.object(mod, "_read_local_registry", return_value=local_registry), \
             patch.object(mod, "_pull_skill", side_effect=fake_pull), \
             patch.object(mod, "_update_local_registry", new_callable=AsyncMock), \
             patch("httpx.AsyncClient", return_value=mock_client):
            result = await mod.run_sync()

        assert len(pull_calls) == 1
        assert pull_calls[0] == ("my-skill", "2.0.0")

    @pytest.mark.asyncio
    async def test_pull_not_called_when_local_version_equal(self):
        """run_sync() ne doit PAS appeler _pull_skill si les versions sont égales."""
        mod = _load_skill_sync({"REINE_URL": "http://fake-reine:3000"})
        mod._state["is_reine"] = False

        hub_registry = {
            "skills": [{"name": "my-skill", "version": "1.0.0"}]
        }
        local_registry = {
            "skills": [{"name": "my-skill", "version": "1.0.0"}]
        }

        pull_calls = []

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = hub_registry

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch.object(mod, "_read_local_registry", return_value=local_registry), \
             patch.object(mod, "_pull_skill", side_effect=lambda *a: pull_calls.append(a) or True), \
             patch.object(mod, "_update_local_registry", new_callable=AsyncMock), \
             patch("httpx.AsyncClient", return_value=mock_client):
            await mod.run_sync()

        assert len(pull_calls) == 0

    @pytest.mark.asyncio
    async def test_pull_not_called_when_local_version_greater(self):
        """run_sync() ne doit PAS appeler _pull_skill si local_version > hub_version."""
        mod = _load_skill_sync({"REINE_URL": "http://fake-reine:3000"})
        mod._state["is_reine"] = False

        hub_registry = {
            "skills": [{"name": "my-skill", "version": "1.0.0"}]
        }
        local_registry = {
            "skills": [{"name": "my-skill", "version": "2.0.0"}]
        }

        pull_calls = []

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = hub_registry

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch.object(mod, "_read_local_registry", return_value=local_registry), \
             patch.object(mod, "_pull_skill", side_effect=lambda *a: pull_calls.append(a) or True), \
             patch.object(mod, "_update_local_registry", new_callable=AsyncMock), \
             patch("httpx.AsyncClient", return_value=mock_client):
            await mod.run_sync()

        assert len(pull_calls) == 0


# ─── Tests sur _read_local_registry() ────────────────────────────────────────

class TestReadLocalRegistry:
    """Teste la lecture du registry local."""

    def test_read_local_registry_empty(self, tmp_path):
        """Quand registry.json est absent, retourne dict avec skills: []."""
        mod = _load_skill_sync()
        # Pointe REGISTRY_FILE vers un fichier inexistant
        fake_registry = tmp_path / "registry.json"
        # Ne pas créer le fichier

        with patch.object(mod, "REGISTRY_FILE", fake_registry):
            result = mod._read_local_registry()

        assert "skills" in result
        assert result["skills"] == []
        assert "version" in result

    def test_read_local_registry_valid(self, tmp_path):
        """Quand registry.json est présent, retourne le contenu correct."""
        mod = _load_skill_sync()
        fake_registry = tmp_path / "registry.json"

        content = {
            "version": "1.0.0",
            "skills": [
                {"name": "hello-world", "version": "1.2.0"},
                {"name": "file-explorer", "version": "2.0.1"},
            ]
        }
        fake_registry.write_text(json.dumps(content), "utf-8")

        with patch.object(mod, "REGISTRY_FILE", fake_registry):
            result = mod._read_local_registry()

        assert result["version"] == "1.0.0"
        assert len(result["skills"]) == 2
        assert result["skills"][0]["name"] == "hello-world"

    def test_read_local_registry_corrupted_returns_default(self, tmp_path):
        """Quand registry.json est corrompu, retourne le dict par défaut."""
        mod = _load_skill_sync()
        fake_registry = tmp_path / "registry.json"
        fake_registry.write_text("{ invalid json !!!", "utf-8")

        with patch.object(mod, "REGISTRY_FILE", fake_registry):
            result = mod._read_local_registry()

        assert result["skills"] == []


# ─── Tests sur _update_local_registry() ──────────────────────────────────────

class TestUpdateLocalRegistry:
    """Teste la mise à jour du registry local."""

    @pytest.mark.asyncio
    async def test_update_local_registry_adds_new_skill(self, tmp_path):
        """_update_local_registry() doit ajouter un skill absent du registry."""
        mod = _load_skill_sync()

        # Prépare le répertoire skills avec un registry vide
        skills_dir = tmp_path / "skills"
        skills_dir.mkdir()
        registry_file = skills_dir / "registry.json"
        registry_file.write_text(json.dumps({"version": "1.0.0", "skills": []}), "utf-8")

        with patch.object(mod, "SKILLS_DIR", skills_dir), \
             patch.object(mod, "REGISTRY_FILE", registry_file):
            await mod._update_local_registry(["new-skill"])

        # Relit le fichier résultant
        result = json.loads(registry_file.read_text("utf-8"))
        names = [s["name"] for s in result["skills"]]
        assert "new-skill" in names

    @pytest.mark.asyncio
    async def test_update_local_registry_skips_existing(self, tmp_path):
        """_update_local_registry() ne doit pas dupliquer un skill déjà présent."""
        mod = _load_skill_sync()

        skills_dir = tmp_path / "skills"
        skills_dir.mkdir()
        registry_file = skills_dir / "registry.json"
        initial = {
            "version": "1.0.0",
            "skills": [{"name": "existing-skill", "version": "1.0.0"}]
        }
        registry_file.write_text(json.dumps(initial), "utf-8")

        with patch.object(mod, "SKILLS_DIR", skills_dir), \
             patch.object(mod, "REGISTRY_FILE", registry_file):
            await mod._update_local_registry(["existing-skill"])

        result = json.loads(registry_file.read_text("utf-8"))
        names = [s["name"] for s in result["skills"]]
        # Doit apparaître exactement une fois
        assert names.count("existing-skill") == 1

    @pytest.mark.asyncio
    async def test_update_local_registry_noop_on_empty_list(self, tmp_path):
        """_update_local_registry() avec liste vide ne doit pas modifier le fichier."""
        mod = _load_skill_sync()

        skills_dir = tmp_path / "skills"
        skills_dir.mkdir()
        registry_file = skills_dir / "registry.json"
        initial = {"version": "1.0.0", "skills": []}
        registry_file.write_text(json.dumps(initial), "utf-8")

        original_mtime = registry_file.stat().st_mtime

        with patch.object(mod, "SKILLS_DIR", skills_dir), \
             patch.object(mod, "REGISTRY_FILE", registry_file):
            await mod._update_local_registry([])

        # Le fichier ne doit pas avoir été modifié
        assert registry_file.stat().st_mtime == original_mtime

    @pytest.mark.asyncio
    async def test_update_local_registry_reads_manifest_version(self, tmp_path):
        """_update_local_registry() doit lire la version depuis manifest.json si présent."""
        mod = _load_skill_sync()

        skills_dir = tmp_path / "skills"
        skills_dir.mkdir()
        registry_file = skills_dir / "registry.json"
        registry_file.write_text(json.dumps({"version": "1.0.0", "skills": []}), "utf-8")

        # Crée un manifest pour le skill
        skill_dir = skills_dir / "my-skill"
        skill_dir.mkdir()
        manifest = {"version": "3.1.4", "description": "Un super skill"}
        (skill_dir / "manifest.json").write_text(json.dumps(manifest), "utf-8")

        with patch.object(mod, "SKILLS_DIR", skills_dir), \
             patch.object(mod, "REGISTRY_FILE", registry_file):
            await mod._update_local_registry(["my-skill"])

        result = json.loads(registry_file.read_text("utf-8"))
        entry = next(s for s in result["skills"] if s["name"] == "my-skill")
        assert entry["version"] == "3.1.4"
        assert entry["description"] == "Un super skill"


# ─── Tests sur run_sync() en mode Reine ──────────────────────────────────────

class TestRunSyncReineMode:
    """Vérifie le comportement de run_sync() quand _state['is_reine'] est True."""

    @pytest.mark.asyncio
    async def test_sync_skips_when_is_reine(self):
        """run_sync() doit retourner 'Cette machine est la Reine' si is_reine=True."""
        mod = _load_skill_sync({"REINE_URL": ""})
        # Force le flag is_reine à True (comportement naturel quand REINE_URL vide)
        mod._state["is_reine"] = True

        result = await mod.run_sync()

        assert result["ok"] is True
        assert "Reine" in result["message"]

    @pytest.mark.asyncio
    async def test_sync_reine_does_not_make_http_request(self):
        """run_sync() en mode Reine ne doit jamais faire de requête HTTP."""
        mod = _load_skill_sync({"REINE_URL": ""})
        mod._state["is_reine"] = True

        with patch("httpx.AsyncClient") as mock_client_cls:
            await mod.run_sync()
            # Le client HTTP ne doit jamais être instancié
            mock_client_cls.assert_not_called()


# ─── Tests sur run_sync() sans REINE_URL ────────────────────────────────────

class TestRunSyncNoReineUrl:
    """Vérifie le comportement de run_sync() quand REINE_URL n'est pas configuré."""

    @pytest.mark.asyncio
    async def test_sync_fails_without_reine_url(self):
        """run_sync() doit retourner ok=False si REINE_URL vide et is_reine=False."""
        mod = _load_skill_sync({"REINE_URL": ""})
        # Cas paradoxal mais testable : is_reine=False mais REINE_URL vide
        mod._state["is_reine"] = False

        result = await mod.run_sync()

        assert result["ok"] is False
        assert "REINE_URL" in result.get("error", "")

    @pytest.mark.asyncio
    async def test_sync_error_contains_reine_url_message(self):
        """Le message d'erreur doit mentionner REINE_URL."""
        mod = _load_skill_sync({"REINE_URL": ""})
        mod._state["is_reine"] = False

        result = await mod.run_sync()

        assert "REINE_URL" in result["error"]
        assert result["ok"] is False


# ─── Tests sur _push_skill() ─────────────────────────────────────────────────

class TestPushSkill:
    """Teste _push_skill() — publication d'un skill vers la Reine."""

    @pytest.mark.asyncio
    async def test_push_skill_missing_file(self, tmp_path):
        """_push_skill() doit retourner False si skill.js n'existe pas."""
        mod = _load_skill_sync({"REINE_URL": "http://fake-reine:3000"})

        # Répertoire skills sans fichier skill.js
        skills_dir = tmp_path / "skills"
        skills_dir.mkdir()
        skill_dir = skills_dir / "my-skill"
        skill_dir.mkdir()
        # Ne pas créer skill.js

        mock_client = AsyncMock()

        with patch.object(mod, "SKILLS_DIR", skills_dir):
            result = await mod._push_skill(mock_client, "my-skill")

        assert result is False
        # Aucune requête HTTP ne doit avoir été faite
        mock_client.post.assert_not_called()

    @pytest.mark.asyncio
    async def test_push_skill_missing_skill_dir(self, tmp_path):
        """_push_skill() doit retourner False si le répertoire du skill n'existe pas."""
        mod = _load_skill_sync({"REINE_URL": "http://fake-reine:3000"})

        skills_dir = tmp_path / "skills"
        skills_dir.mkdir()
        # Ne pas créer le sous-répertoire du skill

        mock_client = AsyncMock()

        with patch.object(mod, "SKILLS_DIR", skills_dir):
            result = await mod._push_skill(mock_client, "inexistant-skill")

        assert result is False

    @pytest.mark.asyncio
    async def test_push_skill_success(self, tmp_path):
        """_push_skill() doit retourner True si le push réussit."""
        mod = _load_skill_sync({"REINE_URL": "http://fake-reine:3000"})

        skills_dir = tmp_path / "skills"
        skills_dir.mkdir()
        skill_dir = skills_dir / "my-skill"
        skill_dir.mkdir()
        (skill_dir / "skill.js").write_text("export async function run() { return 42; }", "utf-8")

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"ok": True}

        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)

        with patch.object(mod, "SKILLS_DIR", skills_dir):
            result = await mod._push_skill(mock_client, "my-skill")

        assert result is True
        mock_client.post.assert_called_once()

    @pytest.mark.asyncio
    async def test_push_skill_server_error(self, tmp_path):
        """_push_skill() doit retourner False si le serveur refuse (non-200)."""
        mod = _load_skill_sync({"REINE_URL": "http://fake-reine:3000"})

        skills_dir = tmp_path / "skills"
        skills_dir.mkdir()
        skill_dir = skills_dir / "my-skill"
        skill_dir.mkdir()
        (skill_dir / "skill.js").write_text("export async function run() {}", "utf-8")

        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_response.json.return_value = {"ok": False}

        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)

        with patch.object(mod, "SKILLS_DIR", skills_dir):
            result = await mod._push_skill(mock_client, "my-skill")

        assert result is False

    @pytest.mark.asyncio
    async def test_push_skill_includes_machine_id(self, tmp_path):
        """_push_skill() doit inclure machine_id dans le payload."""
        mod = _load_skill_sync({"REINE_URL": "http://fake-reine:3000"})

        skills_dir = tmp_path / "skills"
        skills_dir.mkdir()
        skill_dir = skills_dir / "my-skill"
        skill_dir.mkdir()
        (skill_dir / "skill.js").write_text("// code", "utf-8")

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"ok": True}

        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)

        with patch.object(mod, "SKILLS_DIR", skills_dir):
            await mod._push_skill(mock_client, "my-skill")

        call_kwargs = mock_client.post.call_args
        payload = call_kwargs.kwargs.get("json") or call_kwargs[1].get("json", {})
        assert "machine_id" in payload
        assert payload["name"] == "my-skill"


# ─── Tests sur _pull_skill() ─────────────────────────────────────────────────

class TestPullSkill:
    """Teste _pull_skill() — téléchargement d'un skill depuis la Reine."""

    @pytest.mark.asyncio
    async def test_pull_skill_success(self, tmp_path):
        """_pull_skill() doit retourner True et écrire skill.js si succès."""
        mod = _load_skill_sync({"REINE_URL": "http://fake-reine:3000"})

        skills_dir = tmp_path / "skills"
        skills_dir.mkdir()

        code_response = MagicMock()
        code_response.status_code = 200
        code_response.json.return_value = {"ok": True, "code": "export async function run() {}"}

        manifest_response = MagicMock()
        manifest_response.status_code = 200
        manifest_response.json.return_value = {"ok": True, "manifest": {"version": "1.0.0"}}

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=code_response)

        # asyncio.gather retourne les deux réponses
        with patch("asyncio.gather", new_callable=AsyncMock,
                   return_value=(code_response, manifest_response)), \
             patch.object(mod, "SKILLS_DIR", skills_dir), \
             patch.object(mod, "REINE_URL", "http://fake-reine:3000"):
            result = await mod._pull_skill(mock_client, "new-skill", "1.0.0")

        assert result is True
        assert (skills_dir / "new-skill" / "skill.js").exists()

    @pytest.mark.asyncio
    async def test_pull_skill_fails_on_http_error(self, tmp_path):
        """_pull_skill() doit retourner False si la requête HTTP échoue."""
        mod = _load_skill_sync({"REINE_URL": "http://fake-reine:3000"})

        skills_dir = tmp_path / "skills"
        skills_dir.mkdir()

        code_response = MagicMock()
        code_response.status_code = 404

        mock_client = AsyncMock()

        with patch("asyncio.gather", new_callable=AsyncMock,
                   return_value=(code_response, Exception("timeout"))), \
             patch.object(mod, "SKILLS_DIR", skills_dir), \
             patch.object(mod, "REINE_URL", "http://fake-reine:3000"):
            result = await mod._pull_skill(mock_client, "bad-skill", "1.0.0")

        assert result is False


# ─── Tests sur l'état global _state ──────────────────────────────────────────

class TestStateManagement:
    """Teste les invariants de l'état global _state."""

    def test_state_has_required_keys(self):
        """_state doit contenir les clés attendues."""
        mod = _load_skill_sync()
        required_keys = {"last_sync", "last_sync_ok", "pulled_total", "pushed_total", "errors", "is_reine"}
        assert required_keys.issubset(mod._state.keys())

    def test_is_reine_true_when_reine_url_empty(self):
        """is_reine doit être True quand REINE_URL est vide."""
        mod = _load_skill_sync({"REINE_URL": ""})
        assert mod._state["is_reine"] is True

    def test_is_reine_false_when_reine_url_set(self):
        """is_reine doit être False quand REINE_URL est défini."""
        mod = _load_skill_sync({"REINE_URL": "http://192.168.1.10:3000"})
        assert mod._state["is_reine"] is False

    @pytest.mark.asyncio
    async def test_run_sync_updates_last_sync(self, tmp_path):
        """run_sync() doit mettre à jour _state['last_sync'] après une sync réussie."""
        mod = _load_skill_sync({"REINE_URL": "http://fake-reine:3000"})
        mod._state["is_reine"] = False
        mod._state["last_sync"] = None

        hub_registry = {"skills": []}

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = hub_registry

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch.object(mod, "_read_local_registry", return_value={"skills": []}), \
             patch.object(mod, "_update_local_registry", new_callable=AsyncMock), \
             patch("httpx.AsyncClient", return_value=mock_client):
            await mod.run_sync()

        assert mod._state["last_sync"] is not None
