/**
 * MissionForm.jsx — Formulaire d'envoi de missions
 * Envoie directement à l'API LaRuche (STANDALONE_MODE ou via dashboard)
 */

import React, { useState, useRef, useCallback } from "react";

const QUEEN_API = import.meta.env.VITE_QUEEN_API || "http://localhost:3000";

const colors = {
  bg: "#0D0D1A",
  surface: "#1A1A2E",
  border: "rgba(124, 58, 237, 0.3)",
  borderActive: "rgba(245, 166, 35, 0.6)",
  gold: "#F5A623",
  purple: "#7C3AED",
  green: "#22C55E",
  red: "#EF4444",
  text: "#E0E0E0",
  muted: "#64748B",
};

const EXAMPLES = [
  "Liste les fichiers du projet et dis-moi lequel est le plus gros",
  "Analyse ce code et propose des optimisations de performance",
  "Crée un skill JavaScript pour scraper les prix d'un site e-commerce",
  "Explique l'architecture de LaRuche en 5 points clés",
  "Génère des tests unitaires pour la fonction butterflyLoop",
];

export default function MissionForm({ onMissionStart, onMissionComplete, disabled }) {
  const [command, setCommand] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastTraceId, setLastTraceId] = useState(null);
  const [error, setError] = useState(null);
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef(null);

  // Auto-resize du textarea
  const handleChange = useCallback((e) => {
    setCommand(e.target.value);
    setError(null);
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
    }
  }, []);

  const submit = useCallback(async () => {
    const cmd = command.trim();
    if (!cmd || loading) return;

    setLoading(true);
    setError(null);
    setLastTraceId(null);

    try {
      const res = await fetch(`${QUEEN_API}/api/mission`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: cmd }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      setLastTraceId(data.missionId);
      setCommand("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      onMissionStart?.(data.missionId, cmd);

      // Polling jusqu'à complétion
      const pollInterval = setInterval(async () => {
        try {
          const r = await fetch(`${QUEEN_API}/api/missions/${data.missionId}`);
          const mission = await r.json();
          if (mission.status === "success" || mission.status === "error") {
            clearInterval(pollInterval);
            setLoading(false);
            onMissionComplete?.(mission);
          }
        } catch {
          clearInterval(pollInterval);
          setLoading(false);
        }
      }, 1000);

      // Timeout de sécurité (2 minutes)
      setTimeout(() => {
        clearInterval(pollInterval);
        setLoading(false);
      }, 120000);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }, [command, loading, onMissionStart, onMissionComplete]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  };

  const useExample = (example) => {
    setCommand(example);
    setError(null);
    textareaRef.current?.focus();
    setTimeout(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
      }
    }, 0);
  };

  return (
    <div style={{
      background: colors.surface,
      border: `1px solid ${focused ? colors.borderActive : colors.border}`,
      borderRadius: 12,
      padding: 16,
      transition: "border-color 0.2s",
    }}>
      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 12,
      }}>
        <div style={{ color: colors.gold, fontSize: 12, fontWeight: "bold" }}>
          🚀 NOUVELLE MISSION
        </div>
        {lastTraceId && (
          <div style={{ fontSize: 10, color: colors.muted, fontFamily: "monospace" }}>
            ID: {lastTraceId}
          </div>
        )}
      </div>

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={command}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        disabled={disabled || loading}
        placeholder="Décrivez votre mission... (Ctrl+Entrée pour envoyer)"
        rows={3}
        style={{
          width: "100%",
          background: "rgba(255,255,255,0.04)",
          border: `1px solid ${focused ? "rgba(245,166,35,0.4)" : "rgba(255,255,255,0.08)"}`,
          borderRadius: 8,
          padding: "10px 12px",
          color: colors.text,
          fontSize: 13,
          lineHeight: 1.5,
          resize: "none",
          outline: "none",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif",
          boxSizing: "border-box",
          transition: "border-color 0.2s",
          opacity: disabled ? 0.5 : 1,
        }}
      />

      {/* Erreur */}
      {error && (
        <div style={{
          marginTop: 6,
          fontSize: 11,
          color: colors.red,
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}>
          ❌ {error}
        </div>
      )}

      {/* Bouton + hint */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
        <div style={{ fontSize: 10, color: colors.muted }}>
          {loading ? "⏳ Mission en cours..." : "Ctrl+Entrée pour envoyer"}
        </div>
        <button
          onClick={submit}
          disabled={!command.trim() || loading || disabled}
          style={{
            background: loading
              ? "rgba(124, 58, 237, 0.3)"
              : command.trim()
              ? colors.purple
              : "rgba(124, 58, 237, 0.2)",
            border: `1px solid ${colors.purple}`,
            borderRadius: 8,
            color: "white",
            padding: "8px 18px",
            cursor: command.trim() && !loading && !disabled ? "pointer" : "not-allowed",
            fontSize: 13,
            fontWeight: "bold",
            transition: "all 0.2s",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {loading ? (
            <>
              <span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>⟳</span>
              En cours...
            </>
          ) : (
            <>🚀 Envoyer</>
          )}
        </button>
      </div>

      {/* Exemples */}
      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 10, color: colors.muted, marginBottom: 6 }}>
          Exemples rapides :
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {EXAMPLES.map((ex, i) => (
            <button
              key={i}
              onClick={() => useExample(ex)}
              disabled={loading || disabled}
              title={ex}
              style={{
                background: "rgba(245,166,35,0.06)",
                border: "1px solid rgba(245,166,35,0.2)",
                borderRadius: 6,
                color: colors.muted,
                padding: "4px 8px",
                cursor: loading || disabled ? "not-allowed" : "pointer",
                fontSize: 10,
                maxWidth: 180,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => {
                if (!loading && !disabled) {
                  e.currentTarget.style.color = colors.gold;
                  e.currentTarget.style.borderColor = "rgba(245,166,35,0.5)";
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = colors.muted;
                e.currentTarget.style.borderColor = "rgba(245,166,35,0.2)";
              }}
            >
              {ex.length > 35 ? ex.substring(0, 35) + "…" : ex}
            </button>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
