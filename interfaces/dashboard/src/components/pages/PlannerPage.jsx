/**
 * PlannerPage.jsx — Planificateur HTN (Hierarchical Task Network)
 * Décompose les missions en arbres de sous-tâches via le service Planner :8008
 */
import React, { useState, useEffect, useCallback, useRef } from "react";

const PLANNER_API = "http://localhost:8008";

// ─── Constantes de style ─────────────────────────────────────────────────────

const S = {
  bg:      "var(--bg, #0D0D0D)",
  surface: "var(--surface, #111111)",
  surface2:"var(--surface-2, #1A1A1A)",
  border:  "var(--border, #2f2f2f)",
  text:    "var(--text, #F5F5F5)",
  text2:   "var(--text-2, #8a8a8a)",
  text3:   "var(--text-3, #6a6a6a)",
  primary: "var(--primary, #E07B54)",
  green:   "var(--green, #22C55E)",
  red:     "var(--red, #EF4444)",
  amber:   "#F59E0B",
  violet:  "#6366F1",
  mono:    "'JetBrains Mono', 'Fira Code', monospace",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt_date(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })
      + " " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  } catch { return iso.slice(0, 16); }
}

function fmt_relative(iso) {
  if (!iso) return "—";
  try {
    const diff = Date.now() - new Date(iso.endsWith("Z") ? iso : iso + "Z").getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60)  return `il y a ${s}s`;
    if (s < 3600) return `il y a ${Math.floor(s / 60)}min`;
    if (s < 86400) return `il y a ${Math.floor(s / 3600)}h`;
    return `il y a ${Math.floor(s / 86400)}j`;
  } catch { return iso.slice(0, 10); }
}

function fmt_duration(ms) {
  if (!ms && ms !== 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s`;
}

function truncate(str, n) {
  if (!str) return "—";
  return str.length > n ? str.slice(0, n) + "…" : str;
}

// ─── Couleurs de statut ───────────────────────────────────────────────────────

const STATUS_COLORS = {
  pending:    S.text3,
  executing:  S.primary,
  done:       S.green,
  failed:     S.red,
  replanning: S.amber,
};

const STATUS_LABELS = {
  pending:    "En attente",
  executing:  "Exécution",
  done:       "Terminé",
  failed:     "Échoué",
  replanning: "Re-planification",
};

const COMPLEXITY_COLORS = {
  simple:   S.green,
  moderate: S.amber,
  complex:  S.violet,
};

// ─── Composants atomiques ─────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const color = STATUS_COLORS[status] || S.text3;
  return (
    <span style={{
      background: `${color}22`,
      color,
      border: `1px solid ${color}55`,
      borderRadius: 6,
      padding: "2px 8px",
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: "0.04em",
      textTransform: "uppercase",
    }}>
      {STATUS_LABELS[status] || status}
    </span>
  );
}

function ComplexityBadge({ complexity }) {
  const color = COMPLEXITY_COLORS[complexity] || S.text3;
  return (
    <span style={{
      background: `${color}22`,
      color,
      border: `1px solid ${color}44`,
      borderRadius: 6,
      padding: "2px 8px",
      fontSize: 10,
      fontWeight: 700,
    }}>
      {complexity || "—"}
    </span>
  );
}

function SkillBadge({ skill }) {
  if (!skill) return null;
  return (
    <span style={{
      background: `${S.primary}22`,
      color: S.primary,
      border: `1px solid ${S.primary}44`,
      borderRadius: 6,
      padding: "2px 7px",
      fontSize: 10,
      fontWeight: 700,
      fontFamily: S.mono,
    }}>
      {skill}
    </span>
  );
}

function StatusDot({ status }) {
  const color = STATUS_COLORS[status] || S.text3;
  const pulse = status === "executing" || status === "replanning";
  return (
    <span style={{
      display: "inline-block",
      width: 8, height: 8,
      borderRadius: "50%",
      background: color,
      flexShrink: 0,
      boxShadow: pulse ? `0 0 0 2px ${color}44` : "none",
    }} />
  );
}

function Spinner() {
  return (
    <span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>⟳</span>
  );
}

// ─── Noeud de tâche (récursif) ────────────────────────────────────────────────

function TaskNode({ task, depth = 0 }) {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = task.subtasks && task.subtasks.length > 0;
  const hasConditions = (task.preconditions && task.preconditions.length > 0)
    || (task.postconditions && task.postconditions.length > 0);

  return (
    <div style={{ marginLeft: depth * 20 }}>
      <div style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: "7px 10px",
        borderRadius: 6,
        background: depth === 0 ? S.surface2 : "transparent",
        border: depth === 0 ? `1px solid ${S.border}` : "none",
        borderLeft: depth > 0 ? `2px solid ${S.border}` : undefined,
        marginBottom: 4,
      }}>
        {/* Indicateur d'arbre */}
        {depth > 0 && (
          <span style={{ color: S.text3, fontSize: 11, marginTop: 1, flexShrink: 0 }}>└</span>
        )}

        <StatusDot status={task.status} />

        {/* ID */}
        <span style={{
          fontFamily: S.mono, fontSize: 11, color: S.primary,
          flexShrink: 0, marginTop: 1,
        }}>
          {task.id || "t?"}
        </span>

        {/* Description */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, color: S.text, lineHeight: 1.4 }}>
            {task.description || task.name || "(tâche sans description)"}
          </div>

          {/* Skill + durée + résultat */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: hasChildren || hasConditions ? 4 : 0, alignItems: "center" }}>
            {task.skill && <SkillBadge skill={task.skill} />}
            {task.duration_ms != null && (
              <span style={{ fontSize: 10, color: S.text3 }}>{fmt_duration(task.duration_ms)}</span>
            )}
            {task.result && (
              <span style={{ fontSize: 10, color: S.text3 }}>
                → {truncate(task.result, 60)}
              </span>
            )}
          </div>

          {/* Conditions (collapsibles) */}
          {hasConditions && (
            <div style={{ marginTop: 4 }}>
              <button
                onClick={() => setExpanded(e => !e)}
                style={{
                  background: "transparent", border: "none", cursor: "pointer",
                  color: S.text3, fontSize: 10, padding: 0,
                }}
              >
                {expanded ? "▲ Masquer conditions" : "▼ Voir conditions"}
              </button>
              {expanded && (
                <div style={{
                  marginTop: 4, padding: "6px 8px",
                  background: S.surface2, borderRadius: 6,
                  fontSize: 11, color: S.text2,
                }}>
                  {task.preconditions?.length > 0 && (
                    <div style={{ marginBottom: 4 }}>
                      <span style={{ color: S.text3, fontWeight: 600 }}>Pré: </span>
                      {task.preconditions.join(", ")}
                    </div>
                  )}
                  {task.postconditions?.length > 0 && (
                    <div>
                      <span style={{ color: S.text3, fontWeight: 600 }}>Post: </span>
                      {task.postconditions.join(", ")}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Sous-tâches récursives */}
      {hasChildren && (
        <div style={{ marginLeft: 4 }}>
          {task.subtasks.map((child, i) => (
            <TaskNode key={child.id || i} task={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Carte de plan ────────────────────────────────────────────────────────────

function PlanCard({ plan, isSelected, onClick }) {
  const subtaskCount = plan.subtasks?.length || plan.subtask_count || 0;
  return (
    <div
      onClick={onClick}
      style={{
        background: S.surface,
        border: `1px solid ${isSelected ? S.primary : S.border}`,
        borderLeft: `3px solid ${STATUS_COLORS[plan.status] || S.text3}`,
        borderRadius: 10,
        padding: "12px 14px",
        cursor: "pointer",
        transition: "border-color 0.15s",
      }}
      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.borderColor = S.text3; }}
      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.borderColor = S.border; }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13, color: S.text, fontWeight: 500,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {truncate(plan.mission, 80)}
          </div>
          <div style={{
            fontSize: 11, color: S.text3, marginTop: 4,
            display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center",
          }}>
            <span>{fmt_relative(plan.created_at)}</span>
            {subtaskCount > 0 && <span>{subtaskCount} tâche{subtaskCount > 1 ? "s" : ""}</span>}
            {plan.priority && <span>P{plan.priority}</span>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
          <ComplexityBadge complexity={plan.complexity} />
          <StatusBadge status={plan.status} />
        </div>
      </div>
    </div>
  );
}

// ─── Tab Plans ────────────────────────────────────────────────────────────────

function TabPlans({ plans, loading, onSelectPlan, selectedPlan, onRefresh, onPlanCreated }) {
  const [mission, setMission]       = useState("");
  const [priority, setPriority]     = useState(3);
  const [context, setContext]       = useState("");
  const [showCtx, setShowCtx]       = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult]         = useState(null);
  const [error, setError]           = useState(null);

  const onSubmit = useCallback(async () => {
    if (!mission.trim()) return;
    setSubmitting(true);
    setResult(null);
    setError(null);
    try {
      const body = { mission: mission.trim(), priority };
      if (context.trim()) body.context = context.trim();
      const r = await fetch(`${PLANNER_API}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${r.status}`);
      }
      const data = await r.json();
      setResult(data);
      setMission("");
      setContext("");
      onPlanCreated(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }, [mission, priority, context, onPlanCreated]);

  const inputStyle = {
    width: "100%", boxSizing: "border-box",
    background: S.surface, border: `1px solid ${S.border}`,
    borderRadius: 8, padding: "9px 12px",
    fontSize: 13, color: S.text, outline: "none",
    resize: "vertical",
  };

  return (
    <div>
      {/* Formulaire de planification */}
      <div style={{
        background: S.surface, border: `1px solid ${S.border}`,
        borderRadius: 12, padding: 18, marginBottom: 20,
      }}>
        <div style={{ fontSize: 12, color: S.text3, marginBottom: 8, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Nouvelle mission
        </div>

        <textarea
          value={mission}
          onChange={e => setMission(e.target.value)}
          placeholder="Décris la mission à planifier…"
          rows={3}
          style={inputStyle}
          onFocus={e => { e.target.style.borderColor = S.primary; }}
          onBlur={e => { e.target.style.borderColor = S.border; }}
        />

        {/* Priorité */}
        <div style={{ display: "flex", gap: 10, marginTop: 10, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: S.text2, flexShrink: 0 }}>Priorité :</span>
          {[1, 2, 3, 4, 5].map(p => (
            <button
              key={p}
              onClick={() => setPriority(p)}
              style={{
                width: 32, height: 32, borderRadius: 6,
                border: `1px solid ${priority === p ? S.primary : S.border}`,
                background: priority === p ? `${S.primary}22` : S.surface2,
                color: priority === p ? S.primary : S.text3,
                fontSize: 12, fontWeight: 700, cursor: "pointer",
              }}
            >{p}</button>
          ))}
          <button
            onClick={() => setShowCtx(v => !v)}
            style={{
              marginLeft: "auto", background: "transparent",
              border: "none", color: S.text3, fontSize: 12, cursor: "pointer",
            }}
          >
            {showCtx ? "▲ Masquer contexte" : "▼ Ajouter contexte"}
          </button>
        </div>

        {/* Contexte optionnel */}
        {showCtx && (
          <textarea
            value={context}
            onChange={e => setContext(e.target.value)}
            placeholder="Contexte additionnel (optionnel)…"
            rows={2}
            style={{ ...inputStyle, marginTop: 8, fontSize: 12 }}
            onFocus={e => { e.target.style.borderColor = S.primary; }}
            onBlur={e => { e.target.style.borderColor = S.border; }}
          />
        )}

        {/* Erreur inline */}
        {error && (
          <div style={{
            marginTop: 10, padding: "8px 12px", borderRadius: 8,
            background: `${S.red}15`, border: `1px solid ${S.red}55`,
            color: S.red, fontSize: 12,
          }}>
            ⚠ {error}
          </div>
        )}

        {/* Résultat */}
        {result && (
          <div style={{
            marginTop: 10, padding: "8px 12px", borderRadius: 8,
            background: `${S.green}15`, border: `1px solid ${S.green}44`,
            color: S.green, fontSize: 12,
          }}>
            ✓ Plan créé — {result.subtask_count || result.subtasks?.length || 0} tâche(s) générée(s)
            {result.complexity && <> · <ComplexityBadge complexity={result.complexity} /></>}
          </div>
        )}

        <button
          onClick={onSubmit}
          disabled={submitting || !mission.trim()}
          style={{
            marginTop: 12,
            background: submitting || !mission.trim() ? S.surface2 : S.primary,
            border: `1px solid ${submitting || !mission.trim() ? S.border : S.primary}`,
            borderRadius: 8, padding: "9px 22px",
            fontSize: 13, fontWeight: 700, cursor: submitting || !mission.trim() ? "not-allowed" : "pointer",
            color: submitting || !mission.trim() ? S.text3 : "white",
            display: "flex", alignItems: "center", gap: 8,
          }}
        >
          {submitting ? <><Spinner /> Planification…</> : "⚡ Planifier"}
        </button>
      </div>

      {/* Liste des plans */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: S.text3 }}>
          {plans.length} plan(s)
        </span>
        <button
          onClick={onRefresh}
          disabled={loading}
          style={{
            background: S.surface2, border: `1px solid ${S.border}`,
            borderRadius: 6, padding: "5px 12px", fontSize: 12, cursor: "pointer", color: S.text2,
          }}
        >{loading ? "…" : "↻ Refresh"}</button>
      </div>

      {loading && (
        <div style={{ textAlign: "center", color: S.text3, padding: 32, fontSize: 13 }}>Chargement…</div>
      )}

      {!loading && plans.length === 0 && (
        <div style={{
          textAlign: "center", color: S.text3, padding: 48,
          background: S.surface, borderRadius: 12, border: `1px solid ${S.border}`,
          fontSize: 13,
        }}>
          Aucun plan. Créez votre première mission ci-dessus.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {plans.map(plan => (
          <PlanCard
            key={plan.id || plan.plan_id}
            plan={plan}
            isSelected={selectedPlan?.id === plan.id || selectedPlan?.plan_id === plan.plan_id}
            onClick={() => onSelectPlan(plan)}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Tab Arbre de tâches ──────────────────────────────────────────────────────

function TabTree({ selectedPlan, onExecute, onReplan, executing, replanning }) {
  if (!selectedPlan) {
    return (
      <div style={{
        textAlign: "center", color: S.text3, padding: 60,
        background: S.surface, borderRadius: 12, border: `1px solid ${S.border}`,
        fontSize: 13,
      }}>
        Sélectionnez un plan dans l'onglet "Plans" pour visualiser son arbre de tâches.
      </div>
    );
  }

  const subtasks = selectedPlan.subtasks || [];
  const canReplan = selectedPlan.status === "failed";

  return (
    <div>
      {/* En-tête du plan sélectionné */}
      <div style={{
        background: S.surface, border: `1px solid ${S.border}`,
        borderRadius: 10, padding: "14px 16px", marginBottom: 16,
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: S.text, marginBottom: 6 }}>
              {selectedPlan.mission}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <StatusBadge status={selectedPlan.status} />
              <ComplexityBadge complexity={selectedPlan.complexity} />
              <span style={{ fontSize: 11, color: S.text3 }}>
                {subtasks.length} tâche(s)
              </span>
              {selectedPlan.created_at && (
                <span style={{ fontSize: 11, color: S.text3 }}>
                  {fmt_relative(selectedPlan.created_at)}
                </span>
              )}
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
            {canReplan && (
              <button
                onClick={onReplan}
                disabled={replanning}
                style={{
                  background: `${S.amber}22`, border: `1px solid ${S.amber}66`,
                  borderRadius: 7, padding: "7px 14px", fontSize: 12,
                  cursor: replanning ? "not-allowed" : "pointer",
                  color: S.amber, fontWeight: 600,
                  display: "flex", alignItems: "center", gap: 6,
                }}
              >
                {replanning ? <><Spinner /> Re-planification…</> : "↺ Re-planifier"}
              </button>
            )}
            <button
              onClick={onExecute}
              disabled={executing || selectedPlan.status === "done"}
              style={{
                background: executing || selectedPlan.status === "done"
                  ? S.surface2
                  : S.primary,
                border: `1px solid ${executing || selectedPlan.status === "done" ? S.border : S.primary}`,
                borderRadius: 7, padding: "7px 16px", fontSize: 12,
                cursor: executing || selectedPlan.status === "done" ? "not-allowed" : "pointer",
                color: executing || selectedPlan.status === "done" ? S.text3 : "white",
                fontWeight: 600,
                display: "flex", alignItems: "center", gap: 6,
              }}
            >
              {executing ? <><Spinner /> Exécution…</> : "▶ Exécuter ce plan"}
            </button>
          </div>
        </div>
      </div>

      {/* Arbre */}
      {subtasks.length === 0 ? (
        <div style={{
          textAlign: "center", color: S.text3, padding: 32,
          background: S.surface, borderRadius: 10, border: `1px solid ${S.border}`,
          fontSize: 12,
        }}>
          Ce plan ne contient pas de sous-tâches.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {subtasks.map((task, i) => (
            <TaskNode key={task.id || i} task={task} depth={0} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab Historique ───────────────────────────────────────────────────────────

function TabHistory({ plans, loading, onRefresh }) {
  const [filterText, setFilterText] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");

  const filtered = plans.filter(p => {
    const textMatch = !filterText || (p.mission || "").toLowerCase().includes(filterText.toLowerCase());
    const statusMatch = filterStatus === "all" || p.status === filterStatus;
    return textMatch && statusMatch;
  });

  const sorted = [...filtered].sort((a, b) => {
    const da = new Date(a.created_at || 0);
    const db = new Date(b.created_at || 0);
    return db - da;
  });

  // Stats
  const total = plans.length;
  const done  = plans.filter(p => p.status === "done").length;
  const successRate = total > 0 ? Math.round((done / total) * 100) : 0;
  const avgSubtasks = total > 0
    ? (plans.reduce((acc, p) => acc + (p.subtasks?.length || p.subtask_count || 0), 0) / total).toFixed(1)
    : "—";
  const durations = plans.filter(p => p.duration_ms != null).map(p => p.duration_ms);
  const avgDuration = durations.length > 0
    ? fmt_duration(Math.round(durations.reduce((a, b) => a + b, 0) / durations.length))
    : "—";

  const statCardStyle = {
    background: S.surface, border: `1px solid ${S.border}`,
    borderRadius: 10, padding: "14px 18px", flex: 1, minWidth: 110,
  };

  return (
    <div>
      {/* Stats header */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
        <div style={statCardStyle}>
          <div style={{ fontSize: 22, fontWeight: 700, color: S.primary }}>{total}</div>
          <div style={{ fontSize: 12, color: S.text2, marginTop: 2 }}>Plans total</div>
        </div>
        <div style={statCardStyle}>
          <div style={{ fontSize: 22, fontWeight: 700, color: successRate >= 70 ? S.green : successRate >= 40 ? S.amber : S.red }}>
            {successRate}%
          </div>
          <div style={{ fontSize: 12, color: S.text2, marginTop: 2 }}>Taux de succès</div>
        </div>
        <div style={statCardStyle}>
          <div style={{ fontSize: 22, fontWeight: 700, color: S.text }}>{avgSubtasks}</div>
          <div style={{ fontSize: 12, color: S.text2, marginTop: 2 }}>Sous-tâches moy.</div>
        </div>
        <div style={statCardStyle}>
          <div style={{ fontSize: 22, fontWeight: 700, color: S.text }}>{avgDuration}</div>
          <div style={{ fontSize: 12, color: S.text2, marginTop: 2 }}>Durée moyenne</div>
        </div>
      </div>

      {/* Filtres */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <input
          value={filterText}
          onChange={e => setFilterText(e.target.value)}
          placeholder="Rechercher une mission…"
          style={{
            flex: 1, minWidth: 180,
            background: S.surface, border: `1px solid ${S.border}`,
            borderRadius: 8, padding: "8px 12px", fontSize: 13, color: S.text, outline: "none",
          }}
          onFocus={e => { e.target.style.borderColor = S.primary; }}
          onBlur={e => { e.target.style.borderColor = S.border; }}
        />
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          style={{
            background: S.surface, border: `1px solid ${S.border}`,
            borderRadius: 8, padding: "8px 10px", fontSize: 12, color: S.text2,
            cursor: "pointer", outline: "none",
          }}
        >
          <option value="all">Tous statuts</option>
          <option value="pending">En attente</option>
          <option value="executing">En cours</option>
          <option value="done">Terminés</option>
          <option value="failed">Échoués</option>
          <option value="replanning">Re-planification</option>
        </select>
        <button
          onClick={onRefresh}
          disabled={loading}
          style={{
            background: S.surface2, border: `1px solid ${S.border}`,
            borderRadius: 6, padding: "7px 14px", fontSize: 12, cursor: "pointer", color: S.text2,
          }}
        >{loading ? "…" : "↻ Refresh"}</button>
        <span style={{ fontSize: 12, color: S.text3, flexShrink: 0 }}>
          {sorted.length} / {total}
        </span>
      </div>

      {loading && (
        <div style={{ textAlign: "center", color: S.text3, padding: 32, fontSize: 13 }}>Chargement…</div>
      )}

      {!loading && sorted.length === 0 && (
        <div style={{
          textAlign: "center", color: S.text3, padding: 40,
          background: S.surface, borderRadius: 12, border: `1px solid ${S.border}`,
          fontSize: 13,
        }}>
          Aucun plan correspondant.
        </div>
      )}

      {/* Tableau */}
      {!loading && sorted.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${S.border}` }}>
                {["Mission", "Complexité", "Tâches", "Statut", "Durée", "Date"].map(h => (
                  <th key={h} style={{
                    padding: "8px 10px", textAlign: "left",
                    color: S.text3, fontWeight: 600, fontSize: 11,
                    textTransform: "uppercase", letterSpacing: "0.05em",
                    whiteSpace: "nowrap",
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((plan, i) => {
                const subtaskCount = plan.subtasks?.length || plan.subtask_count || 0;
                return (
                  <tr
                    key={plan.id || plan.plan_id || i}
                    style={{
                      borderBottom: `1px solid ${S.border}`,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = S.surface2; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                  >
                    <td style={{ padding: "10px 10px", color: S.text, maxWidth: 280 }}>
                      <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 260 }}>
                        {truncate(plan.mission, 70)}
                      </div>
                    </td>
                    <td style={{ padding: "10px 10px", whiteSpace: "nowrap" }}>
                      <ComplexityBadge complexity={plan.complexity} />
                    </td>
                    <td style={{ padding: "10px 10px", color: S.text2, textAlign: "center" }}>
                      {subtaskCount || "—"}
                    </td>
                    <td style={{ padding: "10px 10px", whiteSpace: "nowrap" }}>
                      <StatusBadge status={plan.status} />
                    </td>
                    <td style={{ padding: "10px 10px", color: S.text3, whiteSpace: "nowrap" }}>
                      {fmt_duration(plan.duration_ms)}
                    </td>
                    <td style={{ padding: "10px 10px", color: S.text3, whiteSpace: "nowrap" }}>
                      {fmt_date(plan.created_at)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Page principale ──────────────────────────────────────────────────────────

export default function PlannerPage({ status, wsEvents, onNavigate }) {
  const [plans, setPlans]                   = useState([]);
  const [selectedPlan, setSelectedPlan]     = useState(null);
  const [activeTab, setActiveTab]           = useState("plans");
  const [loading, setLoading]               = useState(true);
  const [executing, setExecuting]           = useState(false);
  const [replanning, setReplanning]         = useState(false);
  const [execError, setExecError]           = useState(null);

  const pollRef = useRef(null);

  // Chargement des plans
  const loadPlans = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${PLANNER_API}/plans`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      const list = data.plans || data || [];
      setPlans(list);

      // Resynchronise le plan sélectionné si présent
      setSelectedPlan(prev => {
        if (!prev) return prev;
        const updated = list.find(p => (p.id || p.plan_id) === (prev.id || prev.plan_id));
        return updated || prev;
      });
    } catch (e) {
      console.error("PlannerPage loadPlans error:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  // Charge un plan individuel pour le polling
  const loadPlanDetail = useCallback(async (planId) => {
    try {
      const r = await fetch(`${PLANNER_API}/plan/${planId}`);
      if (!r.ok) return;
      const data = await r.json();
      const plan = data.plan || data;
      setSelectedPlan(plan);
      setPlans(prev => prev.map(p =>
        (p.id || p.plan_id) === planId ? plan : p
      ));
    } catch (e) {
      console.error("PlannerPage loadPlanDetail error:", e);
    }
  }, []);

  useEffect(() => { loadPlans(); }, [loadPlans]);

  // Polling du plan actif (executing / replanning) toutes les 3s
  useEffect(() => {
    clearInterval(pollRef.current);
    if (!selectedPlan) return;
    const planId = selectedPlan.id || selectedPlan.plan_id;
    if (!planId) return;
    const active = selectedPlan.status === "executing" || selectedPlan.status === "replanning";
    if (!active) return;
    pollRef.current = setInterval(() => {
      loadPlanDetail(planId);
    }, 3000);
    return () => clearInterval(pollRef.current);
  }, [selectedPlan, loadPlanDetail]);

  // Sélection d'un plan + navigation vers l'arbre
  const onSelectPlan = useCallback((plan) => {
    setSelectedPlan(plan);
    setActiveTab("tree");
  }, []);

  // Après création d'un plan, rafraîchir et sélectionner
  const onPlanCreated = useCallback(async (newPlan) => {
    await loadPlans();
    if (newPlan) {
      setSelectedPlan(newPlan.plan || newPlan);
    }
  }, [loadPlans]);

  // Exécution du plan
  const onExecute = useCallback(async () => {
    if (!selectedPlan) return;
    const planId = selectedPlan.id || selectedPlan.plan_id;
    if (!planId) return;
    setExecuting(true);
    setExecError(null);
    try {
      const r = await fetch(`${PLANNER_API}/plan/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_id: planId }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${r.status}`);
      }
      const data = await r.json();
      const updated = data.plan || data;
      if (updated.id || updated.plan_id) {
        setSelectedPlan(updated);
        setPlans(prev => prev.map(p =>
          (p.id || p.plan_id) === planId ? updated : p
        ));
      }
    } catch (e) {
      setExecError(e.message);
    } finally {
      setExecuting(false);
    }
  }, [selectedPlan]);

  // Re-planification
  const onReplan = useCallback(async () => {
    if (!selectedPlan) return;
    const planId = selectedPlan.id || selectedPlan.plan_id;
    if (!planId) return;
    setReplanning(true);
    setExecError(null);
    try {
      const r = await fetch(`${PLANNER_API}/plan/replan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_id: planId }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${r.status}`);
      }
      const data = await r.json();
      const updated = data.plan || data;
      if (updated.id || updated.plan_id) {
        setSelectedPlan(updated);
        setPlans(prev => prev.map(p =>
          (p.id || p.plan_id) === planId ? updated : p
        ));
      }
    } catch (e) {
      setExecError(e.message);
    } finally {
      setReplanning(false);
    }
  }, [selectedPlan]);

  const tabs = [
    { id: "plans", label: `Plans (${plans.length})` },
    { id: "tree",  label: "Arbre de tâches" },
    { id: "history", label: "Historique" },
  ];

  return (
    <div style={{ padding: 24, maxWidth: 960, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: S.text, margin: 0 }}>
          PLANNER
        </h1>
        <p style={{ fontSize: 13, color: S.text3, margin: "6px 0 0", fontFamily: S.mono }}>
          // décomposition hiérarchique HTN
        </p>
      </div>

      {/* Erreur d'exécution */}
      {execError && (
        <div style={{
          marginBottom: 14, padding: "8px 14px", borderRadius: 8,
          background: `${S.red}15`, border: `1px solid ${S.red}44`,
          color: S.red, fontSize: 12,
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span>⚠ {execError}</span>
          <button
            onClick={() => setExecError(null)}
            style={{ background: "transparent", border: "none", color: S.red, cursor: "pointer", fontSize: 14 }}
          >×</button>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, borderBottom: `1px solid ${S.border}`, marginBottom: 20 }}>
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              background: "transparent", border: "none", cursor: "pointer",
              padding: "9px 18px", fontSize: 13,
              fontWeight: activeTab === t.id ? 700 : 400,
              color: activeTab === t.id ? S.primary : S.text2,
              borderBottom: `2px solid ${activeTab === t.id ? S.primary : "transparent"}`,
              marginBottom: -1,
              transition: "color 0.15s",
            }}
          >{t.label}</button>
        ))}
      </div>

      {/* Contenu par onglet */}
      {activeTab === "plans" && (
        <TabPlans
          plans={plans}
          loading={loading}
          onSelectPlan={onSelectPlan}
          selectedPlan={selectedPlan}
          onRefresh={loadPlans}
          onPlanCreated={onPlanCreated}
        />
      )}

      {activeTab === "tree" && (
        <TabTree
          selectedPlan={selectedPlan}
          onExecute={onExecute}
          onReplan={onReplan}
          executing={executing}
          replanning={replanning}
        />
      )}

      {activeTab === "history" && (
        <TabHistory
          plans={plans}
          loading={loading}
          onRefresh={loadPlans}
        />
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
