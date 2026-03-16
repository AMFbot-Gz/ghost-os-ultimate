/**
 * ComputerUsePage.jsx — Phase 18 : Computer Use Master Session
 * See → Plan → Act → Verify · Sessions live · Screenshot viewer · Trace GUI
 */
import { useEffect, useState, useRef } from "react";

const CU_API = "http://localhost:8015";

const ACTION_COLORS = {
  screenshot:    { bg: "rgba(137,220,235,0.15)", text: "#89dceb",  icon: "📸" },
  click:         { bg: "rgba(166,227,161,0.15)", text: "#a6e3a1",  icon: "🖱️" },
  click_element: { bg: "rgba(166,227,161,0.15)", text: "#a6e3a1",  icon: "🎯" },
  type:          { bg: "rgba(203,166,247,0.15)", text: "#cba6f7",  icon: "⌨️" },
  key:           { bg: "rgba(180,190,254,0.15)", text: "#b4befe",  icon: "⌨️" },
  scroll:        { bg: "rgba(249,226,175,0.15)", text: "#f9e2af",  icon: "↕️" },
  open_app:      { bg: "rgba(224,123,84,0.15)",  text: "#e07b54",  icon: "🔗" },
  shell:         { bg: "rgba(249,226,175,0.15)", text: "#f9e2af",  icon: "💻" },
  wait:          { bg: "rgba(150,150,150,0.12)", text: "#9399b2",  icon: "⏳" },
  done:          { bg: "rgba(166,227,161,0.2)",  text: "#a6e3a1",  icon: "✅" },
};

const STATUS_COLORS = {
  pending:  { text: "#f9e2af", icon: "⏳" },
  running:  { text: "#89dceb", icon: "▶️" },
  success:  { text: "#a6e3a1", icon: "✅" },
  failed:   { text: "#f38ba8", icon: "❌" },
  stopped:  { text: "#9399b2", icon: "⏹️" },
};

function ActionBadge({ type }) {
  const c = ACTION_COLORS[type] || { bg: "rgba(150,150,150,0.12)", text: "#cdd6f4", icon: "•" };
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10,
      background: c.bg, color: c.text, letterSpacing: "0.04em", textTransform: "uppercase",
      display: "inline-flex", alignItems: "center", gap: 4,
    }}>
      <span>{c.icon}</span> {type}
    </span>
  );
}

function StatusBadge({ status }) {
  const c = STATUS_COLORS[status] || { text: "#cdd6f4", icon: "•" };
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color: c.text }}>
      {c.icon} {status}
    </span>
  );
}

function StepRow({ step }) {
  const [expanded, setExpanded] = useState(false);
  const ok = step.success === 1;
  return (
    <div style={{
      borderLeft: `2px solid ${ok ? "rgba(166,227,161,0.4)" : "rgba(243,139,168,0.4)"}`,
      paddingLeft: 12, paddingBottom: 4, marginBottom: 2,
    }}>
      <div
        style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer", padding: "6px 0" }}
        onClick={() => setExpanded(e => !e)}
      >
        <span style={{ fontSize: 11, color: "var(--text-3)", minWidth: 18, marginTop: 1 }}>
          #{step.step_num}
        </span>
        <ActionBadge type={step.action_type} />
        <span style={{ flex: 1, fontSize: 12, color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {step.action_input || "—"}
        </span>
        {step.screen_changed === 1 && (
          <span title="Écran modifié" style={{ fontSize: 10, color: "#a6e3a1" }}>Δ</span>
        )}
        <span style={{ fontSize: 10, color: "var(--text-3)", flexShrink: 0 }}>
          {step.duration_ms ? `${step.duration_ms < 1000 ? step.duration_ms + "ms" : (step.duration_ms / 1000).toFixed(1) + "s"}` : ""}
        </span>
        <span style={{ fontSize: 10, color: "var(--text-3)" }}>{expanded ? "▲" : "▼"}</span>
      </div>
      {expanded && (
        <div style={{ padding: "4px 0 8px" }}>
          {step.thought && (
            <div style={{ fontSize: 11, color: "var(--text-3)", fontStyle: "italic", marginBottom: 6 }}>
              💭 {step.thought}
            </div>
          )}
          <div style={{
            fontSize: 11, color: ok ? "var(--text-2)" : "#f38ba8",
            background: "var(--surface)", padding: "8px 10px", borderRadius: 6,
          }}>
            {step.observation || "—"}
          </div>
        </div>
      )}
    </div>
  );
}

function SessionCard({ session, onSelect, selected }) {
  const c = STATUS_COLORS[session.status] || { text: "#cdd6f4", icon: "•" };
  return (
    <div
      onClick={() => onSelect(session.id)}
      style={{
        padding: "12px 14px", borderRadius: 10, cursor: "pointer",
        background: selected ? "var(--surface-3)" : "var(--surface-2)",
        border: selected ? `1px solid var(--primary)` : "1px solid var(--border)",
        marginBottom: 6,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 13 }}>{c.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {session.goal}
          </div>
          <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2, display: "flex", gap: 8 }}>
            <span style={{ color: c.text }}>{session.status}</span>
            <span>{session.steps_count} étapes</span>
            {session.duration_ms && <span>{(session.duration_ms / 1000).toFixed(1)}s</span>}
          </div>
        </div>
      </div>
      {session.final_result && (
        <div style={{ fontSize: 11, color: "#a6e3a1", marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          → {session.final_result}
        </div>
      )}
      {session.error && (
        <div style={{ fontSize: 11, color: "#f38ba8", marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          ✗ {session.error}
        </div>
      )}
    </div>
  );
}

export default function ComputerUsePage() {
  const [tab, setTab]               = useState("start");
  const [stats, setStats]           = useState(null);
  const [health, setHealth]         = useState(null);
  const [sessions, setSessions]     = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [liveSession, setLiveSession] = useState(null);
  const [goal, setGoal]             = useState("");
  const [maxSteps, setMaxSteps]     = useState(20);
  const [starting, setStarting]     = useState(false);
  const [startError, setStartError] = useState("");
  const [screenshot, setScreenshot] = useState(null);
  const [scLoading, setScLoading]   = useState(false);
  const pollRef                     = useRef(null);
  const [lastUpdate, setLastUpdate] = useState(null);

  // ── Fetch liste + stats ──────────────────────────────────────────────────
  const fetchAll = async () => {
    try {
      const [sessR, statsR, healthR] = await Promise.all([
        fetch(`${CU_API}/sessions?limit=20`).then(r => r.ok ? r.json() : null),
        fetch(`${CU_API}/stats`).then(r => r.ok ? r.json() : null),
        fetch(`${CU_API}/health`).then(r => r.ok ? r.json() : null),
      ]);
      if (sessR?.sessions) setSessions(sessR.sessions);
      if (statsR)           setStats(statsR);
      if (healthR)          setHealth(healthR);
      setLastUpdate(new Date().toLocaleTimeString("fr-FR"));
    } catch {}
  };

  useEffect(() => {
    fetchAll();
    const iv = setInterval(fetchAll, 8000);
    return () => clearInterval(iv);
  }, []);

  // ── Polling session live ──────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedId) return;
    const poll = async () => {
      try {
        const r = await fetch(`${CU_API}/session/${selectedId}`);
        if (r.ok) {
          const s = await r.json();
          setLiveSession(s);
          if (s.status === "running" || s.status === "pending") {
            pollRef.current = setTimeout(poll, 1500);
          } else {
            fetchAll();
          }
        }
      } catch {}
    };
    poll();
    return () => clearTimeout(pollRef.current);
  }, [selectedId]);

  const handleStart = async () => {
    if (!goal.trim()) return;
    setStarting(true);
    setStartError("");
    try {
      const r = await fetch(`${CU_API}/session/start`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: goal.trim(), max_steps: maxSteps }),
      });
      if (r.ok) {
        const s = await r.json();
        setSelectedId(s.session_id);
        setTab("live");
        fetchAll();
      } else {
        const err = await r.json();
        setStartError(err.detail || "Erreur démarrage");
      }
    } catch (e) {
      setStartError(e.message);
    }
    setStarting(false);
  };

  const handleStop = async () => {
    if (!selectedId) return;
    await fetch(`${CU_API}/session/${selectedId}/stop`, { method: "POST" });
    setTimeout(fetchAll, 500);
  };

  const handleScreenshot = async () => {
    setScLoading(true);
    try {
      const r = await fetch(`${CU_API}/screenshot`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "dashboard preview" }),
      });
      if (r.ok) setScreenshot(await r.json());
    } catch {}
    setScLoading(false);
  };

  const TABS = [
    { id: "start", label: "🚀 Nouvelle session" },
    { id: "live",  label: `👁️ Live${liveSession?.status === "running" ? " ●" : ""}` },
    { id: "history", label: "📋 Historique" },
    { id: "screen",  label: "📸 Screenshot" },
  ];

  const isRunning = liveSession?.status === "running" || liveSession?.status === "pending";

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--text)" }}>
            🖥️ Computer Use Master — Phase 18
          </h2>
          <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 3 }}>
            See → Plan → Act → Verify · moondream vision · PyAutoGUI · session ReAct GUI
            {lastUpdate && <> · MAJ {lastUpdate}</>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {health && (
            <div style={{ display: "flex", gap: 6, fontSize: 11 }}>
              {[
                { label: "Perception", ok: health.perception_ok },
                { label: "Executor",   ok: health.executor_ok },
                { label: "Brain",      ok: health.brain_ok },
              ].map(s => (
                <span key={s.label} style={{ color: s.ok ? "#a6e3a1" : "#f38ba8" }}>
                  {s.ok ? "●" : "○"} {s.label}
                </span>
              ))}
            </div>
          )}
          <button onClick={fetchAll} style={{
            background: "var(--surface-2)", border: "1px solid var(--border)",
            borderRadius: 8, padding: "6px 14px", color: "var(--text-2)",
            fontSize: 12, cursor: "pointer",
          }}>↺ Actualiser</button>
        </div>
      </div>

      {/* KPIs */}
      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10 }}>
          {[
            { label: "Sessions",     value: stats.total,       color: "var(--primary)" },
            { label: "Réussies",     value: stats.succeeded,   color: "#a6e3a1" },
            { label: "Échouées",     value: stats.failed,      color: "#f38ba8" },
            { label: "Étapes moy",   value: stats.avg_steps,   color: "#89dceb" },
            { label: "En cours",     value: stats.active,      color: "#f9e2af" },
          ].map(k => (
            <div key={k.label} style={{ background: "var(--surface-2)", borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: k.color }}>{k.value ?? "—"}</div>
              <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 3 }}>{k.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Safety notice */}
      <div style={{
        background: "rgba(249,226,175,0.08)", border: "1px solid rgba(249,226,175,0.25)",
        borderRadius: 10, padding: "10px 14px", fontSize: 11, color: "#f9e2af",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span style={{ fontSize: 16 }}>⚠️</span>
        <span>
          <strong>FAILSAFE actif</strong> — déplacer la souris dans le coin supérieur gauche de l'écran arrête immédiatement toute action PyAutoGUI.
          Max {MAX_STEPS_DEFAULT || 20} étapes par session. Les commandes shell dangereuses sont bloquées par Executor.
        </span>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 6, borderBottom: "1px solid var(--border)" }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: "8px 16px", border: "none", borderRadius: "8px 8px 0 0",
            background: tab === t.id ? "var(--surface-2)" : "transparent",
            color: tab === t.id ? "var(--primary)" : "var(--text-2)",
            fontWeight: tab === t.id ? 600 : 400, fontSize: 13, cursor: "pointer",
            borderBottom: tab === t.id ? "2px solid var(--primary)" : "2px solid transparent",
          }}>{t.label}</button>
        ))}
      </div>

      {/* ── Tab Nouvelle session ── */}
      {tab === "start" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 640 }}>
          <div style={{ background: "var(--surface-2)", borderRadius: 12, padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
              Démarrer une session Computer Use
            </div>

            <div>
              <label style={{ fontSize: 12, color: "var(--text-3)", display: "block", marginBottom: 6 }}>
                Objectif de la session <span style={{ color: "var(--red)" }}>*</span>
              </label>
              <textarea
                value={goal}
                onChange={e => setGoal(e.target.value)}
                placeholder={`Exemples :\n• Ouvre Safari, va sur google.com, cherche "météo Paris" et dis-moi le résultat\n• Ouvre le Terminal, crée un fichier test.txt sur le Bureau et écris "Hello Ghost OS"\n• Prends un screenshot et décris ce que tu vois`}
                rows={4}
                style={{
                  width: "100%", padding: "10px 12px", borderRadius: 8,
                  background: "var(--surface)", border: "1px solid var(--border)",
                  color: "var(--text)", fontSize: 13, resize: "vertical",
                  fontFamily: "inherit", boxSizing: "border-box",
                }}
              />
            </div>

            <div>
              <label style={{ fontSize: 12, color: "var(--text-3)", display: "block", marginBottom: 6 }}>
                Étapes maximum : <strong style={{ color: "var(--text)" }}>{maxSteps}</strong>
              </label>
              <input
                type="range" min={3} max={40} value={maxSteps}
                onChange={e => setMaxSteps(Number(e.target.value))}
                style={{ width: "100%", accentColor: "var(--primary)" }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-3)" }}>
                <span>3 (rapide)</span><span>20 (standard)</span><span>40 (complexe)</span>
              </div>
            </div>

            {startError && (
              <div style={{ color: "#f38ba8", fontSize: 12 }}>{startError}</div>
            )}

            <button
              onClick={handleStart}
              disabled={starting || !goal.trim()}
              style={{
                padding: "10px 24px", borderRadius: 8, border: "none",
                background: "var(--primary)", color: "white",
                fontSize: 14, fontWeight: 700, cursor: "pointer",
                opacity: starting || !goal.trim() ? 0.6 : 1,
              }}
            >{starting ? "Démarrage…" : "🖥️ Lancer la session"}</button>
          </div>

          {/* Actions disponibles */}
          <div style={{ background: "var(--surface-2)", borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>Actions disponibles</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6 }}>
              {Object.entries(ACTION_COLORS).map(([action, c]) => (
                <div key={action} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 14 }}>{c.icon}</span>
                  <span style={{
                    fontSize: 11, padding: "1px 7px", borderRadius: 8,
                    background: c.bg, color: c.text, fontWeight: 600, fontFamily: "monospace",
                  }}>{action}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Tab Live ── */}
      {tab === "live" && (
        <div style={{ display: "flex", gap: 16, minHeight: 400 }}>
          {/* Liste sessions à gauche */}
          <div style={{ width: 280, flexShrink: 0 }}>
            <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 8 }}>Sessions récentes</div>
            {sessions.length === 0 ? (
              <div style={{ color: "var(--text-3)", fontSize: 12, padding: 16, textAlign: "center" }}>
                Aucune session
              </div>
            ) : sessions.map(s => (
              <SessionCard
                key={s.id}
                session={s}
                selected={s.id === selectedId}
                onSelect={id => { setSelectedId(id); setLiveSession(null); }}
              />
            ))}
          </div>

          {/* Détail à droite */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
            {!liveSession && !selectedId ? (
              <div style={{
                flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
                color: "var(--text-3)", fontSize: 13,
              }}>
                Sélectionne une session ou lance-en une nouvelle
              </div>
            ) : liveSession ? (
              <>
                {/* Header session */}
                <div style={{
                  background: "var(--surface-2)", borderRadius: 10, padding: "14px 16px",
                  display: "flex", alignItems: "flex-start", justifyContent: "space-between",
                }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>
                      {liveSession.goal}
                    </div>
                    <div style={{ display: "flex", gap: 12, fontSize: 11, color: "var(--text-3)" }}>
                      <StatusBadge status={liveSession.status} />
                      <span>{liveSession.steps_count} / {liveSession.max_steps} étapes</span>
                      {liveSession.duration_ms && <span>{(liveSession.duration_ms / 1000).toFixed(1)}s</span>}
                      <span style={{ fontFamily: "monospace", color: "var(--text-3)" }}>{liveSession.id}</span>
                    </div>
                  </div>
                  {isRunning && (
                    <button
                      onClick={handleStop}
                      style={{
                        padding: "6px 14px", borderRadius: 8,
                        background: "rgba(243,139,168,0.15)", border: "1px solid rgba(243,139,168,0.4)",
                        color: "#f38ba8", fontSize: 12, cursor: "pointer", fontWeight: 600,
                      }}
                    >⏹ Stop</button>
                  )}
                </div>

                {/* Résultat final */}
                {liveSession.final_result && (
                  <div style={{
                    background: "rgba(166,227,161,0.08)", border: "1px solid rgba(166,227,161,0.3)",
                    borderRadius: 10, padding: "12px 14px", color: "#a6e3a1", fontSize: 13,
                  }}>
                    <strong>Résultat :</strong> {liveSession.final_result}
                  </div>
                )}
                {liveSession.error && (
                  <div style={{
                    background: "rgba(243,139,168,0.08)", border: "1px solid rgba(243,139,168,0.3)",
                    borderRadius: 10, padding: "12px 14px", color: "#f38ba8", fontSize: 13,
                  }}>
                    <strong>Erreur :</strong> {liveSession.error}
                  </div>
                )}

                {/* Barre de progression */}
                {liveSession.max_steps > 0 && (
                  <div>
                    <div style={{ height: 4, borderRadius: 2, background: "var(--surface-2)", overflow: "hidden" }}>
                      <div style={{
                        height: "100%", borderRadius: 2,
                        width: `${Math.round((liveSession.steps_count / liveSession.max_steps) * 100)}%`,
                        background: liveSession.status === "success" ? "#a6e3a1"
                          : liveSession.status === "failed" ? "#f38ba8"
                          : "var(--primary)",
                        transition: "width 0.4s ease",
                      }} />
                    </div>
                  </div>
                )}

                {/* Trace des étapes */}
                <div style={{
                  flex: 1, background: "var(--surface-2)", borderRadius: 10, padding: "14px 16px",
                  overflowY: "auto", maxHeight: 480,
                }}>
                  {isRunning && (
                    <div style={{
                      display: "flex", alignItems: "center", gap: 8,
                      fontSize: 12, color: "#89dceb", marginBottom: 12,
                    }}>
                      <span style={{
                        width: 8, height: 8, borderRadius: "50%",
                        background: "#89dceb", boxShadow: "0 0 8px #89dceb",
                        animation: "pulse 1s infinite",
                        display: "inline-block", flexShrink: 0,
                      }} />
                      Exécution en cours…
                    </div>
                  )}
                  {(liveSession.steps || []).length === 0 ? (
                    <div style={{ color: "var(--text-3)", fontSize: 12, textAlign: "center", padding: 20 }}>
                      En attente de la première étape…
                    </div>
                  ) : (
                    [...(liveSession.steps || [])].reverse().map(step => (
                      <StepRow key={step.id} step={step} />
                    ))
                  )}
                </div>
              </>
            ) : (
              <div style={{ color: "var(--text-3)", fontSize: 12, padding: 20, textAlign: "center" }}>
                Chargement…
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Tab Historique ── */}
      {tab === "history" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {sessions.length === 0 ? (
            <div style={{ textAlign: "center", color: "var(--text-3)", padding: 40, fontSize: 13 }}>
              Aucune session effectuée.
            </div>
          ) : sessions.map(s => (
            <div
              key={s.id}
              onClick={() => { setSelectedId(s.id); setTab("live"); }}
              style={{
                background: "var(--surface-2)", borderRadius: 10, padding: "14px 16px",
                cursor: "pointer", border: "1px solid var(--border)",
                display: "flex", alignItems: "flex-start", gap: 12,
              }}
            >
              <span style={{ fontSize: 18, marginTop: 1 }}>
                {STATUS_COLORS[s.status]?.icon || "•"}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 2 }}>
                  {s.goal}
                </div>
                <div style={{ display: "flex", gap: 10, fontSize: 11, color: "var(--text-3)" }}>
                  <StatusBadge status={s.status} />
                  <span>{s.steps_count} étapes</span>
                  {s.duration_ms && <span>{(s.duration_ms / 1000).toFixed(1)}s</span>}
                  <span style={{ fontFamily: "monospace" }}>{s.id}</span>
                </div>
                {s.final_result && (
                  <div style={{ fontSize: 11, color: "#a6e3a1", marginTop: 4 }}>→ {s.final_result}</div>
                )}
                {s.error && (
                  <div style={{ fontSize: 11, color: "#f38ba8", marginTop: 4 }}>✗ {s.error}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Tab Screenshot ── */}
      {tab === "screen" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button
              onClick={handleScreenshot}
              disabled={scLoading}
              style={{
                padding: "10px 24px", borderRadius: 8, border: "none",
                background: "var(--primary)", color: "white",
                fontSize: 13, fontWeight: 600, cursor: "pointer",
                opacity: scLoading ? 0.6 : 1,
              }}
            >{scLoading ? "Capture…" : "📸 Capturer l'écran"}</button>
            {screenshot?.hash && (
              <span style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "monospace" }}>
                SHA: {screenshot.hash.slice(0, 12)}…
              </span>
            )}
          </div>

          {screenshot && (
            <>
              {screenshot.base64 && (
                <div style={{ borderRadius: 10, overflow: "hidden", border: "1px solid var(--border)", maxWidth: 900 }}>
                  <img
                    src={`data:image/png;base64,${screenshot.base64}`}
                    alt="screenshot"
                    style={{ width: "100%", display: "block" }}
                  />
                </div>
              )}
              {screenshot.description && (
                <div style={{
                  background: "var(--surface-2)", borderRadius: 10, padding: "14px 16px",
                  fontSize: 13, color: "var(--text-2)", lineHeight: 1.6, maxWidth: 900,
                }}>
                  <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 6, fontWeight: 600 }}>
                    🧠 Description moondream
                  </div>
                  {screenshot.description}
                </div>
              )}
            </>
          )}

          {!screenshot && !scLoading && (
            <div style={{ color: "var(--text-3)", fontSize: 13, textAlign: "center", padding: 40 }}>
              Clique sur "Capturer l'écran" pour voir ce que l'agent voit.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const MAX_STEPS_DEFAULT = 20;
