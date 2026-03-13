/**
 * Skills.jsx — Gestion des skills LaRuche
 * Liste, test, suppression, création avec génération IA
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

// ─── Modal Tester un skill ────────────────────────────────────────────────────
function TestModal({ skill, onClose }) {
  const [params,  setParams]  = useState("{}");
  const [result,  setResult]  = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [paramsErr, setParamsErr] = useState(null);

  const runSkill = async () => {
    let parsedParams;
    try {
      parsedParams = JSON.parse(params);
    } catch (e) {
      setParamsErr("JSON invalide : " + e.message);
      return;
    }
    setParamsErr(null);
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`${QUEEN_API}/api/skills/${skill.name}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsedParams),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      setResult(d);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
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
        width: "100%", maxWidth: 560,
        boxShadow: "var(--shadow-lg)", animation: "slideUp 0.2s ease",
        display: "flex", flexDirection: "column", gap: 16,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 2 }}>
              Tester : {skill.name}
            </h2>
            {skill.description && (
              <p style={{ fontSize: 12, color: "var(--text-3)" }}>{skill.description}</p>
            )}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-3)", cursor: "pointer", fontSize: 20, padding: "0 4px" }}>×</button>
        </div>

        {/* Paramètres JSON */}
        <div>
          <label style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 500, display: "block", marginBottom: 6 }}>
            Paramètres (JSON)
          </label>
          <textarea
            value={params}
            onChange={e => { setParams(e.target.value); setParamsErr(null); }}
            rows={4}
            spellCheck={false}
            style={{
              width: "100%", background: "var(--surface-2)",
              border: `1px solid ${paramsErr ? "var(--red)" : "var(--border-2)"}`,
              borderRadius: "var(--radius)", color: "var(--text)",
              padding: "10px 12px", fontSize: 12,
              fontFamily: "JetBrains Mono, monospace",
              resize: "vertical", outline: "none", lineHeight: 1.6,
            }}
          />
          {paramsErr && <div style={{ fontSize: 11, color: "var(--red)", marginTop: 4 }}>{paramsErr}</div>}
        </div>

        {/* Bouton run */}
        <button onClick={runSkill} disabled={loading} style={{
          padding: "9px", borderRadius: "var(--radius)", border: "none",
          background: loading ? "var(--surface-3)" : "var(--primary)",
          color: loading ? "var(--text-3)" : "white",
          fontSize: 13, fontWeight: 500,
          cursor: loading ? "not-allowed" : "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          transition: "background 0.15s",
        }}>
          {loading && (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
              style={{ animation: "spin 1s linear infinite" }}>
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          )}
          {loading ? "Exécution..." : "Lancer le skill"}
        </button>

        {/* Erreur */}
        {error && (
          <div style={{
            padding: "10px 14px", background: "rgba(248,113,113,0.07)",
            border: "1px solid rgba(248,113,113,0.2)", borderRadius: "var(--radius)",
            fontSize: 12, color: "var(--red)",
          }}>
            ⚠ {error}
          </div>
        )}

        {/* Résultat */}
        {result && (
          <div>
            <div style={{ fontSize: 11, color: "var(--green)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
              Résultat
            </div>
            <pre style={{
              background: "var(--surface-2)", border: "1px solid var(--border)",
              borderRadius: "var(--radius)", padding: "12px",
              fontSize: 11, color: "var(--text-2)",
              fontFamily: "JetBrains Mono, monospace",
              whiteSpace: "pre-wrap", wordBreak: "break-word",
              maxHeight: 200, overflowY: "auto", lineHeight: 1.6,
            }}>
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Modal Créer un skill ─────────────────────────────────────────────────────
function CreateModal({ onClose, onCreated }) {
  const [name,        setName]        = useState("");
  const [description, setDescription] = useState("");
  const [generating,  setGenerating]  = useState(false);
  const [genResult,   setGenResult]   = useState(null);
  const [error,       setError]       = useState(null);

  const generateWithAI = async () => {
    if (!name.trim()) { setError("Le nom du skill est requis"); return; }
    setGenerating(true);
    setError(null);
    setGenResult(null);
    try {
      const prompt = `Génère un skill LaRuche nommé "${name.trim()}". ${description ? `Description : ${description}` : ""}
Le skill doit être un script Node.js autonome avec une fonction principale exportée.
Inclus : gestion d'erreurs, documentation JSDoc, exemples d'utilisation.`;

      const res = await fetch(`${QUEEN_API}/api/mission`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: prompt }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      const d = await res.json();
      setGenResult(`Mission lancée : ${d.missionId || "OK"}\nLe skill sera disponible après complétion.`);
      setTimeout(() => { onCreated?.(); onClose(); }, 2500);
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
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
        width: "100%", maxWidth: 500,
        boxShadow: "var(--shadow-lg)", animation: "slideUp 0.2s ease",
        display: "flex", flexDirection: "column", gap: 16,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)" }}>Créer un skill</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-3)", cursor: "pointer", fontSize: 20, padding: "0 4px" }}>×</button>
        </div>

        {error && (
          <div style={{
            padding: "8px 12px", background: "rgba(248,113,113,0.06)",
            border: "1px solid rgba(248,113,113,0.15)", borderRadius: "var(--radius-sm)",
            fontSize: 12, color: "var(--red)",
          }}>
            ⚠ {error}
          </div>
        )}

        <div>
          <label style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 500, display: "block", marginBottom: 6 }}>
            Nom du skill *
          </label>
          <input
            value={name}
            onChange={e => { setName(e.target.value); setError(null); }}
            placeholder="ex: scrape-prices"
            style={{
              width: "100%", background: "var(--surface-2)",
              border: "1px solid var(--border-2)", borderRadius: "var(--radius)",
              color: "var(--text)", padding: "9px 12px", fontSize: 13,
              fontFamily: "inherit", outline: "none",
            }}
          />
        </div>

        <div>
          <label style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 500, display: "block", marginBottom: 6 }}>
            Description (optionnelle)
          </label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Ce que fait le skill..."
            rows={3}
            style={{
              width: "100%", background: "var(--surface-2)",
              border: "1px solid var(--border-2)", borderRadius: "var(--radius)",
              color: "var(--text)", padding: "9px 12px", fontSize: 13,
              fontFamily: "inherit", resize: "vertical", outline: "none",
            }}
          />
        </div>

        {genResult && (
          <div style={{
            padding: "10px 14px", background: "rgba(74,222,128,0.07)",
            border: "1px solid rgba(74,222,128,0.2)", borderRadius: "var(--radius)",
            fontSize: 12, color: "var(--green)", lineHeight: 1.6,
            fontFamily: "monospace", whiteSpace: "pre-wrap",
          }}>
            {genResult}
          </div>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{
            flex: 1, padding: "9px", borderRadius: "var(--radius)",
            border: "1px solid var(--border-2)", background: "none",
            color: "var(--text-2)", cursor: "pointer", fontSize: 13, fontWeight: 500,
          }}>
            Annuler
          </button>
          <button onClick={generateWithAI} disabled={!name.trim() || generating} style={{
            flex: 2, padding: "9px", borderRadius: "var(--radius)", border: "none",
            background: name.trim() && !generating ? "var(--primary)" : "var(--surface-3)",
            color: name.trim() && !generating ? "white" : "var(--text-3)",
            cursor: name.trim() && !generating ? "pointer" : "not-allowed",
            fontSize: 13, fontWeight: 500,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
            transition: "background 0.15s",
          }}>
            {generating && (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                style={{ animation: "spin 1s linear infinite" }}>
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            )}
            {generating ? "Génération en cours..." : "Générer avec l'IA"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Confirmation suppression ─────────────────────────────────────────────────
function ConfirmDeleteModal({ skill, onClose, onConfirm }) {
  const [loading, setLoading] = useState(false);

  const confirm = async () => {
    setLoading(true);
    await onConfirm();
    setLoading(false);
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1001,
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
        <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>
          Supprimer "{skill.name}" ?
        </h2>
        <p style={{ fontSize: 13, color: "var(--text-3)", lineHeight: 1.6, marginBottom: 20 }}>
          Cette action est irréversible. Le skill sera définitivement supprimé.
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
            {loading ? "Suppression..." : "Supprimer"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Skills ───────────────────────────────────────────────────────────────────
export default function Skills() {
  const [skills,       setSkills]       = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(null);
  const [testSkill,    setTestSkill]    = useState(null);
  const [createOpen,   setCreateOpen]   = useState(false);
  const [deleteSkill,  setDeleteSkill]  = useState(null);

  const fetchSkills = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`${QUEEN_API}/api/skills`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setSkills(d.skills || d || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  const handleDelete = async (skill) => {
    try {
      await fetch(`${QUEEN_API}/api/skills/${skill.name}`, { method: "DELETE" });
      setDeleteSkill(null);
      fetchSkills();
    } catch (err) {
      setError(err.message);
    }
  };

  const fmt = (date) => {
    if (!date) return "";
    try { return new Date(date).toLocaleDateString("fr-FR", { dateStyle: "short" }); } catch { return ""; }
  };

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px", display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.02em", marginBottom: 4 }}>
            Skills
          </h1>
          <p style={{ fontSize: 13, color: "var(--text-3)" }}>
            {loading ? "Chargement..." : `${skills.length} skill(s) disponible(s)`}
          </p>
        </div>
        <button onClick={() => setCreateOpen(true)} style={{
          padding: "8px 18px", borderRadius: "var(--radius)", border: "none",
          background: "var(--primary)", color: "white",
          fontSize: 13, fontWeight: 500, cursor: "pointer",
          display: "flex", alignItems: "center", gap: 7,
          transition: "background 0.15s",
        }}
          onMouseEnter={e => e.currentTarget.style.background = "var(--primary-hover)"}
          onMouseLeave={e => e.currentTarget.style.background = "var(--primary)"}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Créer un skill
        </button>
      </div>

      {/* Erreur */}
      {error && (
        <div style={{
          padding: "10px 16px", background: "rgba(248,113,113,0.07)",
          border: "1px solid rgba(248,113,113,0.2)", borderRadius: "var(--radius)",
          fontSize: 13, color: "var(--red)",
        }}>
          ⚠ {error}
        </div>
      )}

      {/* Liste skills */}
      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[...Array(4)].map((_, i) => <Skeleton key={i} h={80} radius={12} />)}
        </div>
      ) : skills.length === 0 ? (
        <div style={{
          padding: "60px 32px", textAlign: "center",
          color: "var(--text-3)", fontSize: 14,
          background: "var(--surface-2)", border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
        }}>
          Aucun skill disponible — cliquez sur "Créer un skill" pour commencer
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {skills.map((skill, i) => (
            <div key={skill.name || i} style={{
              background: "var(--surface-2)", border: "1px solid var(--border)",
              borderRadius: "var(--radius-lg)", padding: "16px 20px",
              display: "flex", alignItems: "center", gap: 16,
              animation: "slideUp 0.15s ease",
              transition: "border-color 0.15s",
            }}
              onMouseEnter={e => e.currentTarget.style.borderColor = "var(--border-2)"}
              onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border)"}
            >
              {/* Icône */}
              <div style={{
                width: 40, height: 40, borderRadius: "var(--radius)",
                background: "var(--primary-dim)", border: "1px solid rgba(224,123,84,0.2)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 18, flexShrink: 0,
              }}>
                🔧
              </div>

              {/* Infos */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", fontFamily: "monospace" }}>
                    {skill.name}
                  </span>
                  {skill.version && (
                    <span style={{
                      fontSize: 10, color: "var(--text-3)",
                      background: "var(--surface-3)", padding: "1px 7px",
                      borderRadius: 20, border: "1px solid var(--border)",
                    }}>
                      v{skill.version}
                    </span>
                  )}
                  {skill.autoGenerated && (
                    <span style={{
                      fontSize: 10, color: "var(--violet)",
                      background: "rgba(99,102,241,0.1)", padding: "1px 7px",
                      borderRadius: 20, border: "1px solid rgba(99,102,241,0.25)",
                    }}>
                      auto-generated
                    </span>
                  )}
                </div>
                {skill.description && (
                  <div style={{
                    fontSize: 12, color: "var(--text-3)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {skill.description}
                  </div>
                )}
                {skill.createdAt && (
                  <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 3 }}>
                    Créé le {fmt(skill.createdAt)}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <button onClick={() => setTestSkill(skill)} style={{
                  padding: "6px 14px", borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--border-2)", background: "none",
                  color: "var(--text-2)", fontSize: 12, fontWeight: 500,
                  cursor: "pointer", transition: "all 0.15s",
                }}
                  onMouseEnter={e => { e.currentTarget.style.background = "var(--surface-3)"; e.currentTarget.style.color = "var(--text)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-2)"; }}
                >
                  Tester
                </button>
                <button onClick={() => setDeleteSkill(skill)} style={{
                  padding: "6px 10px", borderRadius: "var(--radius-sm)",
                  border: "1px solid rgba(248,113,113,0.25)",
                  background: "rgba(248,113,113,0.06)",
                  color: "var(--red)", fontSize: 12, cursor: "pointer",
                  transition: "all 0.15s",
                }}
                  onMouseEnter={e => { e.currentTarget.style.background = "rgba(248,113,113,0.14)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "rgba(248,113,113,0.06)"; }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modals */}
      {testSkill   && <TestModal skill={testSkill} onClose={() => setTestSkill(null)} />}
      {createOpen  && <CreateModal onClose={() => setCreateOpen(false)} onCreated={fetchSkills} />}
      {deleteSkill && (
        <ConfirmDeleteModal
          skill={deleteSkill}
          onClose={() => setDeleteSkill(null)}
          onConfirm={() => handleDelete(deleteSkill)}
        />
      )}
    </div>
  );
}
