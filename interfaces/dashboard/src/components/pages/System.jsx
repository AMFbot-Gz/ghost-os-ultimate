/**
 * System.jsx — Monitoring système LaRuche
 * CPU gauge SVG, RAM bar, Disk, Ollama, Uptime, Restart, auto-refresh 5s
 */

import React, { useState, useEffect, useCallback } from "react";

const QUEEN_API = import.meta.env.VITE_QUEEN_API || "http://localhost:3000";

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function Skeleton({ w = "100%", h = 16, radius = 6 }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: radius,
      background: "linear-gradient(90deg, var(--surface-2) 25%, var(--surface-3) 50%, var(--surface-2) 75%)",
      backgroundSize: "400px 100%",
      animation: "shimmer 1.5s infinite",
    }} />
  );
}

// ─── CPU Gauge (SVG circulaire) ───────────────────────────────────────────────
function CpuGauge({ value = 0, size = 120 }) {
  const r      = 44;
  const circ   = 2 * Math.PI * r;
  const pct    = Math.min(100, Math.max(0, value));
  const dash   = (pct / 100) * circ;
  const color  = pct > 85 ? "var(--red)" : pct > 60 ? "var(--yellow)" : "var(--green)";

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <svg width={size} height={size} viewBox="0 0 100 100" style={{ transform: "rotate(-90deg)" }}>
        {/* Track */}
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--surface-3)" strokeWidth="8" />
        {/* Progress */}
        <circle
          cx="50" cy="50" r={r}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeDashoffset={0}
          style={{ transition: "stroke-dasharray 0.6s ease, stroke 0.3s ease" }}
        />
      </svg>
      {/* Valeur centrée */}
      <div style={{ marginTop: -size / 2 - 18, zIndex: 1, textAlign: "center" }}>
        <div style={{ fontSize: 20, fontWeight: 700, color, letterSpacing: "-0.02em" }}>
          {pct.toFixed(0)}%
        </div>
        <div style={{ fontSize: 11, color: "var(--text-3)" }}>CPU</div>
      </div>
      <div style={{ height: size / 2 - 20 }} />
    </div>
  );
}

// ─── Bar de ressource (RAM, Disk) ─────────────────────────────────────────────
function ResourceBar({ label, used, total, unit = "Go" }) {
  const pct   = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const color = pct > 85 ? "var(--red)" : pct > 65 ? "var(--yellow)" : "var(--green)";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>{label}</span>
        <span style={{ fontSize: 12, color: "var(--text-3)" }}>
          {used?.toFixed ? used.toFixed(1) : used} / {total?.toFixed ? total.toFixed(1) : total} {unit}
        </span>
      </div>
      <div style={{
        height: 8, borderRadius: 4,
        background: "var(--surface-3)",
        overflow: "hidden",
      }}>
        <div style={{
          height: "100%",
          width: `${pct}%`,
          background: color,
          borderRadius: 4,
          transition: "width 0.6s ease, background 0.3s ease",
          boxShadow: `0 0 8px ${color}60`,
        }} />
      </div>
      <div style={{ fontSize: 11, color: "var(--text-3)", textAlign: "right" }}>
        {pct.toFixed(0)}% utilisé
      </div>
    </div>
  );
}

// ─── Stat simple ──────────────────────────────────────────────────────────────
function StatRow({ label, value, color, mono = false }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "8px 0", borderBottom: "1px solid var(--border)",
    }}>
      <span style={{ fontSize: 13, color: "var(--text-3)" }}>{label}</span>
      <span style={{
        fontSize: 13, fontWeight: 500,
        color: color || "var(--text)",
        fontFamily: mono ? "JetBrains Mono, monospace" : "inherit",
      }}>
        {value}
      </span>
    </div>
  );
}

// ─── Modal confirmation restart ───────────────────────────────────────────────
function RestartModal({ onClose, onConfirm }) {
  const [loading, setLoading] = useState(false);

  const confirm = async () => {
    setLoading(true);
    await onConfirm();
    setLoading(false);
    onClose();
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(0,0,0,0.6)", display: "flex",
      alignItems: "center", justifyContent: "center",
      backdropFilter: "blur(4px)",
    }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: "var(--surface)", border: "1px solid var(--border-2)",
        borderRadius: "var(--radius-xl)", padding: "24px 28px",
        width: "100%", maxWidth: 400,
        boxShadow: "var(--shadow-lg)", animation: "slideUp 0.2s ease",
      }}>
        <div style={{ fontSize: 24, marginBottom: 12 }}>⚠️</div>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 10 }}>
          Redémarrer LaRuche ?
        </h2>
        <p style={{ fontSize: 13, color: "var(--text-3)", lineHeight: 1.6, marginBottom: 24 }}>
          Toutes les missions en cours seront interrompues.
          Le système redémarrera dans quelques secondes.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{
            padding: "8px 18px", borderRadius: "var(--radius)",
            border: "1px solid var(--border-2)", background: "none",
            color: "var(--text-2)", cursor: "pointer", fontSize: 13, fontWeight: 500,
          }}>
            Annuler
          </button>
          <button onClick={confirm} disabled={loading} style={{
            padding: "8px 18px", borderRadius: "var(--radius)", border: "none",
            background: "var(--red)", color: "white",
            cursor: loading ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 500,
            opacity: loading ? 0.7 : 1,
          }}>
            {loading ? "Redémarrage..." : "Redémarrer"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── System ───────────────────────────────────────────────────────────────────
export default function System() {
  const [sysData,      setSysData]      = useState(null);
  const [status,       setStatus]       = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(null);
  const [showRestart,  setShowRestart]  = useState(false);
  const [restartMsg,   setRestartMsg]   = useState(null);
  const [lastUpdate,   setLastUpdate]   = useState(null);

  const fetchData = useCallback(async () => {
    try {
      const [sysRes, statusRes] = await Promise.all([
        fetch(`${QUEEN_API}/api/system`).catch(() => null),
        fetch(`${QUEEN_API}/api/status`).catch(() => null),
      ]);
      if (sysRes?.ok)    setSysData(await sysRes.json());
      if (statusRes?.ok) setStatus(await statusRes.json());
      setLastUpdate(new Date());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleRestart = async () => {
    try {
      await fetch(`${QUEEN_API}/api/process/restart`, { method: "POST" });
      setRestartMsg("Redémarrage en cours...");
      setTimeout(() => { setRestartMsg(null); fetchData(); }, 5000);
    } catch (err) {
      setError("Erreur lors du redémarrage : " + err.message);
    }
  };

  // Extraction données CPU / RAM / Disk
  const cpu    = sysData?.cpu?.percent    || sysData?.cpu    || 0;
  const ramUsed  = sysData?.ram?.used    || sysData?.memory?.used  || 0;
  const ramTotal = sysData?.ram?.total   || sysData?.memory?.total || 0;
  // L'API retourne disk comme un tableau [{fs, size, used, percent}] — on prend le premier disque principal
  const diskArr   = Array.isArray(sysData?.disk) ? sysData.disk : [];
  const mainDisk  = diskArr[0] || sysData?.disk || {};
  const diskUsed  = mainDisk.used  || 0;
  const diskTotal = mainDisk.size  || mainDisk.total || 0;

  // Statuts
  const uptimeSec     = status?.uptime || 0;
  const uptimeDisplay = uptimeSec >= 3600
    ? `${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m`
    : `${Math.floor(uptimeSec / 60)}m ${uptimeSec % 60}s`;

  const ollamaOk      = status?.ollama?.ok;
  const ollamaLatency = status?.ollama?.latencyMs;
  const modelsCount   = status?.models ? Object.keys(status.models).length : 0;

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px", display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.02em", marginBottom: 4 }}>
            Système
          </h1>
          <p style={{ fontSize: 13, color: "var(--text-3)" }}>
            Auto-refresh toutes les 5s
            {lastUpdate && ` · Dernière mise à jour : ${lastUpdate.toLocaleTimeString("fr-FR")}`}
          </p>
        </div>
        <button onClick={() => setShowRestart(true)} style={{
          padding: "8px 18px", borderRadius: "var(--radius)",
          border: "1px solid rgba(248,113,113,0.3)",
          background: "rgba(248,113,113,0.07)",
          color: "var(--red)", fontSize: 13, fontWeight: 500,
          cursor: "pointer", display: "flex", alignItems: "center", gap: 7,
          transition: "all 0.15s",
        }}
          onMouseEnter={e => { e.currentTarget.style.background = "rgba(248,113,113,0.14)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "rgba(248,113,113,0.07)"; }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
          Redémarrer LaRuche
        </button>
      </div>

      {/* Messages */}
      {error && (
        <div style={{
          padding: "10px 16px", background: "rgba(248,113,113,0.07)",
          border: "1px solid rgba(248,113,113,0.2)", borderRadius: "var(--radius)",
          fontSize: 13, color: "var(--red)",
        }}>
          ⚠ {error}
        </div>
      )}
      {restartMsg && (
        <div style={{
          padding: "10px 16px", background: "rgba(251,178,76,0.08)",
          border: "1px solid rgba(251,178,76,0.25)", borderRadius: "var(--radius)",
          fontSize: 13, color: "var(--yellow)",
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
            style={{ animation: "spin 1s linear infinite", flexShrink: 0 }}>
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          {restartMsg}
        </div>
      )}

      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <Skeleton h={200} radius={14} />
            <Skeleton h={200} radius={14} />
          </div>
          <Skeleton h={120} radius={14} />
          <Skeleton h={120} radius={14} />
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Ligne 1 : CPU + RAM/Disk */}
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 16, alignItems: "start" }}>
            {/* CPU Gauge */}
            <div style={{
              background: "var(--surface-2)", border: "1px solid var(--border-2)",
              borderRadius: "var(--radius-lg)", padding: "24px",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
              minWidth: 160,
            }}>
              <div style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
                Processeur
              </div>
              <CpuGauge value={cpu} size={110} />
            </div>

            {/* RAM + Disk */}
            <div style={{
              background: "var(--surface-2)", border: "1px solid var(--border-2)",
              borderRadius: "var(--radius-lg)", padding: "24px",
              display: "flex", flexDirection: "column", gap: 24,
            }}>
              <ResourceBar
                label="Mémoire RAM"
                used={ramUsed}
                total={ramTotal}
                unit="Go"
              />
              <ResourceBar
                label="Stockage"
                used={diskUsed}
                total={diskTotal}
                unit="Go"
              />
            </div>
          </div>

          {/* Ollama */}
          <div style={{
            background: "var(--surface-2)", border: "1px solid var(--border-2)",
            borderRadius: "var(--radius-lg)", padding: "20px 24px",
          }}>
            <div style={{
              fontSize: 12, color: "var(--text-3)", fontWeight: 600,
              textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 16,
            }}>
              Ollama
            </div>
            <StatRow
              label="Statut"
              value={ollamaOk ? "En ligne" : ollamaOk === false ? "Hors ligne" : "Inconnu"}
              color={ollamaOk ? "var(--green)" : ollamaOk === false ? "var(--red)" : "var(--text-3)"}
            />
            <StatRow label="Latence"           value={ollamaOk ? `${ollamaLatency}ms` : "—"} />
            <StatRow label="Modèles configurés" value={modelsCount}                             />
            {status?.ollama?.model && (
              <StatRow label="Modèle actif" value={status.ollama.model} mono />
            )}
          </div>

          {/* Process LaRuche */}
          <div style={{
            background: "var(--surface-2)", border: "1px solid var(--border-2)",
            borderRadius: "var(--radius-lg)", padding: "20px 24px",
          }}>
            <div style={{
              fontSize: 12, color: "var(--text-3)", fontWeight: 600,
              textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 16,
            }}>
              Processus LaRuche
            </div>
            <StatRow
              label="Statut API"
              value={status?.status === "online" ? "En ligne" : "Hors ligne"}
              color={status?.status === "online" ? "var(--green)" : "var(--red)"}
            />
            <StatRow label="Uptime"  value={uptimeDisplay}             />
            <StatRow label="Version" value={status?.version || "—"} mono />
            {status?.missions && (
              <>
                <StatRow label="Missions totales"  value={status.missions.total   || 0} />
                <StatRow label="Missions réussies" value={status.missions.success || 0} color="var(--green)" />
                <StatRow label="Missions en erreur" value={status.missions.error   || 0} color="var(--red)"   />
              </>
            )}
          </div>
        </div>
      )}

      {showRestart && (
        <RestartModal
          onClose={() => setShowRestart(false)}
          onConfirm={handleRestart}
        />
      )}
    </div>
  );
}
