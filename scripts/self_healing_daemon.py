#!/usr/bin/env python3
"""
scripts/self_healing_daemon.py — Daemon de self-healing pour Ghost OS Ultimate
Surveille tous les layers FastAPI (:8001-:8016) et les redémarre automatiquement.

Fonctionnalités :
  ✓ Circuit breaker par layer (CLOSED → OPEN → HALF_OPEN)
  ✓ Exponential backoff pour les restarts
  ✓ Health check async toutes les 10s
  ✓ Graceful shutdown sur SIGTERM/SIGINT
  ✓ Log structuré JSON vers /tmp/ghost_selfheal.log

Usage :
    python3 scripts/self_healing_daemon.py           # toutes les couches
    python3 scripts/self_healing_daemon.py --layers queen brain memory
    python3 scripts/self_healing_daemon.py --once    # check unique + exit
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
import subprocess
import sys
import time
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path

# ─── Config ───────────────────────────────────────────────────────────────────

ROOT = Path(__file__).resolve().parent.parent

LAYERS: dict[str, dict] = {
    "queen":       {"module": "agent.queen",              "port": 8001, "critical": True},
    "perception":  {"module": "agent.perception",         "port": 8002, "critical": False},
    "brain":       {"module": "agent.brain",              "port": 8003, "critical": True},
    "executor":    {"module": "agent.executor",           "port": 8004, "critical": True},
    "evolution":   {"module": "agent.evolution",          "port": 8005, "critical": False},
    "memory":      {"module": "agent.memory",             "port": 8006, "critical": True},
    "mcp_bridge":  {"module": "agent.mcp_bridge",         "port": 8007, "critical": False},
    "planner":     {"module": "agent.planner",            "port": 8008, "critical": False},
    "learner":     {"module": "agent.learner",            "port": 8009, "critical": False},
    "goals":       {"module": "agent.goals",              "port": 8010, "critical": False},
    "pipeline":    {"module": "agent.pipeline",           "port": 8011, "critical": False},
    "miner":       {"module": "agent.miner",              "port": 8012, "critical": False},
    "swarm_router":{"module": "agent.swarm_router",       "port": 8013, "critical": False},
    "validator":   {"module": "agent.validator",          "port": 8014, "critical": False},
    "computer_use":{"module": "agent.computer_use",       "port": 8015, "critical": False},
    "consciousness_bridge": {"module": "agent.consciousness_bridge", "port": 8016, "critical": False},
    "skill_sync": {
        "module": "agent.skill_sync",
        "port": 8019,
        "critical": False,
        "desc": "Sync skills Ruche↔Reine",
    },
}

CHECK_INTERVAL   = 10     # secondes entre chaque health check
MAX_FAILURES     = 3      # failures avant ouverture circuit breaker
BACKOFF_BASE     = 1.0    # secondes, base du backoff exponentiel
BACKOFF_MAX      = 60.0   # secondes, max backoff
CB_HALF_OPEN_AFTER = 60.0 # secondes avant tentative HALF_OPEN
LOG_FILE = Path("/tmp/ghost_selfheal.log")


# ─── Logging ──────────────────────────────────────────────────────────────────

class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        d = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "level": record.levelname,
            "msg": record.getMessage(),
        }
        if hasattr(record, "layer"):
            d["layer"] = record.layer
        return json.dumps(d)

logger = logging.getLogger("self_heal")
logger.setLevel(logging.DEBUG)

_fh = logging.FileHandler(LOG_FILE)
_fh.setFormatter(JsonFormatter())
logger.addHandler(_fh)

_sh = logging.StreamHandler(sys.stdout)
_sh.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", "%H:%M:%S"))
logger.addHandler(_sh)


# ─── Circuit Breaker ──────────────────────────────────────────────────────────

class CBState(Enum):
    CLOSED    = "CLOSED"     # normal, surveille
    OPEN      = "OPEN"       # trop d'erreurs, ne restart plus
    HALF_OPEN = "HALF_OPEN"  # teste une reprise


@dataclass
class CircuitBreaker:
    name: str
    failure_count: int = 0
    state: CBState = CBState.CLOSED
    opened_at: float = 0.0
    restart_count: int = 0
    last_restart: float = 0.0

    def record_failure(self) -> None:
        self.failure_count += 1
        if self.failure_count >= MAX_FAILURES and self.state == CBState.CLOSED:
            self.state = CBState.OPEN
            self.opened_at = time.time()
            logger.warning(f"Circuit OPEN — layer {self.name} ({self.failure_count} failures)",
                          extra={"layer": self.name})

    def record_success(self) -> None:
        if self.state != CBState.CLOSED:
            logger.info(f"Circuit CLOSED — layer {self.name} recovered", extra={"layer": self.name})
        self.failure_count = 0
        self.state = CBState.CLOSED

    def can_restart(self) -> bool:
        if self.state == CBState.CLOSED:
            return True
        if self.state == CBState.OPEN:
            if time.time() - self.opened_at > CB_HALF_OPEN_AFTER:
                self.state = CBState.HALF_OPEN
                logger.info(f"Circuit HALF_OPEN — testing {self.name}", extra={"layer": self.name})
                return True
            return False
        return True  # HALF_OPEN = try once

    def backoff_delay(self) -> float:
        delay = min(BACKOFF_BASE * (2 ** self.restart_count), BACKOFF_MAX)
        return delay


# ─── Layer Monitor ────────────────────────────────────────────────────────────

class LayerMonitor:
    def __init__(self, active_layers: list[str] | None = None) -> None:
        self._active = active_layers or list(LAYERS.keys())
        self._cb: dict[str, CircuitBreaker] = {n: CircuitBreaker(n) for n in self._active}
        self._pids: dict[str, int | None] = {n: None for n in self._active}
        self._shutdown = False
        self._pids_dir = ROOT / "agent" / ".pids"
        self._logs_dir = ROOT / "agent" / "logs"
        self._pids_dir.mkdir(parents=True, exist_ok=True)
        self._logs_dir.mkdir(parents=True, exist_ok=True)

    def _log(self, level: str, msg: str, layer: str | None = None) -> None:
        extra = {"layer": layer} if layer else {}
        getattr(logger, level)(msg, extra=extra)

    async def _is_up(self, port: int) -> bool:
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection("127.0.0.1", port), timeout=2.0
            )
            writer.write(b"GET /health HTTP/1.0\r\n\r\n")
            await writer.drain()
            data = await asyncio.wait_for(reader.read(256), timeout=2.0)
            writer.close()
            return b"200" in data
        except Exception:
            return False

    async def _kill_layer(self, name: str) -> None:
        """Kill le process existant (SIGTERM → 3s → SIGKILL)."""
        pid = self._pids.get(name)
        if pid is None:
            pid_file = self._pids_dir / f"{name}.pid"
            if pid_file.exists():
                try:
                    pid = int(pid_file.read_text().strip())
                except (ValueError, OSError):
                    pid = None

        # Aussi tuer via lsof si pid inconnu
        port = LAYERS[name]["port"]
        try:
            r = subprocess.run(
                ["lsof", "-ti", f":{port}"], capture_output=True, text=True
            )
            for p in r.stdout.strip().split():
                try:
                    os.kill(int(p), signal.SIGTERM)
                except (ProcessLookupError, ValueError):
                    pass
        except Exception:
            pass

        if pid:
            try:
                os.kill(pid, signal.SIGTERM)
                await asyncio.sleep(3)
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            except (ProcessLookupError, PermissionError):
                pass

        self._pids[name] = None

    async def _start_layer(self, name: str) -> bool:
        """Démarre un layer et retourne True si healthy après start."""
        cfg = LAYERS[name]
        log_path = self._logs_dir / f"{name}.log"

        try:
            with open(log_path, "a") as lf:
                proc = subprocess.Popen(
                    ["python3", "-m", "uvicorn", f"{cfg['module']}:app",
                     "--host", "127.0.0.1", "--port", str(cfg["port"]),
                     "--log-level", "warning"],
                    cwd=str(ROOT),
                    stdout=lf,
                    stderr=lf,
                )
                self._pids[name] = proc.pid
                pid_file = self._pids_dir / f"{name}.pid"
                pid_file.write_text(str(proc.pid))
        except Exception as e:
            self._log("error", f"Failed to spawn {name}: {e}", name)
            return False

        # Attendre jusqu'à 10s pour health check
        for _ in range(10):
            await asyncio.sleep(1)
            if await self._is_up(cfg["port"]):
                return True
        return False

    async def _restart_layer(self, name: str) -> None:
        cb = self._cb[name]
        if not cb.can_restart():
            return

        delay = cb.backoff_delay()
        self._log("warning", f"Restarting in {delay:.0f}s (attempt #{cb.restart_count + 1})", name)
        await asyncio.sleep(delay)

        await self._kill_layer(name)
        cb.restart_count += 1
        cb.last_restart = time.time()

        ok = await self._start_layer(name)
        if ok:
            cb.record_success()
            self._log("info", f"✅ Restarted successfully", name)
        else:
            cb.record_failure()
            self._log("error", f"❌ Restart failed (circuit: {cb.state.value})", name)

    async def _check_layer(self, name: str) -> None:
        cfg = LAYERS[name]
        up = await self._is_up(cfg["port"])
        cb = self._cb[name]

        if up:
            if cb.failure_count > 0 or cb.state != CBState.CLOSED:
                cb.record_success()
            return

        # Layer DOWN
        cb.record_failure()
        self._log("warning",
                  f"Layer DOWN (failures={cb.failure_count}, circuit={cb.state.value})", name)

        if cb.can_restart():
            asyncio.create_task(self._restart_layer(name))

    async def check_all_once(self) -> dict[str, bool]:
        """Check unique de tous les layers. Retourne {name: is_up}."""
        results = {}
        for name in self._active:
            cfg = LAYERS[name]
            results[name] = await self._is_up(cfg["port"])
        return results

    async def run(self) -> None:
        """Boucle principale de surveillance."""
        self._log("info", f"Self-healing daemon started — watching {len(self._active)} layers")

        loop = asyncio.get_event_loop()
        loop.add_signal_handler(signal.SIGTERM, self._on_shutdown)
        loop.add_signal_handler(signal.SIGINT,  self._on_shutdown)

        while not self._shutdown:
            tasks = [self._check_layer(name) for name in self._active]
            await asyncio.gather(*tasks, return_exceptions=True)

            # Status summary toutes les 60s
            if int(time.time()) % 60 < CHECK_INTERVAL:
                self._print_status()

            await asyncio.sleep(CHECK_INTERVAL)

        self._log("info", "Self-healing daemon stopped")

    def _on_shutdown(self) -> None:
        self._log("info", "Shutdown signal received")
        self._shutdown = True

    def _print_status(self) -> None:
        lines = []
        for name in self._active:
            cb = self._cb[name]
            icon = "✅" if cb.state == CBState.CLOSED and cb.failure_count == 0 else (
                "⚠️ " if cb.state != CBState.OPEN else "❌"
            )
            lines.append(f"  {icon} {name:20s} circuit={cb.state.value:9s} restarts={cb.restart_count}")
        logger.info("─── Status ───\n" + "\n".join(lines))


# ─── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    import argparse
    parser = argparse.ArgumentParser(description="Ghost OS Self-Healing Daemon")
    parser.add_argument("--layers", nargs="+", choices=list(LAYERS.keys()),
                        help="Layers à surveiller (défaut: tous)")
    parser.add_argument("--once", action="store_true",
                        help="Check unique + affiche statut + exit")
    args = parser.parse_args()

    monitor = LayerMonitor(active_layers=args.layers)

    if args.once:
        async def _once():
            results = await monitor.check_all_once()
            print("\n─── Ghost OS Layer Status ───")
            for name, up in results.items():
                icon = "✅" if up else "❌"
                port = LAYERS[name]["port"]
                crit = "CRITICAL" if LAYERS[name]["critical"] else "optional"
                print(f"  {icon} :{port} {name:20s} [{crit}]")
            down_critical = [n for n, up in results.items() if not up and LAYERS[n]["critical"]]
            if down_critical:
                print(f"\n  ⚠️  Layers critiques DOWN: {', '.join(down_critical)}")
                sys.exit(1)
            else:
                print("\n  ✅ Tous les layers critiques sont UP")
                sys.exit(0)
        asyncio.run(_once())
    else:
        asyncio.run(monitor.run())


if __name__ == "__main__":
    main()
