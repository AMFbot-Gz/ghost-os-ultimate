/**
 * EvolutionPage.jsx — Auto-évolution des Skills
 * Visualise, génère, évolue et évalue les skills Node.js via /brain/evolution/*
 */
import React, { useState, useEffect, useCallback, useRef } from "react";

const BRAIN_URL = "/brain";

// ─── Couleurs ────────────────────────────────────────────────────────────────
const C = {
  ok:      "var(--green)",
  error:   "var(--red)",
  warn:    "var(--yellow)",
  blue:    "var(--blue)",
  violet:  "var(--violet)",
  primary: "var(--primary)",
  dim:     "var(--text-3)",
  text2:   "var(--text-2)",
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmt_date(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })
      + " " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  } catch { return iso.slice(0, 16); }
}

function SuccessRate({ rate }) {
  if (rate == null) return <span style={{ color: C.dim, fontSize: 11 }}>—</span>;
  const pct = Math.round(rate * 100);
  const color = pct >= 80 ? C.ok : pct >= 55 ? C.warn : C.error;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <div style={{ width: 40, height: 4, background: "var(--surface-4)", borderRadius: 2 }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2 }} />
      </div>
      <span style={{ color, fontSize: 11, fontWeight: 600 }}>{pct}%</span>
    </div>
  );
}

function Badge({ label, color = "var(--surface-3)", textColor }) {
  return (
    <span style={{
      background: color, color: textColor || "white",
      borderRadius: 6, padding: "2px 7px", fontSize: 10, fontWeight: 700,
      letterSpacing: "0.03em",
    }}>{label}</span>
  );
}

function Spinner() {
  return <span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>⟳</span>;
}

// ─── Onglet Skills ───────────────────────────────────────────────────────────

function SkillCard({ skill, onEvolve, onTest, evolving }) {
  const [open, setOpen] = useState(false);
  const hasMetrics = skill.total_calls > 0;

  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10,
      overflow: "hidden",
      borderLeft: `3px solid ${hasMetrics
        ? (skill.success_rate >= 0.8 ? C.ok : skill.success_rate >= 0.5 ? C.warn : C.error)
        : "var(--border)"}`,
    }}>
      <div
        style={{ padding: "12px 14px", cursor: "pointer", display: "flex", alignItems: "flex-start", gap: 10 }}
        onClick={() => setOpen(o => !o)}
        onMouseEnter={e => { e.currentTarget.style.background = "var(--surface-2)"; }}
        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
      >
        {/* Info principale */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{skill.name}</span>
            <Badge label={`v${skill.version || "1.0.0"}`} color="var(--surface-3)" textColor="var(--text-2)" />
            {skill.evolution_count > 0 && (
              <Badge label={`${skill.evolution_count}× évolué`} color="var(--violet)" />
            )}
            {skill.generated_by === "evolution_v2" && (
              <Badge label="AUTO" color="var(--blue)" />
            )}
          </div>
          <div style={{ fontSize: 12, color: C.dim, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {skill.description || "—"}
          </div>
          {hasMetrics && (
            <div style={{ display: "flex", gap: 14, marginTop: 5, alignItems: "center" }}>
              <SuccessRate rate={skill.success_rate} />
              <span style={{ fontSize: 11, color: C.dim }}>{skill.total_calls} appel(s)</span>
              {skill.avg_duration_ms > 0 && (
                <span style={{ fontSize: 11, color: C.dim }}>{Math.round(skill.avg_duration_ms)}ms moy.</span>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
          <button
            onClick={e => { e.stopPropagation(); onTest(skill.name); }}
            style={{
              background: "var(--surface-3)", border: "1px solid var(--border-2)",
              borderRadius: 6, padding: "4px 10px", fontSize: 11, cursor: "pointer",
              color: C.text2,
            }}
          >Tester</button>
          <button
            onClick={e => { e.stopPropagation(); onEvolve(skill.name); }}
            disabled={evolving === skill.name}
            style={{
              background: evolving === skill.name ? "var(--surface-3)" : "var(--primary-dim, rgba(224,123,84,0.15))",
              border: "1px solid var(--primary)",
              borderRadius: 6, padding: "4px 10px", fontSize: 11, cursor: "pointer",
              color: "var(--primary)", fontWeight: 600,
            }}
          >{evolving === skill.name ? <Spinner /> : "⚡ Évoluer"}</button>
          <span style={{ color: C.dim, fontSize: 13 }}>{open ? "▲" : "▼"}</span>
        </div>
      </div>

      {open && (
        <div style={{ borderTop: "1px solid var(--border)", padding: "10px 14px", fontSize: 11, color: C.dim }}>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {skill.created && <span>Créé: {fmt_date(skill.created)}</span>}
            {skill.last_evolved_at && <span>Dernière évolution: {fmt_date(skill.last_evolved_at)}</span>}
            {skill.last_called_at && <span>Dernier appel: {fmt_date(skill.last_called_at)}</span>}
            {skill.failed_calls > 0 && <span style={{ color: C.error }}>{skill.failed_calls} échec(s)</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function TabSkills({ skills, loading, onRefresh }) {
  const [evolving, setEvolving]     = useState(null);  // nom du skill en cours d'évolution
  const [testModal, setTestModal]   = useState(null);  // nom du skill en test
  const [testParams, setTestParams] = useState("{}");
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting]       = useState(false);
  const [evolveMsg, setEvolveMsg]   = useState(null);
  const [filterQ, setFilterQ]       = useState("");

  const filtered = skills.filter(s =>
    !filterQ || s.name.includes(filterQ) || (s.description || "").toLowerCase().includes(filterQ.toLowerCase())
  );

  const onEvolve = useCallback(async (name) => {
    const reason = prompt(`Raison de l'évolution pour "${name}" :`, "amélioration générale");
    if (reason === null) return;
    setEvolving(name);
    setEvolveMsg(null);
    try {
      const r = await fetch(`${BRAIN_URL}/evolution/evolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, reason: reason || "amélioration générale" }),
      });
      const data = await r.json();
      setEvolveMsg(data.evolved
        ? `✅ "${name}" v${data.old_version} → v${data.new_version}`
        : `❌ Échec: ${data.error}`
      );
      if (data.evolved) onRefresh();
    } catch (e) {
      setEvolveMsg(`❌ Erreur: ${e.message}`);
    } finally {
      setEvolving(null);
    }
  }, [onRefresh]);

  const onTest = useCallback((name) => {
    setTestModal(name);
    setTestParams("{}");
    setTestResult(null);
  }, []);

  const runTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      let params = {};
      try { params = JSON.parse(testParams); } catch { params = {}; }
      const r = await fetch(`${BRAIN_URL}/evolution/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: testModal, test_cases: [{ params }] }),
      });
      setTestResult(await r.json());
    } catch (e) {
      setTestResult({ error: e.message });
    } finally {
      setTesting(false);
    }
  }, [testModal, testParams]);

  return (
    <div>
      {/* Barre de filtre + stats */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "center" }}>
        <input
          placeholder="Filtrer les skills…"
          value={filterQ}
          onChange={e => setFilterQ(e.target.value)}
          style={{
            flex: 1, background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: 8, padding: "8px 12px", fontSize: 13, color: "var(--text)", outline: "none",
          }}
        />
        <span style={{ fontSize: 12, color: C.dim, flexShrink: 0 }}>
          {filtered.length} / {skills.length} skills
        </span>
        <button
          onClick={onRefresh}
          disabled={loading}
          style={{
            background: "var(--surface-3)", border: "1px solid var(--border-2)",
            borderRadius: 6, padding: "6px 14px", fontSize: 12, cursor: "pointer", color: C.text2,
          }}
        >{loading ? "…" : "↻ Refresh"}</button>
      </div>

      {/* Message retour évolution */}
      {evolveMsg && (
        <div style={{
          padding: "8px 14px", borderRadius: 8, marginBottom: 12, fontSize: 12,
          background: evolveMsg.startsWith("✅") ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
          color: evolveMsg.startsWith("✅") ? C.ok : C.error,
          border: `1px solid ${evolveMsg.startsWith("✅") ? C.ok : C.error}`,
        }}>
          {evolveMsg}
        </div>
      )}

      {loading && <div style={{ textAlign: "center", color: C.dim, padding: 32, fontSize: 13 }}>Chargement…</div>}
      {!loading && filtered.length === 0 && (
        <div style={{ textAlign: "center", color: C.dim, padding: 40, background: "var(--surface)", borderRadius: 12, border: "1px solid var(--border)", fontSize: 13 }}>
          Aucun skill trouvé.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filtered.map(s => (
          <SkillCard key={s.name} skill={s} onEvolve={onEvolve} onTest={onTest} evolving={evolving} />
        ))}
      </div>

      {/* Modal test */}
      {testModal && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 200,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12,
            padding: 24, width: 480, maxWidth: "90vw",
          }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 16, color: "var(--text)" }}>
              Tester «{testModal}»
            </h3>
            <div style={{ fontSize: 12, color: C.dim, marginBottom: 8 }}>Paramètres JSON :</div>
            <textarea
              value={testParams}
              onChange={e => setTestParams(e.target.value)}
              rows={4}
              style={{
                width: "100%", boxSizing: "border-box", background: "var(--surface-3)",
                border: "1px solid var(--border)", borderRadius: 8,
                padding: "8px 10px", fontSize: 12, fontFamily: "monospace",
                color: "var(--text)", resize: "vertical", outline: "none",
              }}
            />
            {testResult && (
              <pre style={{
                marginTop: 10, padding: "8px 10px", background: "var(--surface-3)",
                borderRadius: 8, fontSize: 11, color: testResult.error ? C.error : C.ok,
                maxHeight: 160, overflow: "auto", whiteSpace: "pre-wrap",
              }}>
                {JSON.stringify(testResult, null, 2)}
              </pre>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
              <button
                onClick={() => setTestModal(null)}
                style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 14px", fontSize: 12, cursor: "pointer", color: C.dim }}
              >Fermer</button>
              <button
                onClick={runTest}
                disabled={testing}
                style={{
                  background: "var(--primary)", border: "none", borderRadius: 6,
                  padding: "6px 16px", fontSize: 12, cursor: "pointer", color: "white", fontWeight: 600,
                }}
              >{testing ? "Exécution…" : "▶ Lancer"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Onglet Générer ───────────────────────────────────────────────────────────

function TabGenerate({ onSkillCreated }) {
  const [form, setForm] = useState({
    name: "", goal: "", description: "", examples: "", params: "",
  });
  const [generating, setGenerating] = useState(false);
  const [result, setResult]         = useState(null);

  const update = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const onGenerate = useCallback(async () => {
    if (!form.name.trim() || !form.goal.trim()) return;
    setGenerating(true);
    setResult(null);
    try {
      let examples = [];
      if (form.examples.trim()) {
        try { examples = JSON.parse(form.examples); }
        catch { examples = [{ params: { example: form.examples.trim() } }]; }
      }
      let params = {};
      if (form.params.trim()) {
        try { params = JSON.parse(form.params); }
        catch { params = {}; }
      }
      const r = await fetch(`${BRAIN_URL}/evolution/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:        form.name.trim(),
          goal:        form.goal.trim(),
          description: form.description.trim(),
          examples,
          params,
        }),
      });
      const data = await r.json();
      setResult(data);
      if (data.created) onSkillCreated();
    } catch (e) {
      setResult({ created: false, error: e.message });
    } finally {
      setGenerating(false);
    }
  }, [form, onSkillCreated]);

  const inputStyle = {
    width: "100%", boxSizing: "border-box", background: "var(--surface)",
    border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px",
    fontSize: 13, color: "var(--text)", outline: "none",
  };
  const label = (txt, required) => (
    <div style={{ fontSize: 12, color: C.dim, marginBottom: 5, marginTop: 14 }}>
      {txt} {required && <span style={{ color: C.error }}>*</span>}
    </div>
  );

  return (
    <div style={{ maxWidth: 560 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", margin: "0 0 4px" }}>
        Générer un nouveau skill Node.js
      </h2>
      <p style={{ fontSize: 12, color: C.dim, margin: "0 0 16px" }}>
        Le LLM génère skill.js + manifest.json · Validation syntaxique auto · Enregistrement dans registry.json
      </p>

      {label("Nom du skill (snake_case)", true)}
      <input
        value={form.name} onChange={e => update("name", e.target.value)}
        placeholder="ex: fetch_weather"
        style={inputStyle}
        onFocus={e => { e.target.style.borderColor = "var(--primary)"; }}
        onBlur={e => { e.target.style.borderColor = "var(--border)"; }}
      />

      {label("Objectif (décrit ce que fait le skill)", true)}
      <textarea
        value={form.goal} onChange={e => update("goal", e.target.value)}
        placeholder="ex: Récupère la météo d'une ville via l'API open-meteo et retourne température + description"
        rows={3}
        style={{ ...inputStyle, resize: "vertical" }}
        onFocus={e => { e.target.style.borderColor = "var(--primary)"; }}
        onBlur={e => { e.target.style.borderColor = "var(--border)"; }}
      />

      {label("Description courte (optionnel)")}
      <input
        value={form.description} onChange={e => update("description", e.target.value)}
        placeholder="ex: Météo en temps réel via open-meteo (sans API key)"
        style={inputStyle}
        onFocus={e => { e.target.style.borderColor = "var(--primary)"; }}
        onBlur={e => { e.target.style.borderColor = "var(--border)"; }}
      />

      {label("Exemples d'utilisation JSON (optionnel)")}
      <textarea
        value={form.examples} onChange={e => update("examples", e.target.value)}
        placeholder='[{"params": {"city": "Paris"}, "expected": "température + description"}]'
        rows={3}
        style={{ ...inputStyle, resize: "vertical", fontFamily: "monospace", fontSize: 12 }}
        onFocus={e => { e.target.style.borderColor = "var(--primary)"; }}
        onBlur={e => { e.target.style.borderColor = "var(--border)"; }}
      />

      {label("Paramètres JSON (optionnel)")}
      <textarea
        value={form.params} onChange={e => update("params", e.target.value)}
        placeholder='{"city": "string (required)", "units": "metric|imperial (default: metric)"}'
        rows={2}
        style={{ ...inputStyle, resize: "vertical", fontFamily: "monospace", fontSize: 12 }}
        onFocus={e => { e.target.style.borderColor = "var(--primary)"; }}
        onBlur={e => { e.target.style.borderColor = "var(--border)"; }}
      />

      <button
        onClick={onGenerate}
        disabled={generating || !form.name.trim() || !form.goal.trim()}
        style={{
          marginTop: 18, background: generating ? "var(--surface-3)" : "var(--primary)",
          border: "none", borderRadius: 8, padding: "10px 24px",
          fontSize: 13, fontWeight: 700, cursor: generating ? "not-allowed" : "pointer",
          color: generating ? C.dim : "white",
        }}
      >{generating ? "Génération en cours…" : "✨ Générer le skill"}</button>

      {result && (
        <div style={{
          marginTop: 16, padding: "12px 16px", borderRadius: 10,
          background: result.created ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)",
          border: `1px solid ${result.created ? C.ok : C.error}`,
        }}>
          {result.created ? (
            <>
              <div style={{ color: C.ok, fontWeight: 700, marginBottom: 6 }}>
                ✅ Skill «{result.skill}» créé — v{result.version}
              </div>
              <div style={{ fontSize: 11, color: C.dim, marginBottom: 8 }}>
                Syntaxe: {result.syntax_ok ? "✓ valide" : `⚠ ${result.syntax_error}`}
              </div>
              <pre style={{
                background: "var(--surface-3)", borderRadius: 6, padding: "8px 10px",
                fontSize: 11, color: C.text2, maxHeight: 160, overflow: "auto",
                whiteSpace: "pre-wrap", margin: 0,
              }}>{result.code_preview}…</pre>
            </>
          ) : (
            <div style={{ color: C.error }}>❌ {result.error}</div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Onglet Log ───────────────────────────────────────────────────────────────

const LOG_ICONS = {
  skill_generated: { icon: "✨", color: C.ok },
  skill_evolved:   { icon: "⚡", color: C.violet },
  skill_evaluated: { icon: "🔬", color: C.blue },
  cycle_complete:  { icon: "🔄", color: C.dim },
};

function TabLog({ events, loading, onRefresh }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <span style={{ fontSize: 12, color: C.dim }}>{events.length} événement(s)</span>
        <button
          onClick={onRefresh}
          disabled={loading}
          style={{
            background: "var(--surface-3)", border: "1px solid var(--border-2)",
            borderRadius: 6, padding: "5px 12px", fontSize: 12, cursor: "pointer", color: C.text2,
          }}
        >{loading ? "…" : "↻ Refresh"}</button>
      </div>

      {loading && <div style={{ textAlign: "center", color: C.dim, padding: 32, fontSize: 13 }}>Chargement…</div>}
      {!loading && events.length === 0 && (
        <div style={{ textAlign: "center", color: C.dim, padding: 40, background: "var(--surface)", borderRadius: 12, border: "1px solid var(--border)", fontSize: 13 }}>
          Aucun événement. Générez ou évoluez un skill pour commencer.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {events.map((ev, i) => {
          const { icon = "•", color = C.dim } = LOG_ICONS[ev.event] || {};
          return (
            <div key={i} style={{
              background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8,
              padding: "10px 14px", display: "flex", gap: 12, alignItems: "flex-start",
            }}>
              <span style={{ fontSize: 16, flexShrink: 0 }}>{icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12, color, fontWeight: 600 }}>{ev.event}</span>
                  {ev.skill && <Badge label={ev.skill} color="var(--surface-3)" textColor="var(--text-2)" />}
                  {ev.version && <Badge label={`v${ev.version}`} color="var(--surface-3)" textColor="var(--text-2)" />}
                  {ev.new_version && <Badge label={`→ v${ev.new_version}`} color="var(--violet)" />}
                  {ev.syntax_ok === false && <Badge label="syntax ⚠" color="var(--yellow)" textColor="var(--bg)" />}
                  {ev.passed != null && (
                    <Badge
                      label={`${ev.passed}/${ev.total} cas`}
                      color={ev.passed === ev.total ? C.ok : C.warn}
                    />
                  )}
                </div>
                <div style={{ fontSize: 11, color: C.dim, marginTop: 3 }}>
                  {fmt_date(ev.timestamp)}
                  {ev.reason && ` · ${ev.reason.slice(0, 80)}`}
                  {ev.patterns?.length > 0 && ` · patterns: ${ev.patterns.slice(0, 2).join(", ")}`}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Page principale ─────────────────────────────────────────────────────────

export default function EvolutionPage() {
  const [tab, setTab]       = useState("skills");
  const [skills, setSkills] = useState([]);
  const [events, setEvents] = useState([]);
  const [loadingSkills, setLoadingSkills] = useState(true);
  const [loadingLog, setLoadingLog]       = useState(false);
  const [analyzing, setAnalyzing]         = useState(false);
  const [analyzeResult, setAnalyzeResult] = useState(null);

  const loadSkills = useCallback(async () => {
    setLoadingSkills(true);
    try {
      const r = await fetch(`${BRAIN_URL}/evolution/skills`);
      const d = await r.json();
      setSkills(d.node_skills || []);
    } catch (e) {
      console.error("Evolution skills load error:", e);
    } finally {
      setLoadingSkills(false);
    }
  }, []);

  const loadLog = useCallback(async () => {
    setLoadingLog(true);
    try {
      const r = await fetch(`${BRAIN_URL}/evolution/log?limit=100`);
      const d = await r.json();
      setEvents(d.events || []);
    } catch (e) {
      console.error("Evolution log load error:", e);
    } finally {
      setLoadingLog(false);
    }
  }, []);

  useEffect(() => {
    loadSkills();
    loadLog();
  }, [loadSkills, loadLog]);

  const onTabChange = (t) => {
    setTab(t);
    if (t === "log") loadLog();
    if (t === "skills") loadSkills();
  };

  const onAnalyze = useCallback(async () => {
    setAnalyzing(true);
    setAnalyzeResult(null);
    try {
      const r = await fetch(`${BRAIN_URL}/evolution/analyze`, { method: "POST" });
      setAnalyzeResult(await r.json());
    } catch (e) {
      setAnalyzeResult({ error: e.message });
    } finally {
      setAnalyzing(false);
    }
  }, []);

  const tabs = [
    { id: "skills",  label: `Skills (${skills.length})` },
    { id: "generate", label: "Générer" },
    { id: "log",     label: `Journal (${events.length})` },
  ];

  return (
    <div style={{ padding: 24, maxWidth: 960, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 20, display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", margin: 0 }}>
            🧬 Auto-Évolution des Skills
          </h1>
          <p style={{ fontSize: 13, color: C.dim, margin: "6px 0 0" }}>
            Génération Node.js ESM · Évolution LLM avec versionning · Évaluation automatique · Boucle 30min
          </p>
        </div>
        <button
          onClick={onAnalyze}
          disabled={analyzing}
          style={{
            background: "var(--primary-dim, rgba(224,123,84,0.15))", border: "1px solid var(--primary)",
            borderRadius: 8, padding: "8px 18px", fontSize: 12, cursor: "pointer",
            color: "var(--primary)", fontWeight: 600,
          }}
        >{analyzing ? "Analyse…" : "🔍 Analyser les patterns"}</button>
      </div>

      {/* Résultat analyse */}
      {analyzeResult && (
        <div style={{
          marginBottom: 16, padding: "12px 16px", borderRadius: 10,
          background: "var(--surface)", border: "1px solid var(--border)", fontSize: 12,
        }}>
          {analyzeResult.error
            ? <span style={{ color: C.error }}>❌ {analyzeResult.error}</span>
            : <>
                <div style={{ fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>
                  {analyzeResult.patterns?.length
                    ? `🔍 ${analyzeResult.patterns.length} pattern(s) détecté(s)`
                    : "✓ Aucun pattern d'échec critique"}
                </div>
                {analyzeResult.recommendation && (
                  <div style={{ color: C.text2 }}>{analyzeResult.recommendation}</div>
                )}
                {analyzeResult.new_skill_needed && analyzeResult.skill_description && (
                  <div style={{ marginTop: 6, color: C.warn }}>
                    💡 Nouveau skill suggéré: {analyzeResult.skill_description.slice(0, 100)}
                  </div>
                )}
                {analyzeResult.skill_to_evolve && analyzeResult.skill_to_evolve !== "null" && (
                  <div style={{ marginTop: 4, color: "var(--violet)" }}>
                    ⚡ Skill à évoluer: «{analyzeResult.skill_to_evolve}»
                  </div>
                )}
              </>
          }
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--border)", marginBottom: 20 }}>
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => onTabChange(t.id)}
            style={{
              background: "transparent", border: "none", cursor: "pointer",
              padding: "9px 18px", fontSize: 13, fontWeight: tab === t.id ? 700 : 400,
              color: tab === t.id ? "var(--primary)" : C.text2,
              borderBottom: `2px solid ${tab === t.id ? "var(--primary)" : "transparent"}`,
              marginBottom: -1,
            }}
          >{t.label}</button>
        ))}
      </div>

      {/* Contenu */}
      {tab === "skills" && (
        <TabSkills skills={skills} loading={loadingSkills} onRefresh={loadSkills} />
      )}
      {tab === "generate" && (
        <TabGenerate onSkillCreated={() => { loadSkills(); loadLog(); onTabChange("skills"); }} />
      )}
      {tab === "log" && (
        <TabLog events={events} loading={loadingLog} onRefresh={loadLog} />
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
