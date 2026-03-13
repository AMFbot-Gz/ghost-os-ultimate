/**
 * Sidebar.jsx — Navigation latérale style Claude.ai
 * Logo + Nouvelle Mission + Historique + Status système
 */

import React, { useState } from "react";

const QUEEN_API = import.meta.env.VITE_QUEEN_API || "http://localhost:3000";

// ─── Icônes SVG inline ────────────────────────────────────────────────────────
const Icon = {
  Plus: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  ),
  Mission: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
    </svg>
  ),
  Agents: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
    </svg>
  ),
  Logs: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/>
      <line x1="8" y1="17" x2="16" y2="17"/>
    </svg>
  ),
  Check: () => (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
  Error: () => (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  ),
  Spinner: () => (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
      style={{ animation: "spin 1s linear infinite" }}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
    </svg>
  ),
  Settings: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  ),
};

// ─── Indicateur de statut mission ────────────────────────────────────────────
function MissionStatusDot({ status }) {
  if (status === "success") return (
    <span style={{ color: "var(--green)", display: "flex", alignItems: "center" }}><Icon.Check /></span>
  );
  if (status === "error") return (
    <span style={{ color: "var(--red)", display: "flex", alignItems: "center" }}><Icon.Error /></span>
  );
  if (status === "running" || status === "pending") return (
    <span style={{ color: "var(--primary)", display: "flex", alignItems: "center" }}><Icon.Spinner /></span>
  );
  return <span style={{ width: 10, height: 10, background: "var(--surface-4)", borderRadius: "50%", display: "inline-block" }} />;
}

// ─── Item de mission dans l'historique ────────────────────────────────────────
function MissionItem({ mission, isActive, onClick }) {
  const [hovered, setHovered] = useState(false);
  const time = mission.startedAt || mission.ts
    ? new Date(mission.startedAt || mission.ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
    : "";

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px",
        borderRadius: "var(--radius-sm)",
        border: "none",
        background: isActive ? "var(--surface-3)" : hovered ? "var(--surface-2)" : "transparent",
        cursor: "pointer",
        textAlign: "left",
        transition: "background 0.15s",
      }}
    >
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
        <MissionStatusDot status={mission.status} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12,
          color: isActive ? "var(--text)" : "var(--text-2)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontWeight: isActive ? 500 : 400,
        }}>
          {mission.command}
        </div>
        {time && (
          <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 1 }}>
            {time}
          </div>
        )}
      </div>
    </button>
  );
}

// ─── Section nav ─────────────────────────────────────────────────────────────
function NavItem({ icon, label, active, onClick }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px",
        borderRadius: "var(--radius-sm)",
        border: "none",
        background: active ? "var(--surface-3)" : hovered ? "var(--surface-2)" : "transparent",
        color: active ? "var(--text)" : "var(--text-2)",
        cursor: "pointer",
        fontSize: 13,
        fontWeight: active ? 500 : 400,
        transition: "all 0.15s",
        textAlign: "left",
      }}
    >
      <span style={{ opacity: active ? 1 : 0.7 }}>{icon}</span>
      {label}
    </button>
  );
}

// ─── Panel Agents ─────────────────────────────────────────────────────────────
function AgentsPanel({ status }) {
  const models = status.models || {};
  const agents = [
    { role: "Stratège",    key: "strategist",  emoji: "🧠" },
    { role: "Architecte",  key: "architect",   emoji: "⚡" },
    { role: "Worker",      key: "worker",      emoji: "🔧" },
    { role: "Vision",      key: "vision",      emoji: "👁" },
    { role: "Synthèse",    key: "synthesizer", emoji: "✨" },
  ];

  return (
    <div style={{ padding: "8px 12px", flex: 1, overflowY: "auto" }}>
      <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 10, padding: "0 0" }}>
        Agents actifs
      </div>
      {agents.map(a => (
        <div key={a.key} style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 8px",
          borderRadius: "var(--radius-sm)",
          marginBottom: 2,
        }}>
          <span style={{ fontSize: 14 }}>{a.emoji}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 500 }}>{a.role}</div>
            <div style={{ fontSize: 10, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {models[a.key] || "—"}
            </div>
          </div>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: models[a.key] ? "var(--green)" : "var(--text-3)", flexShrink: 0 }} />
        </div>
      ))}
    </div>
  );
}

// ─── Panel Logs ───────────────────────────────────────────────────────────────
function LogsPanel({ logs }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [logs]);

  return (
    <div ref={ref} style={{ padding: "8px 12px", flex: 1, overflowY: "auto", fontFamily: "monospace" }}>
      <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 10 }}>
        Logs temps réel
      </div>
      {logs.length === 0 ? (
        <div style={{ fontSize: 11, color: "var(--text-3)" }}>En attente d'événements...</div>
      ) : (
        logs.slice(-80).map((l, i) => (
          <div key={i} style={{
            fontSize: 10,
            color: l.includes("error") || l.includes("ERROR") ? "var(--red)" : "var(--text-3)",
            padding: "1px 0",
            lineHeight: 1.4,
            wordBreak: "break-all",
          }}>
            {l}
          </div>
        ))
      )}
    </div>
  );
}

// ─── Sidebar principale ───────────────────────────────────────────────────────
export default function Sidebar({ missions, status, activeMissionId, onSelectMission, view, onViewChange, logs }) {
  const [newMissionHovered, setNewMissionHovered] = useState(false);

  const services = [
    { name: "API",    ok: status.status === "online" },
    { name: "Ollama", ok: status.ollama?.ok },
    { name: "HUD",    ok: true },
  ];

  return (
    <aside style={{
      width: "var(--sidebar-w)",
      flexShrink: 0,
      background: "var(--surface)",
      borderRight: "1px solid var(--border)",
      display: "flex",
      flexDirection: "column",
      height: "100vh",
      overflow: "hidden",
    }}>
      {/* ── Logo ── */}
      <div style={{
        padding: "16px 14px 14px",
        borderBottom: "1px solid var(--border)",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ fontSize: 22, lineHeight: 1 }}>🐝</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", letterSpacing: "-0.01em" }}>
              LaRuche HQ
            </div>
            <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 1 }}>
              v3.2 · standalone
            </div>
          </div>
        </div>
      </div>

      {/* ── Bouton Nouvelle Mission ── */}
      <div style={{ padding: "12px 10px 8px", flexShrink: 0 }}>
        <button
          onClick={() => { onSelectMission(null); onViewChange("missions"); }}
          onMouseEnter={() => setNewMissionHovered(true)}
          onMouseLeave={() => setNewMissionHovered(false)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 12px",
            borderRadius: "var(--radius)",
            border: "1px solid var(--border-2)",
            background: newMissionHovered ? "var(--surface-3)" : "var(--surface-2)",
            color: "var(--text-2)",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 500,
            transition: "all 0.15s",
          }}
        >
          <Icon.Plus />
          Nouvelle mission
        </button>
      </div>

      {/* ── Navigation ── */}
      <div style={{ padding: "4px 10px 8px", flexShrink: 0 }}>
        <NavItem icon={<Icon.Mission />} label="Missions"   active={view === "missions"} onClick={() => onViewChange("missions")} />
        <NavItem icon={<Icon.Agents />}  label="Agents"     active={view === "agents"}   onClick={() => onViewChange("agents")} />
        <NavItem icon={<Icon.Logs />}    label="Logs"       active={view === "logs"}     onClick={() => onViewChange("logs")} />
      </div>

      <div style={{ height: 1, background: "var(--border)", marginInline: 14, marginBottom: 8, flexShrink: 0 }} />

      {/* ── Contenu selon la vue ── */}
      {view === "missions" && (
        <div style={{ flex: 1, overflowY: "auto", padding: "0 10px" }}>
          {missions.length === 0 ? (
            <div style={{ fontSize: 11, color: "var(--text-3)", padding: "12px 10px" }}>
              Aucune mission.
            </div>
          ) : (
            <>
              <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", padding: "2px 10px 6px" }}>
                Historique
              </div>
              {missions.map(m => (
                <MissionItem
                  key={m.id || m.ts}
                  mission={m}
                  isActive={activeMissionId === (m.id || m.ts)}
                  onClick={() => onSelectMission(m.id || m.ts)}
                />
              ))}
            </>
          )}
        </div>
      )}

      {view === "agents" && <AgentsPanel status={status} />}
      {view === "logs"   && <LogsPanel logs={logs} />}

      {/* ── Status système en bas ── */}
      <div style={{
        borderTop: "1px solid var(--border)",
        padding: "10px 14px",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", gap: 12 }}>
          {services.map(s => (
            <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11 }}>
              <span style={{
                width: 5, height: 5, borderRadius: "50%",
                background: s.ok ? "var(--green)" : "var(--text-3)",
                boxShadow: s.ok ? "0 0 5px var(--green)" : "none",
              }} />
              <span style={{ color: "var(--text-3)" }}>{s.name}</span>
            </div>
          ))}
        </div>
        {status.missions && (
          <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 5 }}>
            {status.missions.total} missions · {status.missions.success} réussies
          </div>
        )}
      </div>
    </aside>
  );
}
