/**
 * HITLModal.jsx — Human-in-the-Loop Modal
 * Modal plein écran, glassmorphism sombre, countdown SVG 60s, IPC Electron
 * Auto-rejet après 60 secondes
 */

import React, { useState, useEffect, useCallback } from "react";

const COUNTDOWN_DURATION = 60; // secondes
const CIRCLE_RADIUS = 28;
const CIRCLE_CIRCUMFERENCE = 2 * Math.PI * CIRCLE_RADIUS;

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0, 0, 0, 0.75)",
    backdropFilter: "blur(6px)",
    WebkitBackdropFilter: "blur(6px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10000,
    animation: "slideUp 0.2s ease both",
  },
  modal: {
    width: "min(480px, 90vw)",
    background: "rgba(13, 13, 26, 0.95)",
    backdropFilter: "blur(20px)",
    WebkitBackdropFilter: "blur(20px)",
    borderRadius: "16px",
    border: "2px solid #F5A623",
    padding: "28px",
    boxShadow: "0 0 40px rgba(245, 166, 35, 0.25), 0 8px 32px rgba(0, 0, 0, 0.6)",
    display: "flex",
    flexDirection: "column",
    gap: "20px",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: "14px",
  },
  warningIcon: {
    fontSize: "32px",
    lineHeight: 1,
    flexShrink: 0,
    filter: "drop-shadow(0 0 8px rgba(245, 166, 35, 0.6))",
  },
  titleGroup: {
    flex: 1,
  },
  title: {
    fontSize: "16px",
    fontWeight: 700,
    color: "#F5A623",
    marginBottom: "4px",
  },
  subtitle: {
    fontSize: "12px",
    color: "rgba(255, 255, 255, 0.45)",
  },
  actionBox: {
    background: "rgba(248, 113, 113, 0.07)",
    border: "1px solid rgba(248, 113, 113, 0.35)",
    borderRadius: "8px",
    padding: "14px 16px",
    fontSize: "13px",
    color: "#f9a8a8",
    lineHeight: 1.6,
    fontFamily: "JetBrains Mono, monospace",
    wordBreak: "break-word",
  },
  countdownRow: {
    display: "flex",
    alignItems: "center",
    gap: "14px",
  },
  countdownLabel: {
    fontSize: "12px",
    color: "rgba(255, 255, 255, 0.4)",
    flex: 1,
  },
  countdownNumber: {
    fontSize: "20px",
    fontWeight: 700,
    fontFamily: "JetBrains Mono, monospace",
  },
  buttonsGroup: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  approveBtn: {
    width: "100%",
    padding: "12px",
    background: "rgba(74, 222, 128, 0.12)",
    border: "1px solid #4ade80",
    borderRadius: "8px",
    color: "#4ade80",
    fontSize: "14px",
    fontWeight: 700,
    cursor: "pointer",
    transition: "all 0.15s ease",
    letterSpacing: "0.06em",
  },
  rejectBtn: {
    width: "100%",
    padding: "12px",
    background: "rgba(248, 113, 113, 0.12)",
    border: "1px solid #f87171",
    borderRadius: "8px",
    color: "#f87171",
    fontSize: "14px",
    fontWeight: 700,
    cursor: "pointer",
    transition: "all 0.15s ease",
    letterSpacing: "0.06em",
  },
};

// ─── SVG Countdown Timer ──────────────────────────────────────────────────────
function CountdownCircle({ remaining, total }) {
  const progress = remaining / total;
  const dashOffset = CIRCLE_CIRCUMFERENCE * (1 - progress);
  const color = remaining > 20 ? "#F5A623" : remaining > 10 ? "#fbb24c" : "#f87171";

  return (
    <svg width={70} height={70} viewBox="0 0 70 70">
      {/* Fond */}
      <circle
        cx={35}
        cy={35}
        r={CIRCLE_RADIUS}
        fill="none"
        stroke="rgba(255,255,255,0.07)"
        strokeWidth={4}
      />
      {/* Progression */}
      <circle
        cx={35}
        cy={35}
        r={CIRCLE_RADIUS}
        fill="none"
        stroke={color}
        strokeWidth={4}
        strokeDasharray={CIRCLE_CIRCUMFERENCE}
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
        transform="rotate(-90 35 35)"
        style={{ transition: "stroke-dashoffset 0.8s linear, stroke 0.3s ease" }}
      />
      {/* Texte */}
      <text
        x={35}
        y={35}
        textAnchor="middle"
        dominantBaseline="central"
        fill={color}
        fontSize={14}
        fontWeight={700}
        fontFamily="JetBrains Mono, monospace"
      >
        {remaining}
      </text>
    </svg>
  );
}

// ─── Composant principal HITLModal ────────────────────────────────────────────
/**
 * @param {{
 *   action: string,
 *   onApprove: Function,
 *   onReject: Function
 * }} props
 */
export default function HITLModal({ action = "Action critique détectée", onApprove, onReject }) {
  const [countdown, setCountdown] = useState(COUNTDOWN_DURATION);
  const [decided, setDecided] = useState(false);

  useEffect(() => {
    if (decided) return;

    const timer = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(timer);
          // Auto-rejet
          handleReject();
          return 0;
        }
        return c - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [decided]);

  const handleApprove = useCallback(() => {
    if (decided) return;
    setDecided(true);

    // Événement IPC Electron si disponible
    if (typeof window !== "undefined" && window.electronAPI?.sendHITLResponse) {
      window.electronAPI.sendHITLResponse({ approved: true, action });
    }
    onApprove?.();
  }, [decided, action, onApprove]);

  const handleReject = useCallback(() => {
    if (decided) return;
    setDecided(true);

    // Événement IPC Electron si disponible
    if (typeof window !== "undefined" && window.electronAPI?.sendHITLResponse) {
      window.electronAPI.sendHITLResponse({ approved: false, action });
    }
    onReject?.();
  }, [decided, action, onReject]);

  return (
    <div style={styles.overlay} role="dialog" aria-modal="true" aria-label="Validation requise">
      <div style={styles.modal}>
        {/* En-tête */}
        <div style={styles.header}>
          <div style={styles.warningIcon} aria-hidden="true">⚠️</div>
          <div style={styles.titleGroup}>
            <div style={styles.title}>Action dangereuse détectée</div>
            <div style={styles.subtitle}>Votre validation est requise pour continuer</div>
          </div>
        </div>

        {/* Description de l'action */}
        <div style={styles.actionBox} role="region" aria-label="Action à valider">
          {action}
        </div>

        {/* Countdown */}
        <div style={styles.countdownRow}>
          <div style={styles.countdownLabel}>
            Auto-rejet dans{" "}
            <span
              style={{
                ...styles.countdownNumber,
                color: countdown > 20 ? "#F5A623" : countdown > 10 ? "#fbb24c" : "#f87171",
                fontSize: "14px",
              }}
            >
              {countdown}s
            </span>
          </div>
          <CountdownCircle remaining={countdown} total={COUNTDOWN_DURATION} />
        </div>

        {/* Boutons */}
        <div style={styles.buttonsGroup}>
          <button
            style={styles.approveBtn}
            onClick={handleApprove}
            disabled={decided}
            aria-label="Approuver l'action"
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(74, 222, 128, 0.22)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(74, 222, 128, 0.12)";
            }}
          >
            ✓ APPROUVER
          </button>
          <button
            style={styles.rejectBtn}
            onClick={handleReject}
            disabled={decided}
            aria-label="Rejeter l'action"
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(248, 113, 113, 0.22)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(248, 113, 113, 0.12)";
            }}
          >
            ✗ REJETER
          </button>
        </div>
      </div>
    </div>
  );
}
