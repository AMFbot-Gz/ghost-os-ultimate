/**
 * PipelinePage.jsx — Skill Pipeline Composer (Phase 14)
 * Créer, exécuter et suivre des pipelines de steps chaînés
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import { useToast } from "../Toast.jsx";

const PIPE_API = "http://localhost:8011";

const TYPE_META = {
  shell:   { label: "Shell",   color: "#a6e3a1", icon: "⚡" },
  mission: { label: "Mission", color: "#89b4fa", icon: "🧠" },
  react:   { label: "ReAct",   color: "var(--primary, #E07B54)", icon: "🔄" },
};

const STATUS_META = {
  pending:   { color: "#94a3b8", label: "En attente" },
  running:   { color: "#89b4fa", label: "En cours"   },
  completed: { color: "#a6e3a1", label: "Terminé"    },
  failed:    { color: "#f38ba8", label: "Échoué"     },
  timeout:   { color: "#f9e2af", label: "Timeout"    },
  error:     { color: "#f38ba8", label: "Erreur"     },
};

// ─── Small components ─────────────────────────────────────────────────────────

function StatusBadge({ status, small }) {
  const m = STATUS_META[status] || STATUS_META.pending;
  return (
    <span style={{
      fontSize: small ? 9 : 10, fontWeight: 700, padding: small ? "1px 5px" : "2px 8px",
      borderRadius: 20, background: m.color + "22", color: m.color,
      letterSpacing: "0.04em",
    }}>{m.label.toUpperCase()}</span>
  );
}

function TypeBadge({ type }) {
  const m = TYPE_META[type] || TYPE_META.shell;
  return (
    <span style={{ fontSize: 10, color: m.color, fontWeight: 600 }}>{m.icon} {m.label}</span>
  );
}

function RunProgress({ run }) {
  const total   = run.total_steps || 0;
  const current = run.current_step || 0;
  const pct = total ? (current / total) * 100 : 0;
  const color = run.status === "completed" ? "#a6e3a1"
    : run.status === "failed" ? "#f38ba8" : "#89b4fa";
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
        <StatusBadge status={run.status} />
        <span style={{ fontSize: 10, color: "var(--text-3)" }}>{current}/{total} steps</span>
      </div>
      <div style={{ height: 4, background: "var(--surface-3, #222)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{
          width: `${pct}%`, height: "100%", background: color, borderRadius: 2,
          transition: "width 0.5s ease",
        }} />
      </div>
    </div>
  );
}

// ─── Step Editor ──────────────────────────────────────────────────────────────

function StepEditor({ step, index, onChange, onDelete, canDelete }) {
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 8, padding: "14px 16px", position: "relative",
    }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <span style={{
          width: 22, height: 22, borderRadius: "50%",
          background: "var(--primary, #E07B54)", color: "white",
          fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}>{index + 1}</span>
        <input
          value={step.name}
          onChange={e => onChange({ ...step, name: e.target.value })}
          placeholder="Nom du step"
          style={{
            flex: 1, background: "var(--surface-2)", border: "1px solid var(--border)",
            borderRadius: 6, padding: "5px 10px", color: "var(--text)", fontSize: 12,
          }}
        />
        <select
          value={step.type}
          onChange={e => onChange({ ...step, type: e.target.value })}
          style={{
            background: "var(--surface-2)", border: "1px solid var(--border)",
            borderRadius: 6, padding: "5px 8px", color: "var(--text)", fontSize: 11,
          }}
        >
          <option value="shell">⚡ Shell</option>
          <option value="mission">🧠 Mission</option>
          <option value="react">🔄 ReAct</option>
        </select>
        {canDelete && (
          <button
            onClick={onDelete}
            style={{ background: "none", border: "none", color: "#f38ba8", cursor: "pointer", fontSize: 16, padding: "0 4px" }}
          >✕</button>
        )}
      </div>

      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 10, color: "var(--text-3)", marginBottom: 4 }}>
          Commande {step.type === "shell" ? "(shell)" : "(prompt)"}
          <span style={{ color: "var(--text-3)", marginLeft: 6 }}>· {'{{variable}}'} et {'{{steps.ID.output}}'} supportés</span>
        </div>
        <textarea
          value={step.command}
          onChange={e => onChange({ ...step, command: e.target.value })}
          placeholder={step.type === "shell" ? "echo hello" : "Résume ce contenu: {{steps.prev.output}}"}
          rows={3}
          style={{
            width: "100%", background: "var(--surface-2)", border: "1px solid var(--border)",
            borderRadius: 6, padding: "8px 10px", color: "var(--text)", fontSize: 12,
            fontFamily: step.type === "shell" ? "monospace" : "inherit",
            resize: "vertical", boxSizing: "border-box",
          }}
        />
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <label style={{ fontSize: 10, color: "var(--text-3)" }}>Timeout (s)</label>
        <input
          type="number" value={step.timeout || 60}
          onChange={e => onChange({ ...step, timeout: +e.target.value })}
          min={5} max={300} step={5}
          style={{
            width: 60, background: "var(--surface-2)", border: "1px solid var(--border)",
            borderRadius: 6, padding: "4px 8px", color: "var(--text)", fontSize: 11,
          }}
        />
        <span style={{ fontSize: 10, color: "var(--text-3)" }}>ID: <code style={{ fontFamily: "monospace" }}>{step.id}</code></span>
      </div>
    </div>
  );
}

// ─── Variables Editor ─────────────────────────────────────────────────────────

function VariablesEditor({ vars, onChange }) {
  const [newKey, setNewKey] = useState("");
  const [newVal, setNewVal] = useState("");
  const entries = Object.entries(vars || {});

  const add = () => {
    if (!newKey.trim()) return;
    onChange({ ...vars, [newKey.trim()]: newVal });
    setNewKey(""); setNewVal("");
  };

  const remove = (key) => {
    const updated = { ...vars };
    delete updated[key];
    onChange(updated);
  };

  return (
    <div>
      {entries.map(([k, v]) => (
        <div key={k} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
          <code style={{ fontSize: 11, color: "var(--primary, #E07B54)", width: 100, flexShrink: 0, fontFamily: "monospace" }}>{`{{${k}}}`}</code>
          <input
            value={v}
            onChange={e => onChange({ ...vars, [k]: e.target.value })}
            style={{
              flex: 1, background: "var(--surface-2)", border: "1px solid var(--border)",
              borderRadius: 6, padding: "4px 8px", color: "var(--text)", fontSize: 12,
            }}
          />
          <button onClick={() => remove(k)} style={{ background: "none", border: "none", color: "#f38ba8", cursor: "pointer", fontSize: 14 }}>✕</button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <input
          value={newKey} onChange={e => setNewKey(e.target.value)}
          placeholder="nom" onKeyDown={e => e.key === "Enter" && add()}
          style={{
            width: 100, background: "var(--surface-2)", border: "1px solid var(--border)",
            borderRadius: 6, padding: "4px 8px", color: "var(--text)", fontSize: 12, fontFamily: "monospace",
          }}
        />
        <input
          value={newVal} onChange={e => setNewVal(e.target.value)}
          placeholder="valeur par défaut" onKeyDown={e => e.key === "Enter" && add()}
          style={{
            flex: 1, background: "var(--surface-2)", border: "1px solid var(--border)",
            borderRadius: 6, padding: "4px 8px", color: "var(--text)", fontSize: 12,
          }}
        />
        <button
          onClick={add}
          style={{
            background: "var(--surface-2)", border: "1px solid var(--border)",
            borderRadius: 6, padding: "4px 12px", color: "var(--text-2)", fontSize: 12, cursor: "pointer",
          }}
        >+ Ajouter</button>
      </div>
    </div>
  );
}

// ─── Composer Tab ─────────────────────────────────────────────────────────────

function mkStep() {
  return { id: `s${Date.now().toString(36)}`, name: "", type: "shell", command: "", timeout: 60 };
}

function ComposerTab({ onCreated }) {
  const [name, setName]         = useState("");
  const [desc, setDesc]         = useState("");
  const [steps, setSteps]       = useState([mkStep()]);
  const [variables, setVariables] = useState({});
  const [saving, setSaving]     = useState(false);
  const { toast } = useToast() || {};

  const addStep = () => setSteps(prev => [...prev, mkStep()]);
  const updateStep = (i, s) => setSteps(prev => prev.map((x, j) => j === i ? s : x));
  const deleteStep = (i) => setSteps(prev => prev.filter((_, j) => j !== i));

  const fromTemplate = (tpl) => {
    setName(tpl.name);
    setDesc(tpl.description);
    setSteps(tpl.steps.map(s => ({ ...s })));
    setVariables({ ...tpl.variables });
  };

  const save = async () => {
    if (!name.trim() || steps.length === 0) return;
    setSaving(true);
    try {
      const r = await fetch(`${PIPE_API}/pipelines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: desc, steps, variables }),
      });
      if (r.ok) {
        toast?.("Pipeline créé ✅", "success");
        setName(""); setDesc(""); setSteps([mkStep()]); setVariables({});
        onCreated?.();
      } else { toast?.("Erreur création", "error"); }
    } catch { toast?.("Serveur inaccessible", "error"); }
    setSaving(false);
  };

  const [templates, setTemplates] = useState([]);
  useEffect(() => {
    fetch(`${PIPE_API}/pipelines/templates`).then(r => r.json())
      .then(d => setTemplates(d.templates || []))
      .catch(() => {});
  }, []);

  return (
    <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
      {/* Left: builder */}
      <div style={{ flex: "2 1 400px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: 10, padding: "16px 18px",
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)", marginBottom: 12 }}>Informations</div>
          <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
            <input
              value={name} onChange={e => setName(e.target.value)}
              placeholder="Nom du pipeline *"
              style={{
                flex: 1, background: "var(--surface-2)", border: "1px solid var(--border)",
                borderRadius: 7, padding: "8px 12px", color: "var(--text)", fontSize: 13,
              }}
            />
          </div>
          <input
            value={desc} onChange={e => setDesc(e.target.value)}
            placeholder="Description (optionnel)"
            style={{
              width: "100%", background: "var(--surface-2)", border: "1px solid var(--border)",
              borderRadius: 7, padding: "8px 12px", color: "var(--text)", fontSize: 12,
              boxSizing: "border-box",
            }}
          />
        </div>

        {/* Steps */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)", display: "flex", justifyContent: "space-between" }}>
            <span>Steps ({steps.length})</span>
            <button
              onClick={addStep}
              style={{
                background: "var(--primary, #E07B54)", color: "white", border: "none",
                borderRadius: 6, padding: "3px 12px", fontSize: 11, fontWeight: 600, cursor: "pointer",
              }}
            >+ Ajouter</button>
          </div>
          {steps.map((step, i) => (
            <StepEditor
              key={step.id} step={step} index={i}
              onChange={s => updateStep(i, s)}
              onDelete={() => deleteStep(i)}
              canDelete={steps.length > 1}
            />
          ))}
        </div>

        {/* Variables */}
        <div style={{
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: 10, padding: "16px 18px",
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)", marginBottom: 10 }}>
            Variables par défaut
          </div>
          <VariablesEditor vars={variables} onChange={setVariables} />
        </div>

        <button
          onClick={save}
          disabled={saving || !name.trim()}
          style={{
            background: "var(--primary, #E07B54)", color: "white", border: "none",
            borderRadius: 8, padding: "11px 0", fontSize: 13, fontWeight: 700,
            cursor: saving || !name.trim() ? "not-allowed" : "pointer",
            opacity: saving || !name.trim() ? 0.6 : 1,
          }}
        >{saving ? "⏳ Sauvegarde…" : "💾 Sauvegarder le pipeline"}</button>
      </div>

      {/* Right: templates */}
      <div style={{ flex: "1 1 200px", minWidth: 200 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)", marginBottom: 10 }}>Modèles</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {templates.map(tpl => (
            <button
              key={tpl.id}
              onClick={() => fromTemplate(tpl)}
              style={{
                background: "var(--surface)", border: "1px solid var(--border)",
                borderRadius: 8, padding: "12px 14px", textAlign: "left",
                cursor: "pointer", width: "100%",
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = "var(--primary, #E07B54)"}
              onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border)"}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>{tpl.name}</div>
              <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 6 }}>{tpl.description}</div>
              <div style={{ fontSize: 10, color: "var(--text-3)" }}>{tpl.steps.length} steps</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Pipelines List Tab ───────────────────────────────────────────────────────

function PipelinesTab({ pipelines, onDelete, onRun, running }) {
  const [expanded, setExpanded] = useState(null);
  const [runVars, setRunVars]   = useState({});

  if (!pipelines.length) {
    return (
      <div style={{ textAlign: "center", padding: 60, color: "var(--text-3)" }}>
        <div style={{ fontSize: 36, marginBottom: 10 }}>🔧</div>
        <div style={{ fontSize: 14 }}>Aucun pipeline. Créez-en un via l'onglet Composer.</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {pipelines.map(p => {
        const steps = JSON.parse(p.steps_json || "[]");
        const vars  = JSON.parse(p.variables_json || "{}");
        const isExp = expanded === p.id;
        return (
          <div key={p.id} style={{
            background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden",
          }}>
            <div
              style={{ padding: "14px 18px", cursor: "pointer", display: "flex", gap: 14, alignItems: "center" }}
              onClick={() => setExpanded(isExp ? null : p.id)}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>{p.name}</div>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, color: "var(--text-3)" }}>{steps.length} steps</span>
                  {steps.map(s => <TypeBadge key={s.id} type={s.type} />)}
                  {p.run_count > 0 && <span style={{ fontSize: 11, color: "var(--text-3)" }}>{p.run_count} runs</span>}
                </div>
              </div>
              <span style={{ color: "var(--text-3)", fontSize: 12 }}>{isExp ? "▲" : "▼"}</span>
            </div>

            {isExp && (
              <div style={{ borderTop: "1px solid var(--border)", padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
                {p.description && <p style={{ margin: 0, fontSize: 12, color: "var(--text-3)" }}>{p.description}</p>}

                {/* Step list */}
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {steps.map((s, i) => (
                    <div key={s.id} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <span style={{ fontSize: 11, color: "var(--text-3)", width: 16, flexShrink: 0, marginTop: 1 }}>{i + 1}.</span>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{s.name || s.id}</div>
                        <TypeBadge type={s.type} />
                        <code style={{ fontSize: 10, color: "var(--text-3)", display: "block", marginTop: 2, maxWidth: 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.command?.slice(0, 80)}</code>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Run-time variable overrides */}
                {Object.keys(vars).length > 0 && (
                  <div>
                    <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 6 }}>Variables pour ce run</div>
                    {Object.entries(vars).map(([k, defVal]) => (
                      <div key={k} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
                        <code style={{ fontSize: 11, color: "var(--primary, #E07B54)", width: 100, flexShrink: 0 }}>{`{{${k}}}`}</code>
                        <input
                          defaultValue={defVal}
                          onChange={e => setRunVars(prev => ({ ...prev, [p.id]: { ...(prev[p.id] || {}), [k]: e.target.value } }))}
                          style={{
                            flex: 1, background: "var(--surface-2)", border: "1px solid var(--border)",
                            borderRadius: 6, padding: "4px 8px", color: "var(--text)", fontSize: 12,
                          }}
                        />
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display: "flex", gap: 10 }}>
                  <button
                    onClick={() => onRun(p.id, runVars[p.id] || {})}
                    disabled={running === p.id}
                    style={{
                      background: "#a6e3a1", color: "#0d1117", border: "none",
                      borderRadius: 7, padding: "8px 18px", fontSize: 12, fontWeight: 700,
                      cursor: running === p.id ? "not-allowed" : "pointer",
                      opacity: running === p.id ? 0.6 : 1,
                    }}
                  >{running === p.id ? "⏳ Lancement…" : "▶ Exécuter"}</button>
                  <button
                    onClick={() => onDelete(p.id)}
                    style={{
                      background: "rgba(243,139,168,0.1)", border: "1px solid rgba(243,139,168,0.3)",
                      borderRadius: 7, padding: "8px 14px", color: "#f38ba8",
                      fontSize: 12, fontWeight: 600, cursor: "pointer", marginLeft: "auto",
                    }}
                  >🗑 Supprimer</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Runs Tab ─────────────────────────────────────────────────────────────────

function RunsTab({ runs, onRefresh, activeRunId }) {
  const [expandedRun, setExpandedRun] = useState(activeRunId || null);
  const [runDetail, setRunDetail]     = useState(null);
  const pollRef = useRef(null);

  const loadDetail = useCallback(async (run_id) => {
    try {
      const r = await fetch(`${PIPE_API}/runs/${run_id}`);
      if (r.ok) setRunDetail(await r.json());
    } catch {}
  }, []);

  useEffect(() => {
    if (expandedRun) {
      loadDetail(expandedRun);
      const run = runs.find(r => r.id === expandedRun);
      if (run && run.status === "running") {
        pollRef.current = setInterval(() => loadDetail(expandedRun), 1500);
      }
    }
    return () => { clearInterval(pollRef.current); };
  }, [expandedRun, loadDetail]);

  useEffect(() => {
    if (activeRunId) { setExpandedRun(activeRunId); }
  }, [activeRunId]);

  if (!runs.length) {
    return (
      <div style={{ textAlign: "center", padding: 60, color: "var(--text-3)" }}>
        <div style={{ fontSize: 36, marginBottom: 10 }}>🚀</div>
        <div style={{ fontSize: 14 }}>Aucun run. Exécutez un pipeline depuis l'onglet Pipelines.</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {runs.map(run => {
        const isExp = expandedRun === run.id;
        const steps = (isExp && runDetail?.step_results) || [];
        const startedAt = run.started_at ? new Date(run.started_at).toLocaleTimeString("fr-FR") : "—";
        const duration = run.completed_at && run.started_at
          ? `${((new Date(run.completed_at) - new Date(run.started_at)) / 1000).toFixed(1)}s`
          : null;

        return (
          <div key={run.id} style={{
            background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden",
          }}>
            <div
              style={{ padding: "12px 16px", cursor: "pointer", display: "flex", gap: 12, alignItems: "center" }}
              onClick={() => setExpandedRun(isExp ? null : run.id)}
            >
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 5 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{run.pipeline_name || run.pipeline_id?.slice(0, 8)}</span>
                  <StatusBadge status={run.status} />
                  {duration && <span style={{ fontSize: 10, color: "var(--text-3)" }}>⏱ {duration}</span>}
                  <span style={{ fontSize: 10, color: "var(--text-3)", marginLeft: "auto" }}>{startedAt}</span>
                </div>
                <RunProgress run={run} />
              </div>
              <span style={{ color: "var(--text-3)", fontSize: 12, flexShrink: 0 }}>{isExp ? "▲" : "▼"}</span>
            </div>

            {isExp && (
              <div style={{ borderTop: "1px solid var(--border)", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
                {steps.map((step, i) => {
                  const sm = STATUS_META[step.status] || STATUS_META.pending;
                  return (
                    <div key={step.step_id || i} style={{
                      background: "var(--surface-2)", borderRadius: 7, padding: "10px 14px",
                      borderLeft: `3px solid ${sm.color}`,
                    }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: step.output ? 6 : 0 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", flex: 1 }}>
                          {i + 1}. {step.name || step.step_id}
                        </span>
                        <StatusBadge status={step.status} small />
                        {step.duration_ms && (
                          <span style={{ fontSize: 10, color: "var(--text-3)" }}>{(step.duration_ms / 1000).toFixed(1)}s</span>
                        )}
                      </div>
                      {step.output && (
                        <pre style={{
                          margin: 0, fontSize: 11, color: "var(--text-2)",
                          background: "var(--surface-3, #1a1a1a)", borderRadius: 5,
                          padding: "8px 10px", overflow: "auto", maxHeight: 150,
                          fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-all",
                        }}>{step.output.slice(0, 1000)}{step.output.length > 1000 ? "…" : ""}</pre>
                      )}
                      {step.error && (
                        <div style={{ fontSize: 11, color: "#f38ba8", marginTop: 4 }}>⚠ {step.error}</div>
                      )}
                    </div>
                  );
                })}

                {/* Final output */}
                {runDetail?.output && run.status === "completed" && (
                  <div style={{
                    background: "rgba(166,227,161,0.06)", border: "1px solid rgba(166,227,161,0.2)",
                    borderRadius: 7, padding: "12px 14px",
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#a6e3a1", marginBottom: 6 }}>✅ Résultat final</div>
                    <pre style={{ margin: 0, fontSize: 12, color: "var(--text-2)", whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "inherit" }}>
                      {runDetail.output}
                    </pre>
                  </div>
                )}

                {runDetail?.error && (
                  <div style={{
                    background: "rgba(243,139,168,0.06)", border: "1px solid rgba(243,139,168,0.2)",
                    borderRadius: 7, padding: "10px 14px", fontSize: 12, color: "#f38ba8",
                  }}>⚠ {runDetail.error}</div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Stats Bar ────────────────────────────────────────────────────────────────

function StatsBar({ stats }) {
  if (!stats) return null;
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
      {[
        { label: "Pipelines", value: stats.pipelines,     color: "var(--primary, #E07B54)" },
        { label: "Runs total", value: stats.runs_total,   color: "var(--text)" },
        { label: "Succès",     value: stats.runs_completed, color: "#a6e3a1" },
        { label: "Taux succès", value: `${stats.success_rate}%`, color: stats.success_rate > 80 ? "#a6e3a1" : "#f9e2af" },
        { label: "En cours",   value: stats.runs_running,  color: "#89b4fa" },
      ].map(item => (
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

const TABS = [
  { id: "composer",  label: "Composer" },
  { id: "pipelines", label: "Pipelines" },
  { id: "runs",      label: "Runs" },
];

export default function PipelinePage() {
  const [tab, setTab]           = useState("composer");
  const [pipelines, setPipelines] = useState([]);
  const [runs, setRuns]         = useState([]);
  const [stats, setStats]       = useState(null);
  const [running, setRunning]   = useState(null);
  const [activeRunId, setActiveRunId] = useState(null);
  const { toast } = useToast() || {};

  const load = useCallback(async () => {
    try {
      const [pRes, rRes, sRes] = await Promise.all([
        fetch(`${PIPE_API}/pipelines`).then(r => r.json()),
        fetch(`${PIPE_API}/runs`).then(r => r.json()),
        fetch(`${PIPE_API}/stats`).then(r => r.json()),
      ]);
      setPipelines(pRes.pipelines || []);
      setRuns(rRes.runs || []);
      setStats(sRes);
    } catch {}
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  const handleRun = async (pipelineId, vars) => {
    setRunning(pipelineId);
    try {
      const r = await fetch(`${PIPE_API}/pipelines/${pipelineId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variables: vars }),
      });
      if (r.ok) {
        const d = await r.json();
        toast?.("Pipeline lancé ▶", "info");
        setActiveRunId(d.run_id);
        setTab("runs");
        load();
      } else { toast?.("Erreur lancement", "error"); }
    } catch { toast?.("Serveur inaccessible", "error"); }
    setRunning(null);
  };

  const handleDelete = async (id) => {
    if (!confirm("Supprimer ce pipeline ?")) return;
    await fetch(`${PIPE_API}/pipelines/${id}`, { method: "DELETE" });
    toast?.("Pipeline supprimé", "warn");
    load();
  };

  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", margin: "0 0 4px" }}>
          🔧 Pipeline Composer
        </h2>
        <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0 }}>
          Chaîne shell + mission + ReAct · Variables · Substitution de contexte · Exécution pas-à-pas
        </p>
      </div>

      <StatsBar stats={stats} />

      {/* Tabs */}
      <div style={{
        display: "flex", gap: 4, background: "var(--surface)",
        borderRadius: 8, padding: 4, border: "1px solid var(--border)",
        marginBottom: 24, width: "fit-content",
      }}>
        {TABS.map(t => (
          <button
            key={t.id} onClick={() => setTab(t.id)}
            style={{
              padding: "7px 18px", borderRadius: 6, border: "none",
              background: tab === t.id ? "var(--primary, #E07B54)" : "transparent",
              color: tab === t.id ? "white" : "var(--text-2)",
              fontSize: 13, fontWeight: tab === t.id ? 600 : 400,
              cursor: "pointer", transition: "all 0.12s",
              position: "relative",
            }}
          >
            {t.label}
            {t.id === "runs" && stats?.runs_running > 0 && (
              <span style={{
                position: "absolute", top: -4, right: -4,
                background: "#89b4fa", color: "white",
                borderRadius: 10, padding: "0 5px", fontSize: 9, fontWeight: 700, lineHeight: "16px",
              }}>{stats.runs_running}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "composer"  && <ComposerTab onCreated={() => { load(); setTab("pipelines"); }} />}
      {tab === "pipelines" && <PipelinesTab pipelines={pipelines} onDelete={handleDelete} onRun={handleRun} running={running} />}
      {tab === "runs"      && <RunsTab runs={runs} onRefresh={load} activeRunId={activeRunId} />}
    </div>
  );
}
