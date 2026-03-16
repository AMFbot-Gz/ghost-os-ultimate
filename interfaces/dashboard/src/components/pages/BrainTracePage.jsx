/**
 * BrainTracePage.jsx — Live trace des boucles ReAct et Tree of Thoughts
 * Consomme les SSE endpoints GET /brain/react/stream et /brain/tot/stream
 * Design system : warm dark terracotta (cohérent avec le reste du dashboard)
 */
import React, { useState, useRef, useEffect, useCallback } from "react";

const BRAIN_URL = "/brain"; // proxy vite → http://localhost:8003

// ─── Couleurs sémantiques ────────────────────────────────────────────────────
const C = {
  ok:      "var(--green)",
  error:   "var(--red)",
  warn:    "var(--yellow)",
  info:    "var(--blue)",
  primary: "var(--primary)",
  dim:     "var(--text-3)",
  text2:   "var(--text-2)",
  surface2:"var(--surface-2)",
  surface3:"var(--surface-3)",
  border:  "var(--border)",
  border2: "var(--border-2)",
};

// ─── Score bar colorée ───────────────────────────────────────────────────────
function ScoreBar({ value, label }) {
  const pct = Math.round((value || 0) * 100);
  const color = pct >= 80 ? C.ok : pct >= 55 ? C.warn : C.error;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
      <span style={{ color: C.dim, width: 68 }}>{label}</span>
      <div style={{ flex: 1, height: 4, background: "var(--surface-4)", borderRadius: 2 }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2, transition: "width 0.4s" }} />
      </div>
      <span style={{ color, fontWeight: 600, width: 32, textAlign: "right" }}>{pct}%</span>
    </div>
  );
}

// ─── Badge verdict Critic ────────────────────────────────────────────────────
function Verdict({ v }) {
  const map = { ok: [C.ok, "✓ ok"], retry: [C.warn, "↺ retry"], abort: [C.error, "✗ abort"] };
  const [color, label] = map[v] || [C.dim, v];
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
      background: `${color}22`, color, border: `1px solid ${color}44`,
    }}>{label}</span>
  );
}

// ─── Tag action ReAct ────────────────────────────────────────────────────────
function ActionTag({ action }) {
  const map = {
    shell:        [C.primary, "⬡ shell"],
    vision:       [C.info,    "👁 vision"],
    memory_search:[C.warn,    "🔍 memory"],
    done:         [C.ok,      "✓ done"],
    error:        [C.error,   "✗ error"],
  };
  const [color, label] = map[action] || [C.dim, action];
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4,
      background: `${color}22`, color, border: `1px solid ${color}44`,
      letterSpacing: "0.03em",
    }}>{label}</span>
  );
}

// ─── Spinner ──────────────────────────────────────────────────────────────────
function Spinner({ size = 14, color = "var(--primary)" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.5}
      style={{ animation: "spin 0.8s linear infinite", flexShrink: 0 }}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

// ─── Card container ──────────────────────────────────────────────────────────
function Card({ children, style }) {
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 10, padding: "14px 16px", ...style,
    }}>{children}</div>
  );
}

// ─── Section title ───────────────────────────────────────────────────────────
function SectionTitle({ children, color = C.dim }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.07em",
      textTransform: "uppercase", color, marginBottom: 10 }}>
      {children}
    </div>
  );
}

// ─── Mono code block ────────────────────────────────────────────────────────
function Code({ children, maxH }) {
  return (
    <pre style={{
      fontFamily: "monospace", fontSize: 11, color: "var(--text-2)",
      background: "var(--surface-2)", padding: "8px 10px", borderRadius: 6,
      overflowY: "auto", maxHeight: maxH || 200, whiteSpace: "pre-wrap", wordBreak: "break-word",
      lineHeight: 1.55, margin: 0, border: "1px solid var(--border)",
    }}>{children}</pre>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// REACT TRACE
// ══════════════════════════════════════════════════════════════════════════════

function StepCard({ step }) {
  const [open, setOpen] = useState(true);
  const isDone = step.action === "done";

  return (
    <div style={{
      border: `1px solid ${isDone ? C.ok + "55" : "var(--border)"}`,
      borderRadius: 8, marginBottom: 8, overflow: "hidden",
      background: isDone ? `${C.ok}08` : "var(--surface)",
      animation: "slideUp 0.2s ease both",
    }}>
      {/* Header */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 8,
          padding: "9px 12px", background: "transparent", border: "none",
          cursor: "pointer", textAlign: "left",
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, color: C.dim, width: 24 }}>
          #{step.step}
        </span>
        <ActionTag action={step.action} />
        <span style={{
          flex: 1, fontSize: 12, color: "var(--text-2)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {step.thought || step.action_input || "…"}
        </span>
        {step.duration_ms && (
          <span style={{ fontSize: 10, color: C.dim, flexShrink: 0 }}>
            {step.duration_ms}ms
          </span>
        )}
        {step.critic && <Verdict v={step.critic.verdict} />}
        <span style={{ color: C.dim, fontSize: 10 }}>{open ? "▾" : "▸"}</span>
      </button>

      {/* Body */}
      {open && (
        <div style={{ padding: "0 12px 12px", borderTop: "1px solid var(--border)" }}>
          {step.thought && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, color: C.dim, marginBottom: 4 }}>Thought</div>
              <div style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.5 }}>{step.thought}</div>
            </div>
          )}
          {step.action_input && step.action !== "done" && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, color: C.dim, marginBottom: 4 }}>Action Input</div>
              <Code maxH={80}>{step.action_input}</Code>
            </div>
          )}
          {step.observation && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, color: step.success ? C.ok : C.error, marginBottom: 4 }}>
                {step.success ? "✓ Observation" : "✗ Observation"}
              </div>
              <Code maxH={120}>{step.observation}</Code>
            </div>
          )}
          {step.critic && (
            <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
              <Verdict v={step.critic.verdict} />
              <span style={{ fontSize: 11, color: C.text2 }}>{step.critic.reason}</span>
            </div>
          )}
          {step.rollback && (
            <div style={{ marginTop: 8, padding: "6px 10px", borderRadius: 6,
              background: `${C.warn}15`, border: `1px solid ${C.warn}44` }}>
              <div style={{ fontSize: 11, color: C.warn, fontWeight: 600, marginBottom: 2 }}>
                ↺ Rollback {step.rollback.ok ? "✓" : "✗"}
              </div>
              <Code maxH={60}>{step.rollback.action}</Code>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ReactTrace() {
  const [mission, setMission]       = useState("");
  const [maxSteps, setMaxSteps]     = useState(10);
  const [running, setRunning]       = useState(false);
  const [events, setEvents]         = useState([]);
  const [steps, setSteps]           = useState([]);
  const [finalAnswer, setFinalAnswer] = useState(null);
  const [stats, setStats]           = useState(null);
  const [currentStep, setCurrentStep] = useState(null);
  const esRef   = useRef(null);
  const bottomRef = useRef(null);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [steps, events]);

  const stop = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
    setRunning(false);
  }, []);

  const start = useCallback(() => {
    if (!mission.trim() || running) return;
    setRunning(true);
    setEvents([]);
    setSteps([]);
    setFinalAnswer(null);
    setStats(null);
    setCurrentStep(null);

    const params = new URLSearchParams({ mission, max_steps: maxSteps, timeout_per_step: 60 });
    const es = new EventSource(`${BRAIN_URL}/react/stream?${params}`);
    esRef.current = es;

    // Build steps incrementally from events
    const stepMap = {};

    es.onmessage = (e) => {
      let ev;
      try { ev = JSON.parse(e.data); } catch { return; }

      setEvents(prev => [...prev.slice(-500), ev]);

      if (ev.type === "thought") {
        setCurrentStep(ev.step);
        stepMap[ev.step] = { step: ev.step, thought: ev.thought, action: ev.action, action_input: ev.action_input };
        setSteps(Object.values(stepMap).sort((a, b) => a.step - b.step));
      }
      if (ev.type === "observation") {
        if (stepMap[ev.step]) {
          stepMap[ev.step] = { ...stepMap[ev.step], observation: ev.observation,
            success: ev.success, duration_ms: ev.duration_ms };
          setSteps(Object.values(stepMap).sort((a, b) => a.step - b.step));
        }
      }
      if (ev.type === "critic") {
        if (stepMap[ev.step]) {
          stepMap[ev.step] = { ...stepMap[ev.step], critic: { verdict: ev.verdict, reason: ev.reason } };
          setSteps(Object.values(stepMap).sort((a, b) => a.step - b.step));
        }
      }
      if (ev.type === "rollback") {
        if (stepMap[ev.step]) {
          stepMap[ev.step] = { ...stepMap[ev.step],
            rollback: { action: ev.rollback_action, ok: ev.ok, output: ev.output } };
          setSteps(Object.values(stepMap).sort((a, b) => a.step - b.step));
        }
      }
      if (ev.type === "done") {
        setFinalAnswer(ev.final_answer);
        setStats({ steps: ev.steps_taken, duration: ev.duration_ms,
          rollbacks: ev.rollbacks?.length || 0, provider: ev.provider, model: ev.model });
        stop();
      }
      if (ev.type === "error") {
        stop();
      }
    };
    es.onerror = () => stop();
  }, [mission, maxSteps, running, stop]);

  return (
    <div style={{ display: "flex", gap: 16, height: "100%", minHeight: 0 }}>
      {/* ── Left: form + steps ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, gap: 12 }}>
        {/* Form */}
        <Card>
          <SectionTitle>Mission ReAct</SectionTitle>
          <textarea
            value={mission}
            onChange={e => setMission(e.target.value)}
            placeholder="Décris la mission à accomplir…"
            rows={3}
            style={{
              width: "100%", resize: "vertical", background: "var(--surface-2)",
              border: "1px solid var(--border-2)", borderRadius: 8, padding: "10px 12px",
              color: "var(--text)", fontSize: 13, fontFamily: "inherit", lineHeight: 1.5,
              outline: "none",
            }}
            onKeyDown={e => e.key === "Enter" && e.metaKey && start()}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
            <label style={{ fontSize: 12, color: C.dim }}>Max steps</label>
            <input type="number" min={1} max={25} value={maxSteps}
              onChange={e => setMaxSteps(Number(e.target.value))}
              style={{
                width: 56, background: "var(--surface-2)", border: "1px solid var(--border-2)",
                borderRadius: 6, padding: "4px 8px", color: "var(--text)", fontSize: 12,
              }} />
            <div style={{ flex: 1 }} />
            {running && (
              <button onClick={stop} style={{
                padding: "7px 14px", borderRadius: 7, border: "1px solid var(--border-2)",
                background: "var(--surface-3)", color: C.error, fontSize: 12, cursor: "pointer",
              }}>■ Stop</button>
            )}
            <button onClick={start} disabled={running || !mission.trim()} style={{
              padding: "7px 18px", borderRadius: 7, border: "none",
              background: running || !mission.trim() ? "var(--surface-3)" : "var(--primary)",
              color: running || !mission.trim() ? C.dim : "#fff",
              fontSize: 13, fontWeight: 600, cursor: running || !mission.trim() ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", gap: 6,
            }}>
              {running && <Spinner size={13} color="#fff" />}
              {running ? "En cours…" : "▶ Lancer"}
            </button>
          </div>
          {running && currentStep && (
            <div style={{ marginTop: 8, fontSize: 11, color: C.primary, display: "flex", alignItems: "center", gap: 6 }}>
              <Spinner size={11} />
              Étape {currentStep}/{maxSteps} en cours…
            </div>
          )}
        </Card>

        {/* Steps trace */}
        <div style={{ flex: 1, overflowY: "auto", paddingRight: 2 }}>
          {steps.length === 0 && !running && (
            <div style={{ textAlign: "center", color: C.dim, fontSize: 13, padding: "40px 0" }}>
              Lance une mission pour voir le trace ReAct en temps réel.
            </div>
          )}
          {steps.map(s => <StepCard key={s.step} step={s} />)}
          {running && steps.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px",
              color: C.dim, fontSize: 12 }}>
              <Spinner size={12} color={C.dim} />
              En attente de la prochaine étape…
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* ── Right: final answer + stats ── */}
      <div style={{ width: 300, display: "flex", flexDirection: "column", gap: 12, flexShrink: 0 }}>
        {stats && (
          <Card>
            <SectionTitle color={C.ok}>✓ Terminé</SectionTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {[
                ["Étapes",    stats.steps],
                ["Durée",     `${(stats.duration / 1000).toFixed(1)}s`],
                ["Rollbacks", stats.rollbacks],
                ["Provider",  stats.provider],
                ["Modèle",    stats.model],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span style={{ color: C.dim }}>{k}</span>
                  <span style={{ color: "var(--text-2)", fontWeight: 500 }}>{v}</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {finalAnswer && (
          <Card style={{ flex: 1 }}>
            <SectionTitle>Réponse finale</SectionTitle>
            <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
              {finalAnswer}
            </div>
          </Card>
        )}

        {/* Live event log */}
        <Card style={{ flex: finalAnswer ? 0 : 1 }}>
          <SectionTitle>Événements SSE</SectionTitle>
          <div style={{ maxHeight: 240, overflowY: "auto" }}>
            {events.length === 0 ? (
              <div style={{ fontSize: 11, color: C.dim }}>En attente…</div>
            ) : (
              events.slice(-30).map((ev, i) => (
                <div key={i} style={{ fontSize: 10, fontFamily: "monospace", color: C.text2,
                  padding: "1px 0", borderBottom: "1px solid var(--border)", lineHeight: 1.5 }}>
                  <span style={{ color: C.primary }}>{ev.type}</span>
                  {ev.step && <span style={{ color: C.dim }}> #{ev.step}</span>}
                  {ev.verdict && <> · <Verdict v={ev.verdict} /></>}
                  {ev.action && ev.type === "thought" && <span style={{ color: C.text2 }}> → {ev.action}</span>}
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TREE OF THOUGHTS TRACE
// ══════════════════════════════════════════════════════════════════════════════

function ScoreCircle({ score }) {
  const pct  = Math.round((score || 0) * 100);
  const r    = 14;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  const color = pct >= 80 ? C.ok : pct >= 55 ? C.warn : C.error;
  return (
    <svg width={36} height={36} viewBox="0 0 36 36" style={{ flexShrink: 0 }}>
      <circle cx="18" cy="18" r={r} fill="none" stroke="var(--surface-4)" strokeWidth={3} />
      <circle cx="18" cy="18" r={r} fill="none" stroke={color} strokeWidth={3}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        transform="rotate(-90 18 18)" style={{ transition: "stroke-dasharray 0.4s" }} />
      <text x="18" y="22" textAnchor="middle" fontSize="9" fill={color} fontWeight="bold">{pct}</text>
    </svg>
  );
}

function NodeCard({ node, isBeam, isSolution }) {
  const [open, setOpen] = useState(false);
  const thought = node.path?.[node.path.length - 1] || node.thought || "…";

  return (
    <div style={{
      border: `1px solid ${isSolution ? C.ok + "66" : isBeam ? C.primary + "44" : "var(--border)"}`,
      borderRadius: 8, marginBottom: 6, overflow: "hidden",
      background: isSolution ? `${C.ok}08` : isBeam ? `${C.primary}08` : "var(--surface)",
      animation: "slideUp 0.2s ease both",
    }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width: "100%", display: "flex", alignItems: "center", gap: 8,
        padding: "8px 10px", background: "transparent", border: "none",
        cursor: "pointer", textAlign: "left",
      }}>
        <ScoreCircle score={node.score} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: isSolution ? C.ok : isBeam ? C.primary : "var(--text-2)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: isSolution || isBeam ? 600 : 400 }}>
            {isSolution && "✓ SOLUTION · "}{thought}
          </div>
          {node.reason && (
            <div style={{ fontSize: 10, color: C.dim, marginTop: 2,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {node.reason}
            </div>
          )}
        </div>
        {isBeam && !isSolution && (
          <span style={{ fontSize: 9, color: C.primary, fontWeight: 700, padding: "2px 5px",
            background: `${C.primary}22`, borderRadius: 4, flexShrink: 0 }}>BEAM</span>
        )}
        <span style={{ color: C.dim, fontSize: 10 }}>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div style={{ padding: "0 10px 10px", borderTop: "1px solid var(--border)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
            <ScoreBar value={node.feasibility} label="Feasibility" />
            <ScoreBar value={node.relevance}   label="Relevance" />
            <ScoreBar value={node.safety}      label="Safety" />
          </div>
          {node.solution_summary && (
            <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 6,
              background: `${C.ok}10`, border: `1px solid ${C.ok}33`, fontSize: 12,
              color: "var(--text-2)", lineHeight: 1.5 }}>
              {node.solution_summary}
            </div>
          )}
          {node.path && node.path.length > 1 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 10, color: C.dim, marginBottom: 4 }}>Chemin complet</div>
              {node.path.map((t, i) => (
                <div key={i} style={{ display: "flex", gap: 6, marginBottom: 3 }}>
                  <span style={{ fontSize: 10, color: C.dim, flexShrink: 0, width: 14, textAlign: "right" }}>{i + 1}.</span>
                  <span style={{ fontSize: 11, color: C.text2, lineHeight: 1.45 }}>{t}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DepthSection({ depth, nodes, beamIds, solutionNodes }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div style={{ marginBottom: 14 }}>
      <button onClick={() => setCollapsed(c => !c)} style={{
        display: "flex", alignItems: "center", gap: 8, marginBottom: 8,
        background: "transparent", border: "none", cursor: "pointer", padding: 0,
      }}>
        <div style={{ height: 1, flex: 1, background: "var(--border)" }} />
        <span style={{ fontSize: 11, color: C.primary, fontWeight: 700, padding: "2px 10px",
          background: `${C.primary}15`, borderRadius: 10, border: `1px solid ${C.primary}33` }}>
          Depth {depth} · {nodes.length} node{nodes.length > 1 ? "s" : ""}
        </span>
        <div style={{ height: 1, flex: 1, background: "var(--border)" }} />
        <span style={{ fontSize: 10, color: C.dim }}>{collapsed ? "▸" : "▾"}</span>
      </button>
      {!collapsed && nodes.map((n, i) => {
        const thought = n.path?.[n.path.length - 1] || "";
        return (
          <NodeCard
            key={i}
            node={n}
            isBeam={beamIds.includes(thought)}
            isSolution={solutionNodes.includes(thought)}
          />
        );
      })}
    </div>
  );
}

function TotTrace() {
  const [mission,    setMission]    = useState("");
  const [maxDepth,   setMaxDepth]   = useState(3);
  const [nBranches,  setNBranches]  = useState(3);
  const [beamWidth,  setBeamWidth]  = useState(2);
  const [running,    setRunning]    = useState(false);
  const [nodesByDepth, setNodesByDepth] = useState({});
  const [beamIds,    setBeamIds]    = useState([]);
  const [solutionNodes, setSolutionNodes] = useState([]);
  const [plan,       setPlan]       = useState(null);
  const [status,     setStatus]     = useState(null); // "generating_plan" | "done"
  const [doneStats,  setDoneStats]  = useState(null);
  const esRef    = useRef(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [nodesByDepth, plan]);

  const stop = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
    setRunning(false);
  }, []);

  const start = useCallback(() => {
    if (!mission.trim() || running) return;
    setRunning(true);
    setNodesByDepth({});
    setBeamIds([]);
    setSolutionNodes([]);
    setPlan(null);
    setStatus(null);
    setDoneStats(null);

    const params = new URLSearchParams({
      mission, max_depth: maxDepth, n_branches: nBranches, beam_width: beamWidth, timeout: 180,
    });
    const es = new EventSource(`${BRAIN_URL}/tot/stream?${params}`);
    esRef.current = es;

    es.onmessage = (e) => {
      let ev;
      try { ev = JSON.parse(e.data); } catch { return; }

      if (ev.type === "node_eval") {
        const depth = ev.depth;
        setNodesByDepth(prev => {
          const existing = prev[depth] || [];
          const thought = ev.thought;
          // Évite les doublons
          if (existing.some(n => (n.path?.[n.path.length - 1] || "") === thought)) return prev;
          const node = {
            path:       [thought], // simplified — on a juste la pensée courante ici
            score:      ev.score,
            feasibility: ev.feasibility,
            relevance:  ev.relevance,
            safety:     ev.safety,
            reason:     ev.reason,
            is_solution: ev.is_solution,
            solution_summary: ev.solution_summary,
            depth,
          };
          return { ...prev, [depth]: [...existing, node] };
        });
        if (ev.is_solution) {
          setSolutionNodes(prev => [...prev, ev.thought]);
        }
      }

      if (ev.type === "beam_prune") {
        setBeamIds(ev.kept || []);
      }

      if (ev.type === "solution_found") {
        setSolutionNodes(prev => {
          const last = ev.path?.[ev.path.length - 1];
          return last && !prev.includes(last) ? [...prev, last] : prev;
        });
      }

      if (ev.type === "generating_plan") {
        setStatus("generating_plan");
      }

      if (ev.type === "plan_ready") {
        setPlan(ev.execution_plan);
        setStatus("plan_ready");
      }

      if (ev.type === "done") {
        setDoneStats({
          status:    ev.status,
          score:     ev.best_score,
          depth:     ev.path_depth,
          nodes:     ev.total_nodes,
          duration:  ev.duration_ms,
        });
        stop();
      }
    };
    es.onerror = () => stop();
  }, [mission, maxDepth, nBranches, beamWidth, running, stop]);

  const depths = Object.keys(nodesByDepth).map(Number).sort((a, b) => a - b);

  return (
    <div style={{ display: "flex", gap: 16, height: "100%", minHeight: 0 }}>
      {/* ── Left: form + tree ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, gap: 12 }}>
        {/* Form */}
        <Card>
          <SectionTitle>Mission Tree of Thoughts</SectionTitle>
          <textarea
            value={mission}
            onChange={e => setMission(e.target.value)}
            placeholder="Décris le problème à résoudre par exploration arborescente…"
            rows={2}
            style={{
              width: "100%", resize: "vertical", background: "var(--surface-2)",
              border: "1px solid var(--border-2)", borderRadius: 8, padding: "10px 12px",
              color: "var(--text)", fontSize: 13, fontFamily: "inherit", lineHeight: 1.5,
              outline: "none",
            }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
            {[
              ["Depth",    maxDepth,   setMaxDepth,   1, 6],
              ["Branches", nBranches,  setNBranches,  2, 5],
              ["Beam",     beamWidth,  setBeamWidth,  1, 4],
            ].map(([lbl, val, set, min, max]) => (
              <div key={lbl} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <label style={{ fontSize: 11, color: C.dim }}>{lbl}</label>
                <input type="number" min={min} max={max} value={val}
                  onChange={e => set(Number(e.target.value))}
                  style={{ width: 48, background: "var(--surface-2)", border: "1px solid var(--border-2)",
                    borderRadius: 6, padding: "4px 6px", color: "var(--text)", fontSize: 12 }} />
              </div>
            ))}
            <div style={{ flex: 1 }} />
            {running && (
              <button onClick={stop} style={{
                padding: "7px 14px", borderRadius: 7, border: "1px solid var(--border-2)",
                background: "var(--surface-3)", color: C.error, fontSize: 12, cursor: "pointer",
              }}>■ Stop</button>
            )}
            <button onClick={start} disabled={running || !mission.trim()} style={{
              padding: "7px 18px", borderRadius: 7, border: "none",
              background: running || !mission.trim() ? "var(--surface-3)" : "var(--primary)",
              color: running || !mission.trim() ? C.dim : "#fff",
              fontSize: 13, fontWeight: 600, cursor: running || !mission.trim() ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", gap: 6,
            }}>
              {running && <Spinner size={13} color="#fff" />}
              {running ? "Exploration…" : "🌳 Explorer"}
            </button>
          </div>
          {running && depths.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 11, color: C.primary, display: "flex", alignItems: "center", gap: 6 }}>
              <Spinner size={11} />
              {status === "generating_plan" ? "Génération du plan…" : `Depth ${depths[depths.length - 1]}/${maxDepth} · ${Object.values(nodesByDepth).flat().length} noeuds explorés`}
            </div>
          )}
        </Card>

        {/* Tree */}
        <div style={{ flex: 1, overflowY: "auto", paddingRight: 2 }}>
          {depths.length === 0 && !running && (
            <div style={{ textAlign: "center", color: C.dim, fontSize: 13, padding: "40px 0" }}>
              Lance une mission pour voir l'arbre de pensées se construire en temps réel.
            </div>
          )}
          {depths.map(d => (
            <DepthSection
              key={d}
              depth={d}
              nodes={nodesByDepth[d] || []}
              beamIds={beamIds}
              solutionNodes={solutionNodes}
            />
          ))}
          {running && depths.length > 0 && status !== "generating_plan" && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 0",
              color: C.dim, fontSize: 12 }}>
              <Spinner size={12} color={C.dim} />
              Expansion en cours…
            </div>
          )}
          {status === "generating_plan" && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px",
              borderRadius: 8, background: `${C.primary}10`, border: `1px solid ${C.primary}33`,
              color: C.primary, fontSize: 12, marginTop: 4 }}>
              <Spinner size={12} color={C.primary} />
              Génération du plan d'exécution…
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* ── Right: stats + plan ── */}
      <div style={{ width: 320, display: "flex", flexDirection: "column", gap: 12, flexShrink: 0 }}>
        {doneStats && (
          <Card>
            <SectionTitle color={C.ok}>✓ {doneStats.status === "solution_found" ? "Solution trouvée" : "Meilleur chemin"}</SectionTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {[
                ["Score",    `${Math.round((doneStats.score || 0) * 100)}%`],
                ["Profondeur", doneStats.depth],
                ["Noeuds",   doneStats.nodes],
                ["Durée",    `${((doneStats.duration || 0) / 1000).toFixed(1)}s`],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span style={{ color: C.dim }}>{k}</span>
                  <span style={{ color: "var(--text-2)", fontWeight: 600 }}>{v}</span>
                </div>
              ))}
            </div>
            {/* Score bar visuelle */}
            <div style={{ marginTop: 10 }}>
              <ScoreBar value={doneStats.score} label="Confiance" />
            </div>
          </Card>
        )}

        {plan && (
          <Card style={{ flex: 1 }}>
            <SectionTitle>Plan d'exécution</SectionTitle>
            <div style={{ overflowY: "auto", maxHeight: "calc(100vh - 380px)" }}>
              <div style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.65,
                whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {plan}
              </div>
            </div>
          </Card>
        )}

        {!plan && !doneStats && (
          <Card style={{ flex: 1 }}>
            <SectionTitle>Comment ça marche</SectionTitle>
            <div style={{ fontSize: 12, color: C.text2, lineHeight: 1.65 }}>
              <p style={{ marginBottom: 8 }}>Le <strong style={{ color: "var(--text)" }}>Tree of Thoughts</strong> explore plusieurs chemins de raisonnement en parallèle :</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[
                  ["🌱 Expand",  "Génère N pensées candidates par noeud"],
                  ["⚖️ Evaluate", "Score chaque pensée (feasibility / relevance / safety)"],
                  ["✂️ Prune",   "Garde les beam_width meilleurs chemins (BEAM)"],
                  ["🔁 Repeat",  "Continue jusqu'à is_solution=true ou max_depth"],
                  ["📋 Plan",    "Synthétise le meilleur chemin en plan actionnable"],
                ].map(([icon, desc]) => (
                  <div key={icon} style={{ display: "flex", gap: 8 }}>
                    <span style={{ flexShrink: 0, fontSize: 13 }}>{icon}</span>
                    <span style={{ color: C.text2 }}>{desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// PAGE PRINCIPALE
// ══════════════════════════════════════════════════════════════════════════════

const TABS = [
  { id: "react", label: "⚡ ReAct",           desc: "Reason → Act → Observe" },
  { id: "tot",   label: "🌳 Tree of Thoughts", desc: "BFS beam search" },
];

export default function BrainTracePage() {
  const [tab, setTab] = useState("react");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "20px 24px", gap: 16 }}>
      {/* Header */}
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>
          Brain Live Trace
        </h1>
        <p style={{ fontSize: 13, color: C.dim }}>
          Trace en temps réel des boucles de raisonnement — SSE depuis brain :8003
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border)", paddingBottom: 0 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: "8px 16px", borderRadius: "8px 8px 0 0", border: "1px solid var(--border)",
            borderBottom: t.id === tab ? "1px solid var(--bg)" : "1px solid var(--border)",
            background: t.id === tab ? "var(--bg)" : "var(--surface)",
            color: t.id === tab ? "var(--primary)" : C.text2,
            fontSize: 13, fontWeight: t.id === tab ? 600 : 400,
            cursor: "pointer", marginBottom: -1, transition: "all 0.12s",
          }}>
            {t.label}
            <span style={{ marginLeft: 6, fontSize: 10, color: C.dim }}>{t.desc}</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {tab === "react" ? <ReactTrace /> : <TotTrace />}
      </div>
    </div>
  );
}
