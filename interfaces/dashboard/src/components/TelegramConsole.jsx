/**
 * TelegramConsole.jsx — Console terminal pour envoyer des commandes au bot
 * Style terminal monospace, historique de commandes, indicateur de statut bot
 */

import React, { useState, useEffect, useRef, useCallback } from "react";

// ─── Mock historique initial ──────────────────────────────────────────────────
const INITIAL_LOG = [
  {
    id: 1,
    type: "system",
    text: "LaRuche Terminal v3.2 — 100% Local",
    ts: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
  },
  {
    id: 2,
    type: "system",
    text: 'Tapez une commande ou "/help" pour l\'aide',
    ts: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
  },
  {
    id: 3,
    type: "sent",
    text: "/status",
    ts: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
  },
  {
    id: 4,
    type: "received",
    text: "ÉTAT LARUCHE OSS\nStratège: llama3.2\nMissions: 12 (10 réussies)\nHUD: ✅ 1 client(s)\nUptime: 47min",
    ts: new Date(Date.now() - 2 * 60 * 1000 + 1500).toISOString(),
  },
];

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = {
  wrapper: {
    background: "#0D0D0D",
    border: "1px solid var(--border-2)",
    borderRadius: "var(--radius)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  titleBar: {
    background: "var(--surface-3)",
    borderBottom: "1px solid var(--border)",
    padding: "8px 14px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
  },
  titleLeft: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  titleDots: {
    display: "flex",
    gap: "5px",
  },
  dot: (color) => ({
    width: "10px",
    height: "10px",
    borderRadius: "50%",
    background: color,
  }),
  titleText: {
    fontSize: "12px",
    color: "var(--text-2)",
    fontFamily: "JetBrains Mono, monospace",
  },
  statusIndicator: (online) => ({
    display: "flex",
    alignItems: "center",
    gap: "5px",
    fontSize: "11px",
    color: online ? "#4ade80" : "#f87171",
    fontFamily: "JetBrains Mono, monospace",
  }),
  statusDot: (online) => ({
    width: "7px",
    height: "7px",
    borderRadius: "50%",
    background: online ? "#4ade80" : "#f87171",
    animation: online ? "pulse 2s ease-in-out infinite" : "none",
  }),
  log: {
    flex: 1,
    overflowY: "auto",
    padding: "10px 14px",
    fontFamily: "JetBrains Mono, monospace",
    fontSize: "12px",
    minHeight: "160px",
    maxHeight: "220px",
    lineHeight: 1.6,
  },
  logLine: {
    marginBottom: "4px",
    wordBreak: "break-word",
    whiteSpace: "pre-wrap",
  },
  logTimestamp: {
    color: "#3D3B33",
    marginRight: "6px",
    fontSize: "10px",
  },
  inputRow: {
    display: "flex",
    alignItems: "center",
    gap: "0",
    background: "#111",
    borderTop: "1px solid rgba(255,255,255,0.06)",
    padding: "8px 14px",
  },
  prompt: {
    color: "#E07B54",
    fontFamily: "JetBrains Mono, monospace",
    fontSize: "13px",
    marginRight: "8px",
    flexShrink: 0,
  },
  input: {
    flex: 1,
    background: "none",
    border: "none",
    outline: "none",
    color: "#F2F0EA",
    fontFamily: "JetBrains Mono, monospace",
    fontSize: "13px",
    caretColor: "#E07B54",
  },
  sendBtn: {
    background: "none",
    border: "1px solid rgba(224, 123, 84, 0.3)",
    borderRadius: "4px",
    color: "#E07B54",
    fontFamily: "JetBrains Mono, monospace",
    fontSize: "11px",
    padding: "3px 10px",
    cursor: "pointer",
    transition: "all 0.15s ease",
    flexShrink: 0,
    marginLeft: "8px",
  },
};

function getLogStyle(type) {
  switch (type) {
    case "sent":
      return { color: "#E07B54" };
    case "received":
      return { color: "#A09C94" };
    case "system":
      return { color: "#3b82f6", opacity: 0.8 };
    case "error":
      return { color: "#f87171" };
    case "sending":
      return { color: "#f59e0b", opacity: 0.7 };
    default:
      return { color: "#F2F0EA" };
  }
}

function getLogPrefix(type) {
  switch (type) {
    case "sent": return "→ ";
    case "received": return "← ";
    case "system": return "# ";
    case "error": return "! ";
    case "sending": return "⟳ ";
    default: return "  ";
  }
}

function formatTime(isoString) {
  const d = new Date(isoString);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

// ─── Composant principal TelegramConsole ──────────────────────────────────────
/**
 * @param {{ onCommand?: Function }} props
 */
export default function TelegramConsole({ onCommand }) {
  const [log, setLog] = useState(INITIAL_LOG);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [botOnline, setBotOnline] = useState(true);
  const [sending, setSending] = useState(false);
  const logRef = useRef(null);
  const inputRef = useRef(null);
  let logId = useRef(100);

  // Scroll automatique vers le bas
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [log]);

  // Vérification du statut du bot
  useEffect(() => {
    const checkBot = async () => {
      try {
        const res = await fetch("/api/status", { signal: AbortSignal.timeout(2000) });
        setBotOnline(res.ok);
      } catch {
        setBotOnline(false);
      }
    };
    checkBot();
    const interval = setInterval(checkBot, 15000);
    return () => clearInterval(interval);
  }, []);

  const addLog = useCallback((type, text) => {
    setLog((prev) => [
      ...prev,
      { id: ++logId.current, type, text, ts: new Date().toISOString() },
    ]);
  }, []);

  const sendCommand = useCallback(async (cmd) => {
    if (!cmd.trim()) return;

    // Ajout au log et à l'historique
    addLog("sent", cmd);
    setHistory((prev) => [cmd, ...prev.filter((c) => c !== cmd)].slice(0, 50));
    setHistoryIdx(-1);
    setInput("");
    setSending(true);

    // Commandes locales
    if (cmd === "/help") {
      addLog("received",
        "/start — Afficher l'aide\n/status — État du système\n/mission <tâche> — Lancer une mission\n/models — Modèles actifs\n/skill <desc> — Créer un skill\n/design — Lancer le build design"
      );
      setSending(false);
      return;
    }

    if (onCommand) {
      onCommand(cmd);
    }

    // Envoi à l'API
    try {
      const res = await fetch("/api/mission", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: cmd }),
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      addLog("received", data.message || data.result || `Mission lancée (id: ${data.missionId || data.id || "?"})`);
    } catch (err) {
      if (err.name === "TimeoutError") {
        addLog("system", "Mission lancée en arrière-plan...");
      } else {
        addLog("error", `Erreur: ${err.message}`);
      }
    } finally {
      setSending(false);
    }
  }, [addLog, onCommand]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === "Enter" && !sending) {
      sendCommand(input);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const newIdx = Math.min(historyIdx + 1, history.length - 1);
      setHistoryIdx(newIdx);
      if (history[newIdx]) setInput(history[newIdx]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const newIdx = Math.max(historyIdx - 1, -1);
      setHistoryIdx(newIdx);
      setInput(newIdx === -1 ? "" : history[newIdx] || "");
    }
  }, [sending, input, history, historyIdx, sendCommand]);

  return (
    <div style={styles.wrapper}>
      {/* Barre de titre */}
      <div style={styles.titleBar}>
        <div style={styles.titleLeft}>
          <div style={styles.titleDots}>
            <div style={styles.dot("#F87171")} />
            <div style={styles.dot("#FBB24C")} />
            <div style={styles.dot("#4ADE80")} />
          </div>
          <span style={styles.titleText}>laruche-terminal</span>
        </div>
        <div style={styles.statusIndicator(botOnline)}>
          <div style={styles.statusDot(botOnline)} />
          {botOnline ? "Bot connecté ✅" : "Bot hors ligne ❌"}
        </div>
      </div>

      {/* Zone de log */}
      <div style={styles.log} ref={logRef}>
        {log.map((line) => (
          <div key={line.id} style={{ ...styles.logLine, ...getLogStyle(line.type) }}>
            <span style={styles.logTimestamp}>{formatTime(line.ts)}</span>
            <span>{getLogPrefix(line.type)}</span>
            <span>{line.text}</span>
          </div>
        ))}
        {sending && (
          <div style={{ ...styles.logLine, color: "#f59e0b", opacity: 0.7 }}>
            <span>⟳ Envoi en cours...</span>
          </div>
        )}
      </div>

      {/* Zone de saisie */}
      <div
        style={styles.inputRow}
        onClick={() => inputRef.current?.focus()}
      >
        <span style={styles.prompt}>&gt;</span>
        <input
          ref={inputRef}
          style={styles.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Tapez une commande ou une mission..."
          disabled={sending}
          aria-label="Console LaRuche — saisie de commande"
          autoComplete="off"
          spellCheck={false}
        />
        <button
          style={{
            ...styles.sendBtn,
            opacity: sending || !input.trim() ? 0.4 : 1,
            cursor: sending || !input.trim() ? "default" : "pointer",
          }}
          onClick={() => sendCommand(input)}
          disabled={sending || !input.trim()}
          aria-label="Envoyer la commande"
        >
          ↵
        </button>
      </div>
    </div>
  );
}
