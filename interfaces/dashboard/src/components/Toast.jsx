/**
 * Toast.jsx — Système de notifications toast global
 */
import React, { useState, useCallback, createContext, useContext } from "react";

const ToastContext = createContext(null);

export function useToast() {
  return useContext(ToastContext);
}

let _toastId = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = "info", duration = 4000) => {
    const id = ++_toastId;
    setToasts(prev => [...prev.slice(-4), { id, message, type }]);
    if (duration > 0) setTimeout(() => removeToast(id), duration);
    return id;
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const COLORS = {
    success: { bg: "rgba(74,222,128,0.12)", border: "#4ADE80", icon: "✓" },
    error:   { bg: "rgba(248,113,113,0.12)", border: "#F87171", icon: "✗" },
    warn:    { bg: "rgba(251,178,76,0.12)",  border: "#FBB24C", icon: "⚠" },
    info:    { bg: "rgba(96,165,250,0.12)",  border: "#60A5FA", icon: "ℹ" },
  };

  return (
    <ToastContext.Provider value={{ toast: addToast, success: m => addToast(m,"success"), error: m => addToast(m,"error"), warn: m => addToast(m,"warn") }}>
      {children}
      <div style={{ position: "fixed", bottom: 24, right: 24, display: "flex", flexDirection: "column", gap: 8, zIndex: 9999, pointerEvents: "none" }}>
        {toasts.map(t => {
          const c = COLORS[t.type] || COLORS.info;
          return (
            <div key={t.id} style={{
              background: c.bg, border: `1px solid ${c.border}`,
              borderRadius: 10, padding: "12px 16px",
              display: "flex", alignItems: "center", gap: 10,
              fontSize: 13, color: "var(--text)",
              backdropFilter: "blur(8px)",
              boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
              animation: "slideUp 0.2s ease both",
              pointerEvents: "all", maxWidth: 360,
            }}>
              <span style={{ color: c.border, fontWeight: 700, fontSize: 16 }}>{c.icon}</span>
              <span style={{ flex: 1 }}>{t.message}</span>
              <button onClick={() => removeToast(t.id)} style={{
                background: "none", border: "none", color: "var(--text-3)",
                cursor: "pointer", fontSize: 16, padding: 0, lineHeight: 1,
              }}>×</button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
