/**
 * App.jsx — LaRuche Ghost-Monitor HUD
 * ThoughtStream | CodeLive | MissionBar | GhostCursor | HITLModal | LiveFeed | ThermalGauge
 */

import React, { useState, useEffect, useRef, useCallback } from "react";

// Throttle HUD events to avoid excessive re-renders
const THROTTLE_MS = {
  low: 500,
  balanced: 200,
  high: 33,
}[window.__LARUCHE_MODE__ || "balanced"] || 200;

function useThrottledState(initial, ms = THROTTLE_MS) {
  const [state, setState] = React.useState(initial);
  const lastUpdate = React.useRef(0);
  const throttledSet = React.useCallback((value) => {
    const now = Date.now();
    if (now - lastUpdate.current >= ms) {
      lastUpdate.current = now;
      setState(value);
    }
  }, [ms]);
  return [state, throttledSet, setState];
}

// ─── Styles inline (pas de CSS externe pour le HUD transparent) ───────────────
const styles = {
  thoughtStream: {
    position: "fixed",
    top: 20,
    right: 20,
    width: 320,
    maxHeight: 200,
    background: "rgba(0, 0, 0, 0.65)",
    backdropFilter: "blur(8px)",
    borderRadius: 12,
    border: "1px solid rgba(245, 166, 35, 0.3)",
    padding: 12,
    color: "#F5A623",
    fontSize: 11,
    fontFamily: "JetBrains Mono, monospace",
    overflowY: "auto",
    zIndex: 9999,
  },
  missionBar: {
    position: "fixed",
    top: 20,
    left: 20,
    width: 280,
    background: "rgba(0, 0, 0, 0.70)",
    backdropFilter: "blur(8px)",
    borderRadius: 10,
    border: "1px solid rgba(124, 58, 237, 0.4)",
    padding: "10px 14px",
    color: "#E0E0E0",
    fontSize: 12,
    zIndex: 9999,
  },
  codeLive: {
    position: "fixed",
    bottom: 60,
    left: 0,
    right: 0,
    height: "22vh",
    background: "rgba(13, 13, 26, 0.80)",
    backdropFilter: "blur(10px)",
    borderTop: "1px solid rgba(124, 58, 237, 0.3)",
    padding: "8px 16px",
    color: "#A3E635",
    fontSize: 11,
    fontFamily: "JetBrains Mono, monospace",
    overflowY: "auto",
    zIndex: 9998,
  },
  liveFeed: {
    position: "fixed",
    bottom: 10,
    left: 20,
    width: 300,
    background: "rgba(0, 0, 0, 0.55)",
    borderRadius: 8,
    padding: "6px 10px",
    color: "#94A3B8",
    fontSize: 10,
    fontFamily: "JetBrains Mono, monospace",
    zIndex: 9999,
  },
  thermalGauge: {
    position: "fixed",
    bottom: 10,
    right: 20,
    width: 160,
    background: "rgba(0, 0, 0, 0.55)",
    borderRadius: 8,
    padding: "6px 10px",
    color: "#94A3B8",
    fontSize: 10,
    zIndex: 9999,
  },
  hitlModal: {
    position: "fixed",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    width: 480,
    background: "rgba(13, 13, 26, 0.95)",
    backdropFilter: "blur(20px)",
    borderRadius: 16,
    border: "2px solid #F5A623",
    padding: 24,
    color: "#E0E0E0",
    zIndex: 10000,
    boxShadow: "0 0 40px rgba(245, 166, 35, 0.3)",
  },
  ghostCursor: {
    position: "fixed",
    pointerEvents: "none",
    zIndex: 10001,
  },
};

// ─── GhostCursor ──────────────────────────────────────────────────────────────
const GhostCursor = React.memo(function GhostCursor({ x, y, label, visible }) {
  if (!visible) return null;
  return (
    <div style={{ ...styles.ghostCursor, left: x - 20, top: y - 20 }}>
      <svg width={40} height={40}>
        <circle
          cx={20}
          cy={20}
          r={16}
          fill="none"
          stroke="#F5A623"
          strokeWidth={2}
          opacity={0.8}
        >
          <animate attributeName="r" values="12;18;12" dur="0.8s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.8;0.3;0.8" dur="0.8s" repeatCount="indefinite" />
        </circle>
        <circle cx={20} cy={20} r={3} fill="#F5A623" />
      </svg>
      {label && (
        <div style={{
          position: "absolute",
          top: 44,
          left: "50%",
          transform: "translateX(-50%)",
          background: "rgba(0,0,0,0.8)",
          color: "#F5A623",
          fontSize: 10,
          padding: "2px 6px",
          borderRadius: 4,
          whiteSpace: "nowrap",
        }}>
          {label}
        </div>
      )}
    </div>
  );
});

// ─── HITLModal ────────────────────────────────────────────────────────────────
const HITLModal = React.memo(function HITLModal({ event, onResponse }) {
  const [countdown, setCountdown] = useState(60);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          onResponse(false);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div style={styles.hitlModal}>
      <div style={{ color: "#F5A623", fontSize: 16, fontWeight: "bold", marginBottom: 12 }}>
        ⚠️ VALIDATION REQUISE
      </div>
      <div style={{ fontSize: 13, marginBottom: 16, lineHeight: 1.6 }}>
        {event.message || "Action critique détectée. Confirmer ?"}
      </div>
      <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 16 }}>
        <div style={{ fontSize: 11, color: "#64748B", alignSelf: "center" }}>
          Auto-reject dans {countdown}s
        </div>
        <button
          onClick={() => onResponse(false)}
          style={{
            background: "rgba(239, 68, 68, 0.2)",
            border: "1px solid #EF4444",
            color: "#EF4444",
            padding: "8px 20px",
            borderRadius: 8,
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          ✗ REJECT
        </button>
        <button
          onClick={() => onResponse(true)}
          style={{
            background: "rgba(34, 197, 94, 0.2)",
            border: "1px solid #22C55E",
            color: "#22C55E",
            padding: "8px 20px",
            borderRadius: 8,
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          ✓ APPROVE
        </button>
      </div>
    </div>
  );
});

// ─── App Principal ────────────────────────────────────────────────────────────
export default function App() {
  const [thoughts, setThoughts] = useState([]);
  const [codeLive, setCodeLive] = useState("");
  const [mission, setMission] = useState({ text: "En attente...", progress: 0, agent: "—", cost: 0 });
  const [liveFeed, setLiveFeed] = useState([]);
  const [ghost, setGhost] = useState({ x: 0, y: 0, label: "", visible: false });
  const [hitl, setHitl] = useState(null);
  const [status, setStatus] = useState("IDLE");

  const statusColors = {
    IDLE: "#64748B",
    THINKING: "#F5A623",
    ACTING: "#7C3AED",
    SPEAKING: "#22C55E",
    ERROR: "#EF4444",
  };

  useEffect(() => {
    if (!window.laruche) return;

    window.laruche.onHudEvent((event) => {
      switch (event.type) {
        case "thinking":
          setStatus("THINKING");
          setThoughts((prev) => [...prev.slice(-10), `[${event.agent}] ${event.thought}`]);
          break;

        case "mission_start":
          setStatus("ACTING");
          setMission({ text: event.command, progress: 0, agent: "L1_Gemini", cost: 0 });
          break;

        case "plan_ready":
          setMission((m) => ({ ...m, progress: 10 }));
          break;

        case "task_start":
          setMission((m) => ({ ...m, agent: "L3_Kimi", progress: Math.min(m.progress + 15, 90) }));
          setLiveFeed((prev) => [event.task, ...prev].slice(0, 8));
          break;

        case "task_done":
          setMission((m) => ({ ...m, progress: Math.min(m.progress + 10, 95) }));
          break;

        case "mission_complete":
          setStatus("IDLE");
          setMission((m) => ({ ...m, progress: 100, cost: event.cost || 0 }));
          break;

        case "mission_error":
          setStatus("ERROR");
          break;

        case "code_chunk":
          setCodeLive((prev) => (prev + event.code).slice(-2000));
          break;

        case "ghost_aim":
          setGhost({ x: event.x, y: event.y, label: event.label, visible: true });
          break;

        case "ghost_click":
          setGhost((g) => ({ ...g, visible: false }));
          break;

        case "hitl_request":
          setHitl(event);
          break;

        case "ai_paused":
          setStatus("IDLE");
          break;

        case "kill_all":
          setStatus("IDLE");
          setMission({ text: "KILL_ALL reçu", progress: 0, agent: "—", cost: 0 });
          break;
      }
    });
  }, []);

  const handleHitl = useCallback((approved) => {
    if (window.laruche) {
      window.laruche.sendHitlResponse(approved, hitl?.missionId);
    }
    setHitl(null);
  }, [hitl]);

  return (
    <>
      {/* MissionBar — Coin supérieur gauche */}
      <div style={styles.missionBar}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <div style={{
            width: 8, height: 8, borderRadius: "50%",
            background: statusColors[status] || "#64748B",
            boxShadow: `0 0 6px ${statusColors[status] || "#64748B"}`,
          }} />
          <span style={{ fontSize: 11, color: "#94A3B8" }}>{status}</span>
          <span style={{ fontSize: 10, color: "#4B5563", marginLeft: "auto" }}>
            ${mission.cost?.toFixed(4) || "0.0000"}
          </span>
        </div>
        <div style={{ fontSize: 12, color: "#E0E0E0", marginBottom: 6, lineHeight: 1.4 }}>
          {mission.text?.substring(0, 60)}
        </div>
        <div style={{ background: "rgba(255,255,255,0.1)", borderRadius: 4, height: 4 }}>
          <div style={{
            background: statusColors[status] || "#7C3AED",
            borderRadius: 4,
            height: "100%",
            width: `${mission.progress}%`,
            transition: "width 0.3s ease",
          }} />
        </div>
        <div style={{ fontSize: 10, color: "#4B5563", marginTop: 4 }}>
          Agent: {mission.agent}
        </div>
      </div>

      {/* ThoughtStream — Coin supérieur droit */}
      {thoughts.length > 0 && (
        <div style={styles.thoughtStream}>
          <div style={{ fontSize: 10, color: "#7C3AED", marginBottom: 6 }}>🧠 PENSÉES</div>
          {thoughts.slice(-5).map((t, i) => (
            <div key={i} style={{ marginBottom: 4, opacity: 0.7 + (i / thoughts.length) * 0.3 }}>
              {t}
            </div>
          ))}
        </div>
      )}

      {/* CodeLive — Bas écran */}
      {codeLive && (
        <div style={styles.codeLive}>
          <div style={{ fontSize: 10, color: "#7C3AED", marginBottom: 4 }}>⚡ CODE LIVE</div>
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{codeLive.slice(-1000)}</pre>
        </div>
      )}

      {/* LiveFeed — Coin inférieur gauche */}
      {liveFeed.length > 0 && (
        <div style={styles.liveFeed}>
          {liveFeed.map((f, i) => (
            <div key={i} style={{ opacity: 1 - i * 0.1 }}>📁 {f}</div>
          ))}
        </div>
      )}

      {/* GhostCursor */}
      <GhostCursor {...ghost} />

      {/* HITLModal */}
      {hitl && <HITLModal event={hitl} onResponse={handleHitl} />}
    </>
  );
}
