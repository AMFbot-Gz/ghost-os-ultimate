/**
 * HUDOverlay.jsx — Widget overlay Electron, coin inférieur droit
 * Glassmorphism : MissionBar + ThoughtStream + ThermalGauge
 * Aucune dépendance externe — CSS variables + styles inline
 */

import React, { useState } from "react";

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = {
  overlay: {
    position: "fixed",
    bottom: "20px",
    right: "20px",
    width: "320px",
    display: "flex",
    flexDirection: "column",
    gap: "0",
    zIndex: 9999,
    // Glassmorphism
    background: "rgba(13, 13, 13, 0.80)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    border: "1px solid rgba(255, 255, 255, 0.08)",
    borderRadius: "14px",
    overflow: "hidden",
    boxShadow: "0 8px 32px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.3)",
  },

  // ── MissionBar ──
  missionBar: {
    padding: "12px 14px",
    borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
  },
  missionHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "8px",
  },
  agentName: {
    fontSize: "11px",
    fontWeight: 600,
    color: "#F5A623",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  timer: {
    fontSize: "10px",
    color: "rgba(255,255,255,0.4)",
    fontFamily: "JetBrains Mono, monospace",
  },
  progressTrack: {
    height: "4px",
    background: "rgba(255, 255, 255, 0.08)",
    borderRadius: "2px",
    overflow: "hidden",
    marginBottom: "6px",
  },
  progressFill: (pct) => ({
    height: "100%",
    width: `${Math.min(100, Math.max(0, pct))}%`,
    background: "linear-gradient(90deg, #E07B54, #F5A623)",
    borderRadius: "2px",
    transition: "width 0.4s ease",
  }),
  missionText: {
    fontSize: "11px",
    color: "rgba(255, 255, 255, 0.55)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },

  // ── ThoughtStream ──
  thoughtSection: {
    borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
  },
  thoughtHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 14px",
    cursor: "pointer",
    userSelect: "none",
  },
  thoughtTitle: {
    fontSize: "10px",
    fontWeight: 600,
    color: "rgba(124, 58, 237, 0.9)",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  collapseIcon: (expanded) => ({
    fontSize: "10px",
    color: "rgba(255,255,255,0.3)",
    transform: expanded ? "rotate(0deg)" : "rotate(-90deg)",
    transition: "transform 0.2s ease",
  }),
  thoughtBody: {
    padding: "0 14px 10px",
    maxHeight: "100px",
    overflowY: "auto",
  },
  thoughtLine: {
    fontSize: "11px",
    color: "#F5A623",
    fontFamily: "JetBrains Mono, monospace",
    marginBottom: "3px",
    opacity: 0.85,
    animation: "none",
  },
  tokenCount: {
    fontSize: "10px",
    color: "rgba(255,255,255,0.25)",
    marginTop: "4px",
    fontFamily: "JetBrains Mono, monospace",
  },

  // ── ThermalGauge ──
  thermalSection: {
    padding: "10px 14px",
  },
  thermalTitle: {
    fontSize: "10px",
    fontWeight: 600,
    color: "rgba(255, 255, 255, 0.3)",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    marginBottom: "8px",
  },
  gaugeRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginBottom: "5px",
  },
  gaugeLabel: {
    fontSize: "10px",
    color: "rgba(255,255,255,0.45)",
    fontFamily: "JetBrains Mono, monospace",
    width: "30px",
    flexShrink: 0,
  },
  gaugeTrack: {
    flex: 1,
    height: "6px",
    background: "rgba(255, 255, 255, 0.07)",
    borderRadius: "3px",
    overflow: "hidden",
  },
  gaugeFill: (pct, color) => ({
    height: "100%",
    width: `${Math.min(100, Math.max(0, pct))}%`,
    background: color,
    borderRadius: "3px",
    transition: "width 0.5s ease",
  }),
  gaugeValue: {
    fontSize: "10px",
    color: "rgba(255,255,255,0.5)",
    fontFamily: "JetBrains Mono, monospace",
    width: "32px",
    textAlign: "right",
    flexShrink: 0,
  },
};

function getThermalColor(pct) {
  if (pct < 50) return "#4ade80";
  if (pct < 75) return "#fbb24c";
  if (pct < 90) return "#f87171";
  return "#ef4444";
}

// ─── Composant MissionBar ─────────────────────────────────────────────────────
function MissionBar({ progress = 0, agentName = "—", missionText = "En attente..." }) {
  const [elapsed, setElapsed] = React.useState(0);

  React.useEffect(() => {
    if (progress > 0 && progress < 100) {
      const interval = setInterval(() => setElapsed((e) => e + 1), 1000);
      return () => clearInterval(interval);
    }
    if (progress === 0) setElapsed(0);
  }, [progress]);

  const formatElapsed = (s) => {
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m${s % 60}s`;
  };

  return (
    <div style={styles.missionBar}>
      <div style={styles.missionHeader}>
        <span style={styles.agentName}>{agentName}</span>
        <span style={styles.timer}>
          {progress > 0 && progress < 100 ? formatElapsed(elapsed) : `${progress}%`}
        </span>
      </div>
      <div style={styles.progressTrack}>
        <div style={styles.progressFill(progress)} />
      </div>
      <div style={styles.missionText}>{missionText}</div>
    </div>
  );
}

// ─── Composant ThoughtStream ──────────────────────────────────────────────────
function ThoughtStream({ tokens = [], totalTokens = 0 }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div style={styles.thoughtSection}>
      <div style={styles.thoughtHeader} onClick={() => setExpanded((v) => !v)}>
        <span style={styles.thoughtTitle}>🧠 Pensées</span>
        <span style={styles.collapseIcon(expanded)}>▼</span>
      </div>
      {expanded && (
        <div style={styles.thoughtBody}>
          {tokens.length === 0 ? (
            <div style={{ ...styles.thoughtLine, opacity: 0.3 }}>En attente...</div>
          ) : (
            tokens.slice(-5).map((token, i) => (
              <div
                key={i}
                style={{ ...styles.thoughtLine, opacity: 0.6 + i * 0.08 }}
              >
                {token}
              </div>
            ))
          )}
          {totalTokens > 0 && (
            <div style={styles.tokenCount}>{totalTokens.toLocaleString()} tokens générés</div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Composant ThermalGauge ───────────────────────────────────────────────────
function ThermalGauge({ cpuTemp = 42, gpuTemp = 58 }) {
  return (
    <div style={styles.thermalSection}>
      <div style={styles.thermalTitle}>Thermique</div>

      <div style={styles.gaugeRow}>
        <div style={styles.gaugeLabel}>CPU</div>
        <div style={styles.gaugeTrack}>
          <div style={styles.gaugeFill(cpuTemp, getThermalColor(cpuTemp))} />
        </div>
        <div style={styles.gaugeValue}>{cpuTemp}%</div>
      </div>

      <div style={styles.gaugeRow}>
        <div style={styles.gaugeLabel}>GPU</div>
        <div style={styles.gaugeTrack}>
          <div style={styles.gaugeFill(gpuTemp, getThermalColor(gpuTemp))} />
        </div>
        <div style={styles.gaugeValue}>{gpuTemp}%</div>
      </div>
    </div>
  );
}

// ─── Composant principal HUDOverlay ──────────────────────────────────────────
/**
 * @param {{
 *   missionProgress?: number,
 *   agentName?: string,
 *   missionText?: string,
 *   tokens?: string[],
 *   totalTokens?: number,
 *   cpuTemp?: number,
 *   gpuTemp?: number
 * }} props
 */
export default function HUDOverlay({
  missionProgress = 0,
  agentName = "Stratège",
  missionText = "En attente d'une mission...",
  tokens = [],
  totalTokens = 0,
  cpuTemp = 42,
  gpuTemp = 58,
}) {
  return (
    <div style={styles.overlay}>
      <MissionBar
        progress={missionProgress}
        agentName={agentName}
        missionText={missionText}
      />
      <ThoughtStream tokens={tokens} totalTokens={totalTokens} />
      <ThermalGauge cpuTemp={cpuTemp} gpuTemp={gpuTemp} />
    </div>
  );
}
