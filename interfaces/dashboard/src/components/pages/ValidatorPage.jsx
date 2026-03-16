/**
 * ValidatorPage.jsx — Phase 17 : Skill Validator Loop
 * Pipeline 5 checks · historique validations · quarantaine · dispatch manuel
 */
import { useEffect, useState } from "react";

const VALIDATOR_API = "http://localhost:8014";
const EVOLUTION_API = "http://localhost:8005";

const CHECK_NAMES = ["syntax", "structure", "security", "execution", "output"];
const CHECK_META  = {
  syntax:    { icon: "📝", label: "Syntaxe",    desc: "node --input-type=module --check" },
  structure: { icon: "🏗️",  label: "Structure",  desc: "export async function run() présent" },
  security:  { icon: "🔒", label: "Sécurité",   desc: "Patterns shell dangereux bloqués" },
  execution: { icon: "▶️",  label: "Exécution",  desc: "Sandbox Node.js, timeout 12s" },
  output:    { icon: "📤", label: "Output",     desc: "Retourne {success: bool}" },
};

function StatusBadge({ passed, quarantined }) {
  if (quarantined)
    return <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10,
      background: "rgba(243,139,168,0.15)", color: "#f38ba8", letterSpacing: "0.04em" }}>QUARANTAINE</span>;
  if (passed)
    return <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10,
      background: "rgba(166,227,161,0.15)", color: "#a6e3a1", letterSpacing: "0.04em" }}>VALIDÉ</span>;
  return <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10,
    background: "rgba(243,139,168,0.15)", color: "#f38ba8", letterSpacing: "0.04em" }}>ÉCHEC</span>;
}

function CheckDot({ passed, skipped }) {
  if (skipped) return <span title="ignoré" style={{ color: "var(--text-3)", fontSize: 13 }}>○</span>;
  if (passed)  return <span title="passé"  style={{ color: "#a6e3a1",      fontSize: 13 }}>●</span>;
  return              <span title="échoué" style={{ color: "#f38ba8",      fontSize: 13 }}>●</span>;
}

function CheckRow({ name, result }) {
  const meta   = CHECK_META[name];
  const passed = result?.passed;
  const skip   = result?.skipped;
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 10,
      padding: "8px 0", borderBottom: "1px solid var(--border)",
    }}>
      <span style={{ fontSize: 16, width: 22, textAlign: "center", marginTop: 1 }}>{meta?.icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{meta?.label}</span>
          {skip && <span style={{ fontSize: 10, color: "var(--text-3)" }}>ignoré</span>}
          {!skip && (passed
            ? <span style={{ fontSize: 10, color: "#a6e3a1", fontWeight: 600 }}>✓ PASS</span>
            : <span style={{ fontSize: 10, color: "#f38ba8", fontWeight: 600 }}>✗ FAIL</span>
          )}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{result?.detail || meta?.desc}</div>
      </div>
    </div>
  );
}

function RunCard({ run, onRevalidate }) {
  const [expanded, setExpanded] = useState(false);
  const checksPassed = run.checks_passed?.length ?? 0;
  const checksTotal  = CHECK_NAMES.length;

  return (
    <div style={{
      background: "var(--surface-2)", borderRadius: 10,
      border: `1px solid ${run.passed ? "rgba(166,227,161,0.2)" : "rgba(243,139,168,0.2)"}`,
      overflow: "hidden",
    }}>
      {/* Header */}
      <div
        style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", cursor: "pointer" }}
        onClick={() => setExpanded(e => !e)}
      >
        <span style={{ fontSize: 16 }}>{run.passed ? "✅" : run.quarantined ? "🔒" : "❌"}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{run.skill_name}</span>
            <StatusBadge passed={run.passed} quarantined={run.quarantined} />
            {run.deployed === 1 && (
              <span style={{ fontSize: 10, color: "#cba6f7", fontWeight: 600 }}>📦 déployé</span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3 }}>
            {/* Mini dots */}
            {CHECK_NAMES.map(n => (
              <CheckDot key={n} passed={run.checks?.[n]?.passed} skipped={run.checks?.[n]?.skipped} />
            ))}
            <span style={{ fontSize: 10, color: "var(--text-3)", marginLeft: 4 }}>
              {checksPassed}/{checksTotal} checks
            </span>
            <span style={{ fontSize: 10, color: "var(--text-3)" }}>·</span>
            <span style={{ fontSize: 10, color: "var(--text-3)" }}>
              {run.duration_ms ? `${run.duration_ms < 1000 ? run.duration_ms + "ms" : (run.duration_ms / 1000).toFixed(1) + "s"}` : ""}
            </span>
            <span style={{ fontSize: 10, color: "var(--text-3)" }}>·</span>
            <span style={{ fontSize: 10, color: "var(--text-3)" }}>
              {run.source || "api"}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button
            onClick={e => { e.stopPropagation(); onRevalidate(run.skill_name); }}
            style={{
              padding: "4px 10px", borderRadius: 6,
              background: "var(--surface)", border: "1px solid var(--border)",
              color: "var(--text-2)", fontSize: 11, cursor: "pointer",
            }}
          >↺ Re-valider</button>
          <span style={{ fontSize: 12, color: "var(--text-3)", alignSelf: "center" }}>
            {expanded ? "▲" : "▼"}
          </span>
        </div>
      </div>

      {/* Expanded: check detail */}
      {expanded && (
        <div style={{ padding: "0 14px 14px", borderTop: "1px solid var(--border)" }}>
          <div style={{ marginTop: 10 }}>
            {CHECK_NAMES.map(n => (
              <CheckRow key={n} name={n} result={run.checks?.[n]} />
            ))}
          </div>
          {run.error && (
            <div style={{
              marginTop: 10, padding: "8px 10px", borderRadius: 6,
              background: "rgba(243,139,168,0.08)", color: "#f38ba8", fontSize: 11,
            }}>{run.error}</div>
          )}
          {run.code_preview && (
            <pre style={{
              marginTop: 10, padding: "8px 10px", borderRadius: 6,
              background: "var(--surface)", color: "var(--text-3)",
              fontSize: 10, overflowX: "auto", whiteSpace: "pre-wrap",
              wordBreak: "break-all", maxHeight: 120, margin: "10px 0 0",
            }}>{run.code_preview}</pre>
          )}
        </div>
      )}
    </div>
  );
}

export default function ValidatorPage() {
  const [tab, setTab]         = useState("runs");
  const [stats, setStats]     = useState(null);
  const [runs, setRuns]       = useState([]);
  const [quarantine, setQuarantine] = useState([]);
  const [form, setForm]       = useState({ name: "", code: "" });
  const [formLoading, setFormLoading] = useState(false);
  const [formResult, setFormResult]   = useState(null);
  const [revalidating, setRevalidating] = useState(null);
  const [lastUpdate, setLastUpdate]   = useState(null);

  const fetchData = async () => {
    try {
      const [statsR, runsR, qR] = await Promise.all([
        fetch(`${VALIDATOR_API}/stats`).then(r => r.ok ? r.json() : null),
        fetch(`${VALIDATOR_API}/runs?limit=50`).then(r => r.ok ? r.json() : null),
        fetch(`${VALIDATOR_API}/quarantine`).then(r => r.ok ? r.json() : null),
      ]);
      if (statsR)      setStats(statsR);
      if (runsR?.items) setRuns(runsR.items);
      if (qR?.skills)  setQuarantine(qR.skills);
      setLastUpdate(new Date().toLocaleTimeString("fr-FR"));
    } catch {}
  };

  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, 8000);
    return () => clearInterval(iv);
  }, []);

  const handleValidate = async () => {
    if (!form.name.trim()) return;
    setFormLoading(true);
    setFormResult(null);
    try {
      const body = { name: form.name.trim(), auto_deploy: true, auto_quarantine: true, source: "dashboard" };
      if (form.code.trim()) body.code = form.code.trim();
      const r = await fetch(`${VALIDATOR_API}/validate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (r.ok) setFormResult(await r.json());
    } catch (e) {
      setFormResult({ error: e.message });
    }
    setFormLoading(false);
    setTimeout(fetchData, 1500);
  };

  const handleRevalidate = async (skillName) => {
    setRevalidating(skillName);
    try {
      const r = await fetch(`${VALIDATOR_API}/revalidate/${skillName}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auto_deploy: true, auto_quarantine: true }),
      });
      if (r.ok) {
        const result = await r.json();
        // Mettre à jour inline dans la liste
        setRuns(prev => prev.map(run =>
          run.skill_name === skillName ? { ...run, ...result, checks: result.checks } : run
        ));
      }
    } catch {}
    setRevalidating(null);
    setTimeout(fetchData, 1000);
  };

  const handleRestore = async (skillName) => {
    try {
      await fetch(`${VALIDATOR_API}/quarantine/${skillName}/restore`, { method: "POST" });
      setTimeout(fetchData, 500);
    } catch {}
  };

  const TABS = [
    { id: "runs",       label: "📋 Historique" },
    { id: "validate",   label: "🔬 Valider" },
    { id: "quarantine", label: `🔒 Quarantaine${quarantine.length > 0 ? ` (${quarantine.length})` : ""}` },
    { id: "pipeline",   label: "⚙️ Pipeline" },
  ];

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--text)" }}>
            🔬 Skill Validator Loop — Phase 17
          </h2>
          <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 3 }}>
            5 checks · syntax → structure → security → execution → output · deploy/quarantine automatique
            {lastUpdate && <> · MAJ {lastUpdate}</>}
          </div>
        </div>
        <button onClick={fetchData} style={{
          background: "var(--surface-2)", border: "1px solid var(--border)",
          borderRadius: 8, padding: "6px 14px", color: "var(--text-2)",
          fontSize: 12, cursor: "pointer",
        }}>↺ Actualiser</button>
      </div>

      {/* KPIs */}
      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10 }}>
          {[
            { label: "Validations",  value: stats.total,       color: "var(--primary)" },
            { label: "Passées",      value: stats.passed,      color: "#a6e3a1" },
            { label: "Échouées",     value: stats.failed,      color: "#f38ba8" },
            { label: "Déployées",    value: stats.deployed,    color: "#cba6f7" },
            { label: "Quarantaine",  value: stats.quarantined, color: "#f9e2af" },
          ].map(k => (
            <div key={k.label} style={{ background: "var(--surface-2)", borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: k.color }}>{k.value ?? "—"}</div>
              <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 3 }}>{k.label}</div>
              {k.label === "Passées" && stats.total > 0 && (
                <div style={{ fontSize: 10, color: "#a6e3a1", marginTop: 2 }}>
                  {Math.round((stats.pass_rate || 0) * 100)}% taux
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Barre taux de succès */}
      {stats && stats.total > 0 && (
        <div>
          <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 5 }}>
            Taux de validation global — {Math.round((stats.pass_rate || 0) * 100)}%
          </div>
          <div style={{ height: 6, borderRadius: 3, background: "var(--surface-2)", overflow: "hidden" }}>
            <div style={{
              height: "100%", borderRadius: 3,
              width: `${Math.round((stats.pass_rate || 0) * 100)}%`,
              background: stats.pass_rate >= 0.7 ? "#a6e3a1" : stats.pass_rate >= 0.4 ? "var(--primary)" : "#f38ba8",
              transition: "width 0.4s ease",
            }} />
          </div>
        </div>
      )}

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

      {/* ── Tab Historique ── */}
      {tab === "runs" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {runs.length === 0 ? (
            <div style={{ textAlign: "center", color: "var(--text-3)", padding: 40, fontSize: 13 }}>
              Aucune validation encore. Les skills générés par le Miner seront automatiquement validés ici.
            </div>
          ) : runs.map(run => (
            <RunCard
              key={run.id}
              run={run}
              onRevalidate={(name) => {
                if (revalidating !== name) handleRevalidate(name);
              }}
            />
          ))}
        </div>
      )}

      {/* ── Tab Valider manuellement ── */}
      {tab === "validate" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 700 }}>
          <div style={{ background: "var(--surface-2)", borderRadius: 12, padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
              Valider un skill manuellement
            </div>

            <div>
              <label style={{ fontSize: 12, color: "var(--text-3)", display: "block", marginBottom: 6 }}>
                Nom du skill <span style={{ color: "var(--red)" }}>*</span>
              </label>
              <input
                value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="ex: auto_git_commit  (doit exister dans skills/ ou fournir le code)"
                style={{
                  width: "100%", padding: "8px 12px", borderRadius: 8,
                  background: "var(--surface)", border: "1px solid var(--border)",
                  color: "var(--text)", fontSize: 13, boxSizing: "border-box",
                }}
              />
            </div>

            <div>
              <label style={{ fontSize: 12, color: "var(--text-3)", display: "block", marginBottom: 6 }}>
                Code <span style={{ color: "var(--text-3)" }}>(optionnel — si absent, lit skills/{"{nom}"}/skill.js)</span>
              </label>
              <textarea
                value={form.code}
                onChange={e => setForm(p => ({ ...p, code: e.target.value }))}
                placeholder={`// Skill: mon_skill\nexport async function run({ param = "default" } = {}) {\n  try {\n    return { success: true, result: "ok" };\n  } catch(e) {\n    return { success: false, error: e.message };\n  }\n}`}
                rows={8}
                style={{
                  width: "100%", padding: "10px 12px", borderRadius: 8,
                  background: "var(--surface)", border: "1px solid var(--border)",
                  color: "var(--text)", fontSize: 12, fontFamily: "monospace",
                  resize: "vertical", boxSizing: "border-box",
                }}
              />
            </div>

            <button
              onClick={handleValidate}
              disabled={formLoading || !form.name.trim()}
              style={{
                padding: "10px 20px", borderRadius: 8, border: "none",
                background: "var(--primary)", color: "white",
                fontSize: 13, cursor: "pointer", fontWeight: 600,
                opacity: formLoading || !form.name.trim() ? 0.6 : 1,
              }}
            >{formLoading ? "Validation en cours…" : "🔬 Lancer la validation"}</button>
          </div>

          {/* Résultat */}
          {formResult && (
            <div style={{ background: "var(--surface-2)", borderRadius: 12, padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: 18 }}>{formResult.passed ? "✅" : "❌"}</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>
                  {formResult.passed ? "Validation réussie" : "Validation échouée"}
                  {formResult.deployed ? " — déployé ✓" : ""}
                  {formResult.quarantined ? " — mis en quarantaine 🔒" : ""}
                </span>
              </div>
              {formResult.error && (
                <div style={{ color: "#f38ba8", fontSize: 12, marginBottom: 10 }}>{formResult.error}</div>
              )}
              {formResult.checks && (
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {CHECK_NAMES.map(n => (
                    <CheckRow key={n} name={n} result={formResult.checks[n]} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Tab Quarantaine ── */}
      {tab === "quarantine" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {quarantine.length === 0 ? (
            <div style={{ textAlign: "center", color: "var(--text-3)", padding: 40, fontSize: 13 }}>
              Aucun skill en quarantaine. 🎉
            </div>
          ) : quarantine.map(q => (
            <div key={q.name} style={{
              background: "var(--surface-2)", borderRadius: 10, padding: "14px 16px",
              border: "1px solid rgba(249,226,175,0.2)",
              display: "flex", alignItems: "center", gap: 12,
            }}>
              <span style={{ fontSize: 18 }}>🔒</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{q.name}</div>
                {q.desc && <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{q.desc}</div>}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => handleRevalidate(q.name)}
                  style={{
                    padding: "5px 12px", borderRadius: 6,
                    background: "var(--surface)", border: "1px solid var(--border)",
                    color: "var(--text-2)", fontSize: 11, cursor: "pointer",
                  }}
                >🔬 Re-valider</button>
                <button
                  onClick={() => handleRestore(q.name)}
                  style={{
                    padding: "5px 12px", borderRadius: 6,
                    background: "rgba(249,226,175,0.12)", border: "1px solid rgba(249,226,175,0.3)",
                    color: "#f9e2af", fontSize: 11, cursor: "pointer",
                  }}
                >⚠️ Restaurer</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Tab Pipeline ── */}
      {tab === "pipeline" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 13, color: "var(--text-2)", marginBottom: 4 }}>
            Boucle fermée Phase 15→17 : Miner identifie gap → Evolution génère → <strong>Validator valide</strong> → deploy/quarantine
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              { step: 1, icon: "⛏", name: "Behavior Miner :8012",   desc: "Analyse épisodes, détecte skill gaps (gap_score > 1.0)" },
              { step: 2, icon: "🧬", name: "Evolution :8005",         desc: "Génère skill.js + manifest.json via LLM (Brain /raw)" },
              { step: 3, icon: "🔬", name: "Validator :8014 ← NEW",  desc: "5 checks : syntax → structure → security → execution → output", highlight: true },
              { step: 4, icon: "📦", name: "Skills Registry",         desc: "Si validé : validated_at ajouté, skill actif dans la ruche" },
              { step: 5, icon: "🔒", name: "Quarantaine",             desc: "Si échec : skills/_quarantine/ + retiré du registry" },
              { step: 6, icon: "📡", name: "Bus Phéromone",           desc: "skill_validated / skill_quarantined émis dans signals.jsonl" },
            ].map(s => (
              <div key={s.step} style={{
                display: "flex", alignItems: "flex-start", gap: 12,
                padding: "12px 16px", borderRadius: 10,
                background: s.highlight ? "rgba(203,166,247,0.08)" : "var(--surface-2)",
                border: s.highlight ? "1px solid rgba(203,166,247,0.3)" : "1px solid var(--border)",
              }}>
                <div style={{
                  width: 24, height: 24, borderRadius: "50%",
                  background: s.highlight ? "rgba(203,166,247,0.2)" : "var(--surface)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11, fontWeight: 700,
                  color: s.highlight ? "#cba6f7" : "var(--text-3)",
                  flexShrink: 0,
                }}>{s.step}</div>
                <span style={{ fontSize: 18, width: 22, flexShrink: 0 }}>{s.icon}</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: s.highlight ? "#cba6f7" : "var(--text)" }}>
                    {s.name}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{s.desc}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Les 5 checks */}
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 10 }}>
              Les 5 checks du pipeline
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
              {CHECK_NAMES.map(n => {
                const m = CHECK_META[n];
                return (
                  <div key={n} style={{
                    background: "var(--surface-2)", borderRadius: 8, padding: "12px 14px",
                    display: "flex", gap: 8,
                  }}>
                    <span style={{ fontSize: 18 }}>{m.icon}</span>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{m.label}</div>
                      <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>{m.desc}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
