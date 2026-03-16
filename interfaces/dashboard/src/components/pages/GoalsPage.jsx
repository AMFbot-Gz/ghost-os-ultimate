/**
 * GoalsPage.jsx — Autonomous Goal Loop (Phase 13)
 * Objectifs persistants SQLite, décomposition HTN, auto-exécution missions
 */
import React, { useEffect, useState, useCallback } from "react";
import { useToast } from "../Toast.jsx";

const GOALS_API = "http://localhost:8010";

const STATUS_META = {
  pending:   { label: "En attente", color: "#f9e2af", bg: "rgba(249,226,175,0.12)" },
  active:    { label: "Actif",      color: "#89b4fa", bg: "rgba(137,180,250,0.12)" },
  completed: { label: "Terminé",    color: "#a6e3a1", bg: "rgba(166,227,161,0.12)" },
  failed:    { label: "Échoué",     color: "#f38ba8", bg: "rgba(243,139,168,0.12)" },
  paused:    { label: "Pausé",      color: "#94a3b8", bg: "rgba(148,163,184,0.12)" },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function Badge({ status }) {
  const m = STATUS_META[status] || STATUS_META.pending;
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20,
      background: m.bg, color: m.color, letterSpacing: "0.04em",
    }}>{m.label.toUpperCase()}</span>
  );
}

function PriorityBar({ value = 5 }) {
  const pct = (value / 10) * 100;
  const color = value >= 8 ? "#f38ba8" : value >= 5 ? "#f9e2af" : "#a6e3a1";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ width: 60, height: 4, background: "var(--surface-3, #222)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2 }} />
      </div>
      <span style={{ fontSize: 11, color: "var(--text-3)", width: 14 }}>{value}</span>
    </div>
  );
}

function ProgressBar({ pct }) {
  const color = pct >= 100 ? "#a6e3a1" : pct >= 50 ? "#89b4fa" : "var(--primary, #E07B54)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ flex: 1, height: 5, background: "var(--surface-3, #222)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 3, transition: "width 0.4s ease" }} />
      </div>
      <span style={{ fontSize: 10, color: "var(--text-3)", width: 32, textAlign: "right" }}>{pct}%</span>
    </div>
  );
}

// ─── Plan Modal ───────────────────────────────────────────────────────────────

function PlanModal({ goal, plan, onClose }) {
  if (!plan) return null;
  const tasks = plan.subtasks || plan.tasks || [];
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center",
    }} onClick={onClose}>
      <div
        style={{
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: 12, padding: 24, maxWidth: 560, width: "90%", maxHeight: "80vh", overflow: "auto",
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
            🗺️ Plan HTN — {goal.title}
          </h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-3)", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>
        {plan.plan_id && (
          <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 12, fontFamily: "monospace" }}>
            plan_id: {plan.plan_id} · {tasks.length} tâches
          </div>
        )}
        {tasks.length === 0 ? (
          <div style={{ color: "var(--text-3)", fontSize: 13 }}>Aucune tâche générée.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {tasks.map((t, i) => (
              <div key={i} style={{
                background: "var(--surface-2)", borderRadius: 7, padding: "10px 14px",
                borderLeft: "3px solid var(--primary, #E07B54)",
              }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 3 }}>
                  {i + 1}. {t.name || t.description || t.action || JSON.stringify(t)}
                </div>
                {t.skill && <div style={{ fontSize: 11, color: "var(--text-3)" }}>skill: {t.skill}</div>}
                {t.risk  && <div style={{ fontSize: 11, color: t.risk === "high" ? "#f38ba8" : "var(--text-3)" }}>risque: {t.risk}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Next Mission Card ────────────────────────────────────────────────────────

function ScheduleCard({ schedule, next }) {
  if (!next) return null;
  const when = next.next_mission_at ? new Date(next.next_mission_at).toLocaleTimeString("fr-FR") : "—";
  return (
    <div style={{
      background: "rgba(137,180,250,0.08)", border: "1px solid rgba(137,180,250,0.25)",
      borderRadius: 10, padding: "14px 18px", marginBottom: 20,
      display: "flex", alignItems: "center", gap: 14,
    }}>
      <span style={{ fontSize: 22 }}>📅</span>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#89b4fa", marginBottom: 2 }}>
          Prochaine auto-mission
        </div>
        <div style={{ fontSize: 13, color: "var(--text)", fontWeight: 500 }}>{next.title}</div>
        <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
          Priorité {next.priority} · {when}
          {schedule.length > 1 && ` · +${schedule.length - 1} autres`}
        </div>
      </div>
    </div>
  );
}

// ─── Goal Row ─────────────────────────────────────────────────────────────────

function GoalRow({ goal, onDelete, onStatus, onExecute, onPlan, planning }) {
  const [expanded, setExpanded] = useState(false);
  const pct = goal.progress_pct || 0;
  const nextAt = goal.next_mission_at
    ? new Date(goal.next_mission_at).toLocaleTimeString("fr-FR")
    : null;

  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 10, overflow: "hidden",
    }}>
      {/* Header */}
      <div
        style={{ padding: "14px 16px", cursor: "pointer", display: "flex", gap: 12, alignItems: "flex-start" }}
        onClick={() => setExpanded(e => !e)}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5, flexWrap: "wrap" }}>
            <Badge status={goal.status} />
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
              {goal.title}
            </span>
          </div>
          <ProgressBar pct={pct} />
          <div style={{ display: "flex", gap: 12, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
            <PriorityBar value={goal.priority} />
            {goal.missions_count > 0 && (
              <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                {goal.missions_count} mission{goal.missions_count > 1 ? "s" : ""}
              </span>
            )}
            {goal.deadline && (
              <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                📅 {new Date(goal.deadline).toLocaleDateString("fr-FR")}
              </span>
            )}
            {nextAt && goal.status === "active" && (
              <span style={{ fontSize: 11, color: "#89b4fa" }}>⏱ {nextAt}</span>
            )}
          </div>
        </div>
        <span style={{ color: "var(--text-3)", fontSize: 12, flexShrink: 0, marginTop: 2 }}>{expanded ? "▲" : "▼"}</span>
      </div>

      {/* Expanded */}
      {expanded && (
        <div style={{ borderTop: "1px solid var(--border)", padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          {goal.description !== goal.title && (
            <p style={{ margin: 0, fontSize: 13, color: "var(--text-2)" }}>{goal.description}</p>
          )}

          {/* Status buttons */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {["pending", "active", "paused", "completed", "failed"].map(s => (
              <button
                key={s}
                onClick={() => onStatus(goal.id, s)}
                disabled={goal.status === s}
                style={{
                  fontSize: 11, padding: "4px 10px", borderRadius: 6, border: "none",
                  background: goal.status === s ? "var(--primary, #E07B54)" : "var(--surface-2)",
                  color: goal.status === s ? "white" : "var(--text-2)",
                  fontWeight: goal.status === s ? 700 : 400,
                  cursor: goal.status === s ? "default" : "pointer",
                }}
              >{STATUS_META[s]?.label || s}</button>
            ))}
          </div>

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={() => onExecute(goal.id)}
              style={{
                background: "rgba(137,180,250,0.15)", border: "1px solid rgba(137,180,250,0.4)",
                borderRadius: 7, padding: "7px 14px", color: "#89b4fa",
                fontSize: 12, fontWeight: 600, cursor: "pointer",
              }}
            >▶ Exécuter maintenant</button>
            <button
              onClick={() => onPlan(goal.id)}
              disabled={planning === goal.id}
              style={{
                background: "rgba(224,123,84,0.12)", border: "1px solid rgba(224,123,84,0.3)",
                borderRadius: 7, padding: "7px 14px", color: "var(--primary, #E07B54)",
                fontSize: 12, fontWeight: 600, cursor: planning === goal.id ? "not-allowed" : "pointer",
                opacity: planning === goal.id ? 0.6 : 1,
              }}
            >{planning === goal.id ? "⏳ Planification…" : "🗺️ Décomposer"}</button>
            <button
              onClick={() => onDelete(goal.id)}
              style={{
                background: "rgba(243,139,168,0.1)", border: "1px solid rgba(243,139,168,0.3)",
                borderRadius: 7, padding: "7px 14px", color: "#f38ba8",
                fontSize: 12, fontWeight: 600, cursor: "pointer", marginLeft: "auto",
              }}
            >🗑 Supprimer</button>
          </div>

          {/* Plan preview if cached */}
          {goal.plan_json && (() => {
            try {
              const p = JSON.parse(goal.plan_json);
              const tasks = p.subtasks || p.tasks || [];
              if (!tasks.length) return null;
              return (
                <div style={{ background: "var(--surface-2)", borderRadius: 7, padding: "10px 14px" }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", marginBottom: 6 }}>Dernier plan HTN ({tasks.length} tâches)</div>
                  {tasks.slice(0, 3).map((t, i) => (
                    <div key={i} style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 2 }}>
                      {i + 1}. {t.name || t.description || t.action || "—"}
                    </div>
                  ))}
                  {tasks.length > 3 && <div style={{ fontSize: 11, color: "var(--text-3)" }}>+{tasks.length - 3} tâches…</div>}
                </div>
              );
            } catch { return null; }
          })()}
        </div>
      )}
    </div>
  );
}

// ─── Stats Bar ────────────────────────────────────────────────────────────────

function StatsBar({ stats }) {
  if (!stats) return null;
  const items = [
    { label: "Total",     value: stats.goals_total,     color: "var(--text)" },
    { label: "Actifs",    value: stats.goals_active,    color: "#89b4fa" },
    { label: "Terminés",  value: stats.goals_completed, color: "#a6e3a1" },
    { label: "Missions",  value: stats.missions_total,  color: "var(--primary, #E07B54)" },
  ];
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
      {items.map(item => (
        <div key={item.label} style={{
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: 8, padding: "10px 16px", flex: 1, minWidth: 100, textAlign: "center",
        }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: item.color }}>{item.value ?? 0}</div>
          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{item.label}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function GoalsPage() {
  const [goals, setGoals]       = useState([]);
  const [stats, setStats]       = useState(null);
  const [schedule, setSchedule] = useState([]);
  const [next, setNext]         = useState(null);
  const [input, setInput]       = useState("");
  const [priority, setPriority] = useState(5);
  const [deadline, setDeadline] = useState("");
  const [autoExec, setAutoExec] = useState(true);
  const [filter, setFilter]     = useState("all");
  const [loading, setLoading]   = useState(false);
  const [planning, setPlanning] = useState(null);
  const [modal, setModal]       = useState(null);  // { goal, plan }
  const { toast } = useToast() || {};

  const load = useCallback(async () => {
    try {
      const [gRes, sRes, stRes] = await Promise.all([
        fetch(`${GOALS_API}/goals?status=${filter}`).then(r => r.json()),
        fetch(`${GOALS_API}/goals/schedule`).then(r => r.json()).catch(() => null),
        fetch(`${GOALS_API}/goals/stats`).then(r => r.json()).catch(() => null),
      ]);
      setGoals(gRes.goals || []);
      if (sRes) { setSchedule(sRes.schedule || []); setNext(sRes.next || null); }
      if (stRes) setStats(stRes);
    } catch {}
  }, [filter]);

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);

  const addGoal = async () => {
    if (!input.trim()) return;
    setLoading(true);
    try {
      const r = await fetch(`${GOALS_API}/goals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: input, priority, deadline: deadline || null, auto_execute: autoExec }),
      });
      if (r.ok) {
        toast?.("Objectif créé ✅", "success");
        setInput(""); setDeadline("");
        load();
      } else { toast?.("Erreur création", "error"); }
    } catch { toast?.("Serveur inaccessible", "error"); }
    setLoading(false);
  };

  const deleteGoal = async (id) => {
    if (!confirm("Supprimer cet objectif ?")) return;
    await fetch(`${GOALS_API}/goals/${id}`, { method: "DELETE" });
    toast?.("Objectif supprimé", "warn");
    load();
  };

  const updateStatus = async (id, status) => {
    await fetch(`${GOALS_API}/goals/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    load();
  };

  const executeNow = async (id) => {
    try {
      const r = await fetch(`${GOALS_API}/goals/${id}/execute`, { method: "POST" });
      if (r.ok) { toast?.("Mission lancée ▶", "info"); load(); }
      else { toast?.("Erreur lancement", "error"); }
    } catch { toast?.("Serveur inaccessible", "error"); }
  };

  const decompose = async (id) => {
    setPlanning(id);
    try {
      const r = await fetch(`${GOALS_API}/goals/${id}/plan`, { method: "POST" });
      if (r.ok) {
        const d = await r.json();
        const goal = goals.find(g => g.id === id);
        setModal({ goal, plan: d.plan });
        load();
      } else { toast?.("Planner indisponible", "warn"); }
    } catch { toast?.("Erreur décomposition", "error"); }
    setPlanning(null);
  };

  const allStatuses = ["all", ...Object.keys(STATUS_META)];
  const filtered = filter === "all" ? goals : goals.filter(g => g.status === filter);

  return (
    <div style={{ padding: 24, maxWidth: 860, margin: "0 auto" }}>
      {modal && <PlanModal goal={modal.goal} plan={modal.plan} onClose={() => setModal(null)} />}

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", margin: "0 0 4px" }}>
          🏆 Objectifs autonomes
        </h2>
        <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0 }}>
          Auto-exécution toutes les 30 min · Décomposition HTN · Persistance SQLite
        </p>
      </div>

      {/* Stats */}
      <StatsBar stats={stats} />

      {/* Next mission */}
      <ScheduleCard schedule={schedule} next={next} />

      {/* Create form */}
      <div style={{
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: 10, padding: 18, marginBottom: 20,
      }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)", marginBottom: 10 }}>Ajouter un objectif</div>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Décris l'objectif à atteindre…"
          rows={2}
          style={{
            width: "100%", background: "var(--surface-2)", border: "1px solid var(--border)",
            borderRadius: 8, padding: "8px 12px", color: "var(--text)", fontSize: 13,
            resize: "vertical", boxSizing: "border-box", fontFamily: "inherit",
          }}
        />
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <label style={{ fontSize: 11, color: "var(--text-3)" }}>Priorité</label>
            <input
              type="number" value={priority} onChange={e => setPriority(Math.max(1, Math.min(10, +e.target.value)))}
              min={1} max={10}
              style={{
                width: 50, background: "var(--surface-2)", border: "1px solid var(--border)",
                borderRadius: 6, padding: "4px 8px", color: "var(--text)", fontSize: 12, textAlign: "center",
              }}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <label style={{ fontSize: 11, color: "var(--text-3)" }}>Deadline</label>
            <input
              type="date" value={deadline} onChange={e => setDeadline(e.target.value)}
              style={{
                background: "var(--surface-2)", border: "1px solid var(--border)",
                borderRadius: 6, padding: "4px 8px", color: "var(--text)", fontSize: 12,
              }}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" id="auto_exec" checked={autoExec} onChange={e => setAutoExec(e.target.checked)} />
            <label htmlFor="auto_exec" style={{ fontSize: 11, color: "var(--text-3)", cursor: "pointer" }}>Auto-exécution</label>
          </div>
          <button
            onClick={addGoal}
            disabled={loading || !input.trim()}
            style={{
              marginLeft: "auto", background: "var(--primary, #E07B54)", color: "white",
              border: "none", borderRadius: 8, padding: "9px 20px", fontSize: 13,
              fontWeight: 600, cursor: loading || !input.trim() ? "not-allowed" : "pointer",
              opacity: loading || !input.trim() ? 0.6 : 1,
            }}
          >{loading ? "…" : "Ajouter"}</button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {allStatuses.map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            style={{
              fontSize: 11, padding: "4px 12px", borderRadius: 20, border: "none", cursor: "pointer",
              background: filter === s ? "var(--primary, #E07B54)" : "var(--surface-2)",
              color: filter === s ? "white" : "var(--text-3)",
              fontWeight: filter === s ? 600 : 400,
            }}
          >{s === "all" ? "Tous" : STATUS_META[s]?.label}</button>
        ))}
      </div>

      {/* Goal list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filtered.length === 0 && (
          <div style={{
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: 10, padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 13,
          }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🏁</div>
            {filter === "all" ? "Aucun objectif. Ajoutez-en un ci-dessus." : `Aucun objectif "${STATUS_META[filter]?.label}".`}
          </div>
        )}
        {filtered.map(g => (
          <GoalRow
            key={g.id}
            goal={g}
            onDelete={deleteGoal}
            onStatus={updateStatus}
            onExecute={executeNow}
            onPlan={decompose}
            planning={planning}
          />
        ))}
      </div>
    </div>
  );
}
