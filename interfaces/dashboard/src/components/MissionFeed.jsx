/**
 * MissionFeed.jsx — Historique scrollable des missions
 * Affiche les missions avec statut, durée, modèles utilisés
 */

import React, { useState, useEffect, useRef } from "react";

// ─── Mock data ────────────────────────────────────────────────────────────────
const MOCK_MISSIONS = [
  {
    id: "m1",
    command: "Analyse les performances du système et propose des optimisations",
    status: "success",
    duration: 12400,
    models: ["llama3.2", "codellama"],
    ts: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
  },
  {
    id: "m2",
    command: "Génère un rapport de sécurité sur les dépendances npm",
    status: "running",
    duration: null,
    models: ["mistral"],
    ts: new Date(Date.now() - 45 * 1000).toISOString(),
    progress: 67,
  },
  {
    id: "m3",
    command: "Refactor la fonction butterflyLoop pour meilleure lisibilité",
    status: "success",
    duration: 8700,
    models: ["codellama"],
    ts: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
  },
  {
    id: "m4",
    command: "Créer des tests unitaires pour model_router.js",
    status: "error",
    duration: 3200,
    models: ["codellama"],
    ts: new Date(Date.now() - 32 * 60 * 1000).toISOString(),
    error: "Timeout Ollama",
  },
  {
    id: "m5",
    command: "Summarize last 24h logs",
    status: "success",
    duration: 5100,
    models: ["llama3.2"],
    ts: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDuration(ms) {
  if (!ms) return null;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTimestamp(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now - date;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "À l'instant";
  if (diffMin < 60) return `il y a ${diffMin}min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `il y a ${diffH}h`;
  return date.toLocaleDateString("fr-FR");
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = {
  wrapper: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
  },
  header: {
    padding: "16px 16px 8px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: {
    fontSize: "12px",
    fontWeight: 600,
    color: "var(--text-3)",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },
  count: {
    fontSize: "11px",
    color: "var(--text-3)",
    background: "var(--surface-3)",
    padding: "2px 8px",
    borderRadius: "12px",
  },
  feed: {
    overflowY: "auto",
    maxHeight: "400px",
    padding: "0 8px 8px",
  },
  item: {
    background: "var(--surface-2)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    padding: "12px 14px",
    marginBottom: "6px",
    transition: "background 0.15s ease",
    cursor: "pointer",
  },
  itemHover: {
    background: "var(--surface-3)",
  },
  itemTop: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "8px",
    marginBottom: "8px",
  },
  command: {
    fontSize: "13px",
    color: "var(--text)",
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  badges: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    flexShrink: 0,
  },
  badge: {
    fontSize: "10px",
    fontWeight: 600,
    padding: "2px 7px",
    borderRadius: "4px",
    letterSpacing: "0.04em",
  },
  itemBottom: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
  },
  timestamp: {
    fontSize: "11px",
    color: "var(--text-3)",
  },
  models: {
    display: "flex",
    gap: "4px",
    flexWrap: "wrap",
  },
  modelTag: {
    fontSize: "10px",
    color: "var(--text-3)",
    background: "var(--surface-4)",
    padding: "1px 6px",
    borderRadius: "3px",
    fontFamily: "JetBrains Mono, monospace",
  },
  progressBar: {
    height: "3px",
    background: "var(--surface-4)",
    borderRadius: "2px",
    marginTop: "8px",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: "2px",
    background: "linear-gradient(90deg, var(--primary), #f59e0b)",
    transition: "width 0.5s ease",
  },
  detailBtn: {
    fontSize: "11px",
    color: "var(--primary)",
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: "0",
    textDecoration: "underline",
    flexShrink: 0,
  },
  emptyState: {
    textAlign: "center",
    padding: "32px 16px",
    color: "var(--text-3)",
    fontSize: "13px",
  },
};

function getStatusStyle(status) {
  switch (status) {
    case "success":
      return { background: "rgba(74, 222, 128, 0.12)", color: "#4ade80" };
    case "error":
      return { background: "rgba(248, 113, 113, 0.12)", color: "#f87171" };
    case "running":
      return { background: "rgba(245, 158, 11, 0.15)", color: "#f59e0b", animation: "pulse 2s ease-in-out infinite" };
    default:
      return { background: "var(--surface-3)", color: "var(--text-2)" };
  }
}

function getStatusLabel(status) {
  const labels = { success: "✓ OK", error: "✗ Err", running: "⟳ Run" };
  return labels[status] || status;
}

// ─── Composant MissionItem ────────────────────────────────────────────────────
function MissionItem({ mission, onSelectMission }) {
  const [hovered, setHovered] = useState(false);
  const isRunning = mission.status === "running";

  return (
    <div
      style={{ ...styles.item, ...(hovered ? styles.itemHover : {}) }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={styles.itemTop}>
        <div style={styles.command} title={mission.command}>
          {mission.command}
        </div>
        <div style={styles.badges}>
          {mission.duration && (
            <span style={{ ...styles.badge, background: "var(--surface-4)", color: "var(--text-3)" }}>
              {formatDuration(mission.duration)}
            </span>
          )}
          <span style={{ ...styles.badge, ...getStatusStyle(mission.status) }}>
            {getStatusLabel(mission.status)}
          </span>
        </div>
      </div>

      {/* Barre de progression pour missions en cours */}
      {isRunning && (
        <div style={styles.progressBar}>
          <div style={{ ...styles.progressFill, width: `${mission.progress || 0}%` }} />
        </div>
      )}

      <div style={styles.itemBottom}>
        <div style={styles.timestamp}>{formatTimestamp(mission.ts)}</div>
        <div style={styles.models}>
          {mission.models?.map((m) => (
            <span key={m} style={styles.modelTag}>{m}</span>
          ))}
        </div>
        {onSelectMission && (
          <button
            style={styles.detailBtn}
            onClick={() => onSelectMission(mission)}
            aria-label={`Voir détails de la mission: ${mission.command}`}
          >
            Voir détails
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Composant principal MissionFeed ─────────────────────────────────────────
/**
 * @param {{ missions?: Array, onSelectMission?: Function }} props
 */
export default function MissionFeed({ missions: missionsProp, onSelectMission }) {
  const [missions, setMissions] = useState(MOCK_MISSIONS);
  const [loading, setLoading] = useState(!missionsProp);

  useEffect(() => {
    if (missionsProp) {
      setMissions(missionsProp);
      setLoading(false);
      return;
    }

    const fetchMissions = async () => {
      try {
        const res = await fetch("/api/missions", { signal: AbortSignal.timeout(3000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setMissions(data.missions || data);
      } catch {
        // Fallback silencieux sur mock data
        setMissions(MOCK_MISSIONS);
      } finally {
        setLoading(false);
      }
    };

    fetchMissions();
    const interval = setInterval(fetchMissions, 3000);
    return () => clearInterval(interval);
  }, [missionsProp]);

  const runningCount = missions.filter((m) => m.status === "running").length;

  return (
    <div style={styles.wrapper}>
      <div style={styles.header}>
        <span style={styles.sectionTitle}>
          Missions
          {runningCount > 0 && (
            <span style={{ color: "#f59e0b", marginLeft: "6px", animation: "pulse 2s ease-in-out infinite" }}>
              ({runningCount} actif{runningCount > 1 ? "s" : ""})
            </span>
          )}
        </span>
        <span style={styles.count}>{missions.length}</span>
      </div>

      {loading ? (
        <div style={styles.emptyState}>Chargement...</div>
      ) : missions.length === 0 ? (
        <div style={styles.emptyState}>Aucune mission pour l'instant</div>
      ) : (
        <div style={styles.feed}>
          {missions.map((mission) => (
            <MissionItem
              key={mission.id || mission.ts}
              mission={mission}
              onSelectMission={onSelectMission}
            />
          ))}
        </div>
      )}
    </div>
  );
}
