/**
 * Composer.jsx — Input de mission style Claude.ai
 * Textarea bottom-anchored, auto-resize, send button, model badge
 */

import React, { useState, useRef, useCallback, useEffect } from "react";

const QUEEN_API = import.meta.env.VITE_QUEEN_API || "http://localhost:3000";

const EXAMPLES = [
  "Liste les 5 fichiers les plus gros du projet",
  "Analyse l'architecture et propose des optimisations",
  "Génère des tests unitaires pour butterflyLoop",
  "Crée un skill pour scraper les prix e-commerce",
  "Résume la documentation du projet en 5 points",
];

// ─── Icônes ───────────────────────────────────────────────────────────────────
const SendIcon = ({ disabled }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
  </svg>
);

const StopIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <rect x="4" y="4" width="16" height="16" rx="2"/>
  </svg>
);

// ─── Composer ─────────────────────────────────────────────────────────────────
export default function Composer({ onMissionStart, onMissionComplete, status, prefillCommand, onPrefillConsumed }) {
  const [command, setCommand] = useState("");
  const [loading, setLoading]  = useState(false);
  const [error, setError]      = useState(null);
  const [focused, setFocused]  = useState(false);
  const [showExamples, setShowExamples] = useState(false);
  const textareaRef = useRef(null);
  const pollRef     = useRef(null);

  const models = status?.models || {};
  const workerModel = models.worker || "llama3.2:3b";

  // Prefill depuis suggestion EmptyState
  useEffect(() => {
    if (prefillCommand) {
      setCommand(prefillCommand);
      textareaRef.current?.focus();
      onPrefillConsumed?.();
      setTimeout(resize, 0);
    }
  }, [prefillCommand]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-resize
  const resize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 220)}px`;
  }, []);

  const handleChange = useCallback((e) => {
    setCommand(e.target.value);
    setError(null);
    resize();
  }, [resize]);

  const submit = useCallback(async () => {
    const cmd = command.trim();
    if (!cmd || loading) return;

    setLoading(true);
    setError(null);
    setCommand("");
    setShowExamples(false);
    setTimeout(() => { if (textareaRef.current) textareaRef.current.style.height = "auto"; }, 0);

    try {
      const res = await fetch(`${QUEEN_API}/api/mission`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: cmd }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      onMissionStart?.(data.missionId, cmd);

      // Polling jusqu'à complétion
      pollRef.current = setInterval(async () => {
        try {
          const r = await fetch(`${QUEEN_API}/api/missions/${data.missionId}`);
          const m = await r.json();
          if (m.status === "success" || m.status === "error") {
            clearInterval(pollRef.current);
            setLoading(false);
            onMissionComplete?.(m);
          }
        } catch {}
      }, 800);

      // Timeout 3 minutes
      setTimeout(() => { clearInterval(pollRef.current); setLoading(false); }, 180000);
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
    if (e.key === "Escape") setShowExamples(false);
  };

  const useExample = (ex) => {
    setCommand(ex);
    setShowExamples(false);
    setError(null);
    textareaRef.current?.focus();
    setTimeout(resize, 0);
  };

  const canSend = command.trim().length > 0 && !loading;

  return (
    <div style={{
      flexShrink: 0,
      borderTop: "1px solid var(--border)",
      background: "var(--surface)",
      padding: "12px 20px 16px",
    }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        {/* Exemples rapides */}
        {showExamples && !loading && (
          <div style={{
            marginBottom: 10,
            display: "flex",
            gap: 7,
            flexWrap: "wrap",
            animation: "slideUp 0.15s ease",
          }}>
            {EXAMPLES.map((ex, i) => (
              <button
                key={i}
                onClick={() => useExample(ex)}
                style={{
                  background: "var(--surface-2)",
                  border: "1px solid var(--border-2)",
                  borderRadius: 20,
                  color: "var(--text-2)",
                  padding: "4px 11px",
                  fontSize: 11.5,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  transition: "all 0.15s",
                  maxWidth: 220,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = "var(--surface-3)";
                  e.currentTarget.style.color = "var(--text)";
                  e.currentTarget.style.borderColor = "var(--primary)";
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = "var(--surface-2)";
                  e.currentTarget.style.color = "var(--text-2)";
                  e.currentTarget.style.borderColor = "var(--border-2)";
                }}
              >
                {ex}
              </button>
            ))}
          </div>
        )}

        {/* Erreur */}
        {error && (
          <div style={{
            marginBottom: 8,
            fontSize: 12,
            color: "var(--red)",
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 10px",
            background: "rgba(248,113,113,0.06)",
            borderRadius: "var(--radius-sm)",
            border: "1px solid rgba(248,113,113,0.15)",
          }}>
            ⚠ {error}
          </div>
        )}

        {/* Zone de saisie principale */}
        <div style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 10,
          background: "var(--surface-2)",
          border: `1px solid ${focused ? "var(--border-3)" : "var(--border-2)"}`,
          borderRadius: "var(--radius-lg)",
          padding: "10px 12px 10px 14px",
          boxShadow: focused
            ? "0 0 0 3px var(--primary-dim), var(--shadow)"
            : "var(--shadow-sm)",
          transition: "all 0.2s",
        }}>
          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={command}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => { setFocused(true); setShowExamples(true); }}
            onBlur={() => { setFocused(false); setTimeout(() => setShowExamples(false), 150); }}
            disabled={loading}
            placeholder="Décrivez votre mission..."
            rows={1}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              resize: "none",
              color: loading ? "var(--text-2)" : "var(--text)",
              fontSize: 14,
              lineHeight: 1.55,
              fontFamily: "inherit",
              padding: 0,
              maxHeight: 220,
              overflowY: "auto",
              cursor: loading ? "not-allowed" : "text",
            }}
          />

          {/* Bouton Send / Stop */}
          <button
            onClick={submit}
            disabled={!canSend}
            style={{
              width: 36, height: 36,
              borderRadius: "var(--radius)",
              border: "none",
              background: loading
                ? "var(--primary-dim)"
                : canSend
                ? "var(--primary)"
                : "var(--surface-3)",
              color: canSend || loading ? "white" : "var(--text-3)",
              cursor: canSend ? "pointer" : "not-allowed",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              transition: "all 0.15s",
              transform: "translateY(0)",
            }}
            onMouseDown={e => { if (canSend) e.currentTarget.style.transform = "scale(0.94)"; }}
            onMouseUp={e => { e.currentTarget.style.transform = "scale(1)"; }}
            onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; }}
          >
            {loading ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"
                style={{ animation: "spin 1s linear infinite" }}>
                <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
              </svg>
            ) : (
              <SendIcon disabled={!canSend} />
            )}
          </button>
        </div>

        {/* Barre inférieure : modèle + hint */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: 8,
          padding: "0 2px",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{
              fontSize: 11,
              color: "var(--text-3)",
              background: "var(--surface-3)",
              padding: "2px 8px",
              borderRadius: 20,
              border: "1px solid var(--border)",
            }}>
              {workerModel}
            </span>
            {loading && (
              <span style={{ fontSize: 11, color: "var(--primary)", animation: "pulse 1.5s infinite" }}>
                Essaim en action...
              </span>
            )}
          </div>
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>
            ⌘↵ pour envoyer
          </span>
        </div>
      </div>
    </div>
  );
}
