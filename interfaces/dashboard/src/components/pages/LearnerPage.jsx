/**
 * LearnerPage.jsx — Apprentissage automatique de skills depuis les épisodes
 * Interface pour le service Learner (:8009) — extrait des skills réutilisables
 * depuis les épisodes mémoire réussis via Brain (:8003)
 */
import React, { useState, useEffect, useCallback, useRef } from "react";

// ─── Constantes de style ──────────────────────────────────────────────────────

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

const LEARNER_API = "http://localhost:8009";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt_relative(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
    const diff = Date.now() - d.getTime();
    if (diff < 60000) return "à l'instant";
    if (diff < 3600000) return `il y a ${Math.floor(diff / 60000)}min`;
    if (diff < 86400000) return `il y a ${Math.floor(diff / 3600000)}h`;
    return `il y a ${Math.floor(diff / 86400000)}j`;
  } catch { return iso.slice(0, 16); }
}

function fmt_date(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })
      + " " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  } catch { return iso.slice(0, 16); }
}

function fmt_ms(ms) {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s`;
}

function trunc(str, n) {
  if (!str) return "—";
  return str.length > n ? str.slice(0, n) + "…" : str;
}

// ─── Composants atomiques ─────────────────────────────────────────────────────

function StatCard({ label, value, sub, color }) {
  return (
    <div style={{
      background: S.surface, border: `1px solid ${S.border}`,
      borderRadius: 10, padding: "14px 18px", flex: 1, minWidth: 130,
    }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || S.primary }}>{value}</div>
      <div style={{ fontSize: 12, color: S.text2, marginTop: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: S.text3, marginTop: 1 }}>{sub}</div>}
    </div>
  );
}

function Badge({ label, color, textColor = "white" }) {
  return (
    <span style={{
      background: color, color: textColor,
      borderRadius: 5, padding: "2px 7px", fontSize: 10, fontWeight: 700,
      letterSpacing: "0.04em", flexShrink: 0,
    }}>{label}</span>
  );
}

function Spinner({ size = 14 }) {
  return (
    <span style={{
      display: "inline-block", fontSize: size,
      animation: "spin 1s linear infinite",
    }}>⟳</span>
  );
}

function EmptyState({ message }) {
  return (
    <div style={{
      textAlign: "center", color: S.text3, padding: "48px 24px",
      background: S.surface, borderRadius: 12, border: `1px solid ${S.border}`,
      fontSize: 13,
    }}>{message}</div>
  );
}

// ─── Onglet Apprentissage ─────────────────────────────────────────────────────

function TabApprentissage({ stats, loadingStats, onRefreshStats }) {
  const [scanning, setScanning]   = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [scanError, setScanError]   = useState(null);

  const triggerScan = useCallback(async () => {
    setScanning(true);
    setScanResult(null);
    setScanError(null);
    try {
      const r = await fetch(`${LEARNER_API}/learn/trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 50 }),
      });
      const data = await r.json();
      setScanResult(data);
      onRefreshStats();
    } catch (e) {
      setScanError(e.message);
    } finally {
      setScanning(false);
    }
  }, [onRefreshStats]);

  const scanned  = stats?.episodes_scanned ?? stats?.total_scanned ?? "—";
  const learned  = stats?.skills_learned   ?? stats?.total_learned  ?? "—";
  const validated = stats?.validation_rate != null
    ? `${Math.round(stats.validation_rate * 100)}%`
    : (stats?.validated_pct != null ? `${stats.validated_pct}%` : "—");
  const lastScan = stats?.last_scan ?? stats?.last_scan_at ?? null;

  return (
    <div>
      {/* Stats bar */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24 }}>
        <StatCard
          label="Épisodes scannés"
          value={loadingStats ? "…" : scanned}
          sub="total analysés"
        />
        <StatCard
          label="Skills générés"
          value={loadingStats ? "…" : learned}
          sub="extraits des épisodes"
          color={S.green}
        />
        <StatCard
          label="Taux validation"
          value={loadingStats ? "…" : validated}
          sub="syntaxe + structure"
          color={S.amber}
        />
        <StatCard
          label="Dernier scan"
          value={loadingStats ? "…" : fmt_relative(lastScan)}
          sub={lastScan ? fmt_date(lastScan) : "jamais lancé"}
          color={S.text2}
        />
      </div>

      {/* Action scan */}
      <div style={{
        background: S.surface, border: `1px solid ${S.border}`,
        borderRadius: 12, padding: "20px 24px", marginBottom: 16,
      }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: S.text, marginBottom: 6 }}>
          Scan des épisodes
        </div>
        <div style={{ fontSize: 12, color: S.text3, marginBottom: 16 }}>
          Analyse les 50 derniers épisodes réussis et extrait les patterns réutilisables en tant que skills Node.js ESM.
        </div>

        <button
          onClick={triggerScan}
          disabled={scanning}
          style={{
            background: scanning
              ? S.surface2
              : `rgba(224,123,84,0.15)`,
            border: `1px solid ${S.primary}`,
            borderRadius: 8, padding: "10px 22px",
            fontSize: 13, fontWeight: 700, cursor: scanning ? "not-allowed" : "pointer",
            color: scanning ? S.text3 : S.primary,
            display: "flex", alignItems: "center", gap: 8,
          }}
        >
          {scanning ? (
            <><Spinner /> Scanning en cours…</>
          ) : (
            "⚡ Scanner maintenant"
          )}
        </button>
      </div>

      {/* Résultat scan */}
      {scanResult && !scanError && (
        <div style={{
          padding: "14px 18px", borderRadius: 10,
          background: "rgba(34,197,94,0.06)",
          border: `1px solid ${S.green}`,
          fontSize: 13, color: S.text,
        }}>
          <span style={{ color: S.green, fontWeight: 700 }}>Scan terminé — </span>
          {scanResult.learned ?? scanResult.skills ?? 0} nouveaux skills extraits
          {" "}depuis{" "}
          {scanResult.scanned ?? scanResult.episodes ?? 0} épisodes analysés
          {scanResult.errors > 0 && (
            <span style={{ color: S.amber, marginLeft: 12 }}>
              ({scanResult.errors} erreur(s))
            </span>
          )}
        </div>
      )}

      {scanError && (
        <div style={{
          padding: "12px 16px", borderRadius: 10,
          background: "rgba(239,68,68,0.07)",
          border: `1px solid ${S.red}`,
          fontSize: 12, color: S.red,
        }}>
          Erreur scan : {scanError}
        </div>
      )}
    </div>
  );
}

// ─── Onglet Skills appris ─────────────────────────────────────────────────────

function LearnedSkillCard({ skill, onNavigateEvolution }) {
  const syntaxOk = skill.syntax_ok !== false && skill.syntax_error == null;
  const ts = skill.learned_at ?? skill.created_at ?? skill.timestamp ?? null;

  return (
    <div style={{
      background: S.surface, border: `1px solid ${S.border}`,
      borderRadius: 10, padding: "14px 16px",
      borderLeft: `3px solid ${syntaxOk ? S.green : S.red}`,
    }}>
      {/* Ligne 1 : nom + badges */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
        <span style={{
          fontFamily: S.mono, fontSize: 13, fontWeight: 700, color: S.text,
        }}>{skill.name ?? skill.skill_name ?? "—"}</span>
        {(skill.version || skill.v) && (
          <Badge
            label={`v${skill.version ?? skill.v}`}
            color={S.surface2}
            textColor={S.text2}
          />
        )}
        <Badge
          label={syntaxOk ? "SYNTAX OK" : "SYNTAX ERROR"}
          color={syntaxOk ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)"}
          textColor={syntaxOk ? S.green : S.red}
        />
        {ts && (
          <span style={{ fontSize: 11, color: S.text3, marginLeft: "auto" }}>
            {fmt_relative(ts)}
          </span>
        )}
      </div>

      {/* Source mission */}
      {skill.source_mission && (
        <div style={{ fontSize: 11, color: S.text3, marginBottom: 4, fontStyle: "italic" }}>
          Source : {trunc(skill.source_mission, 80)}
        </div>
      )}

      {/* Goal / description */}
      {(skill.goal ?? skill.description) && (
        <div style={{ fontSize: 12, color: S.text2, marginBottom: 8 }}>
          {trunc(skill.goal ?? skill.description, 120)}
        </div>
      )}

      {/* Syntax error detail */}
      {!syntaxOk && skill.syntax_error && (
        <div style={{
          fontSize: 11, color: S.red, fontFamily: S.mono,
          background: "rgba(239,68,68,0.07)", borderRadius: 6,
          padding: "6px 8px", marginBottom: 8,
        }}>
          {skill.syntax_error}
        </div>
      )}

      {/* Lien vers Evolution */}
      <button
        onClick={onNavigateEvolution}
        style={{
          background: "transparent", border: "none",
          color: S.primary, fontSize: 11, cursor: "pointer",
          padding: 0, fontWeight: 600,
        }}
        onMouseEnter={e => { e.currentTarget.style.textDecoration = "underline"; }}
        onMouseLeave={e => { e.currentTarget.style.textDecoration = "none"; }}
      >
        Voir code →
      </button>
    </div>
  );
}

function TabSkillsAppris({ onNavigate }) {
  const [skills, setSkills]         = useState([]);
  const [loading, setLoading]       = useState(true);
  const [filterLearnable, setFilterLearnable] = useState(false);
  const [error, setError]           = useState(null);

  const loadSkills = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${LEARNER_API}/learned-skills`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setSkills(data.skills ?? data ?? []);
    } catch (e) {
      setError(e.message);
      setSkills([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSkills(); }, [loadSkills]);

  const displayed = filterLearnable
    ? skills.filter(s => s.learnable !== false && s.syntax_ok !== false)
    : skills;

  return (
    <div>
      {/* Barre filtre + refresh */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        marginBottom: 16, flexWrap: "wrap",
      }}>
        <label style={{
          display: "flex", alignItems: "center", gap: 6,
          fontSize: 12, color: S.text2, cursor: "pointer",
        }}>
          <input
            type="checkbox"
            checked={filterLearnable}
            onChange={e => setFilterLearnable(e.target.checked)}
            style={{ accentColor: S.primary }}
          />
          Valides uniquement
        </label>
        <span style={{ fontSize: 12, color: S.text3, marginRight: "auto" }}>
          {displayed.length} skill(s)
          {filterLearnable ? " valides" : " total"}
        </span>
        <button
          onClick={loadSkills}
          disabled={loading}
          style={{
            background: S.surface2, border: `1px solid ${S.border}`,
            borderRadius: 6, padding: "5px 12px", fontSize: 12,
            cursor: "pointer", color: S.text2,
          }}
        >{loading ? "…" : "↻ Refresh"}</button>
      </div>

      {error && (
        <div style={{
          padding: "10px 14px", borderRadius: 8, marginBottom: 14,
          background: "rgba(239,68,68,0.07)", border: `1px solid ${S.red}`,
          fontSize: 12, color: S.red,
        }}>
          Erreur : {error}
        </div>
      )}

      {loading && (
        <div style={{ textAlign: "center", color: S.text3, padding: 40, fontSize: 13 }}>
          <Spinner size={18} /> Chargement…
        </div>
      )}

      {!loading && displayed.length === 0 && (
        <EmptyState message="Aucun skill appris — lancer un scan depuis l'onglet Apprentissage" />
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {!loading && displayed.map((skill, i) => (
          <LearnedSkillCard
            key={skill.name ?? i}
            skill={skill}
            onNavigateEvolution={() => onNavigate && onNavigate("evolution")}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Onglet Épisodes analysables ──────────────────────────────────────────────

function EpisodeRow({ episode, learnedMissions, onLearn, learningMission }) {
  const isLearned = learnedMissions.has(episode.mission);
  const isLearning = learningMission === episode.mission;
  const ts = episode.timestamp ?? episode.created_at ?? null;

  return (
    <div style={{
      background: S.surface, border: `1px solid ${S.border}`,
      borderRadius: 10, padding: "12px 14px",
      display: "flex", alignItems: "flex-start", gap: 12,
      borderLeft: `3px solid ${isLearned ? S.green : S.border}`,
    }}>
      {/* Contenu */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: S.text, fontWeight: 500, marginBottom: 4 }}>
          {trunc(episode.mission, 80)}
        </div>
        <div style={{
          display: "flex", gap: 12, fontSize: 11, color: S.text3, flexWrap: "wrap",
        }}>
          {episode.duration_ms > 0 && <span>{fmt_ms(episode.duration_ms)}</span>}
          {episode.model_used && <span>{episode.model_used.split("/").pop()}</span>}
          {ts && <span>{fmt_relative(ts)}</span>}
        </div>
      </div>

      {/* Badge + bouton */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        {isLearned && (
          <Badge
            label="APPRIS"
            color="rgba(34,197,94,0.15)"
            textColor={S.green}
          />
        )}
        <button
          onClick={() => !isLearned && !isLearning && onLearn(episode.mission)}
          disabled={isLearned || isLearning}
          style={{
            background: isLearned
              ? "transparent"
              : isLearning
                ? S.surface2
                : `rgba(224,123,84,0.12)`,
            border: `1px solid ${isLearned ? S.border : S.primary}`,
            borderRadius: 6, padding: "5px 12px",
            fontSize: 11, fontWeight: 600,
            cursor: isLearned || isLearning ? "not-allowed" : "pointer",
            color: isLearned ? S.text3 : S.primary,
            display: "flex", alignItems: "center", gap: 5,
            opacity: isLearned ? 0.5 : 1,
          }}
        >
          {isLearning ? <><Spinner size={11} /> Apprentissage…</> : "Apprendre"}
        </button>
      </div>
    </div>
  );
}

function TabEpisodes() {
  const [episodes, setEpisodes]         = useState([]);
  const [learnedSkills, setLearnedSkills] = useState([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState(null);
  const [learningMission, setLearning]  = useState(null);
  const [learnResults, setLearnResults] = useState({});

  const learnedMissions = new Set(
    learnedSkills
      .map(s => s.source_mission)
      .filter(Boolean)
  );

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [epsRes, skillsRes] = await Promise.all([
        fetch("http://localhost:8003/memory/episodes?limit=30").then(r => r.json()),
        fetch(`${LEARNER_API}/learned-skills`).then(r => r.json()),
      ]);
      // Filtre épisodes success=true
      const allEps = epsRes.episodes ?? epsRes ?? [];
      setEpisodes(allEps.filter(ep =>
        ep.success === true || ep.success === "true" || ep.success === 1
      ));
      setLearnedSkills(skillsRes.skills ?? skillsRes ?? []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const onLearn = useCallback(async (mission) => {
    setLearning(mission);
    try {
      const r = await fetch(`${LEARNER_API}/learn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mission }),
      });
      const data = await r.json();
      setLearnResults(prev => ({ ...prev, [mission]: data }));
      // Rafraîchit les skills appris pour mettre à jour les badges
      const skillsRes = await fetch(`${LEARNER_API}/learned-skills`).then(r => r.json());
      setLearnedSkills(skillsRes.skills ?? skillsRes ?? []);
    } catch (e) {
      setLearnResults(prev => ({ ...prev, [mission]: { error: e.message } }));
    } finally {
      setLearning(null);
    }
  }, []);

  return (
    <div>
      {/* Header + refresh */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 14, flexWrap: "wrap", gap: 8,
      }}>
        <span style={{ fontSize: 12, color: S.text3 }}>
          {episodes.length} épisode(s) réussis · prêts pour apprentissage
        </span>
        <button
          onClick={loadAll}
          disabled={loading}
          style={{
            background: S.surface2, border: `1px solid ${S.border}`,
            borderRadius: 6, padding: "5px 12px", fontSize: 12,
            cursor: "pointer", color: S.text2,
          }}
        >{loading ? "…" : "↻ Refresh"}</button>
      </div>

      {error && (
        <div style={{
          padding: "10px 14px", borderRadius: 8, marginBottom: 14,
          background: "rgba(239,68,68,0.07)", border: `1px solid ${S.red}`,
          fontSize: 12, color: S.red,
        }}>
          Erreur de chargement : {error}
        </div>
      )}

      {/* Résultats d'apprentissage inline */}
      {Object.entries(learnResults).length > 0 && (
        <div style={{ marginBottom: 14, display: "flex", flexDirection: "column", gap: 6 }}>
          {Object.entries(learnResults).map(([mission, result]) => (
            <div key={mission} style={{
              padding: "8px 12px", borderRadius: 8, fontSize: 11,
              background: result.error
                ? "rgba(239,68,68,0.07)"
                : "rgba(34,197,94,0.07)",
              border: `1px solid ${result.error ? S.red : S.green}`,
              color: result.error ? S.red : S.green,
            }}>
              {result.error
                ? `Erreur : ${result.error}`
                : `Skill extrait depuis « ${trunc(mission, 50)} »`
              }
            </div>
          ))}
        </div>
      )}

      {loading && (
        <div style={{ textAlign: "center", color: S.text3, padding: 40, fontSize: 13 }}>
          <Spinner size={18} /> Chargement…
        </div>
      )}

      {!loading && episodes.length === 0 && (
        <EmptyState message="Aucun épisode réussi trouvé — lancez des missions pour alimenter la mémoire" />
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {!loading && episodes.map((ep, i) => (
          <EpisodeRow
            key={ep._id ?? ep.id ?? i}
            episode={ep}
            learnedMissions={learnedMissions}
            onLearn={onLearn}
            learningMission={learningMission}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Page principale ──────────────────────────────────────────────────────────

export default function LearnerPage({ status, wsEvents, onNavigate }) {
  const [tab, setTab]           = useState("apprentissage");
  const [stats, setStats]       = useState(null);
  const [loadingStats, setLoadingStats] = useState(true);

  const loadStats = useCallback(async () => {
    setLoadingStats(true);
    try {
      const r = await fetch(`${LEARNER_API}/learning-stats`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setStats(await r.json());
    } catch (e) {
      console.error("LearnerPage stats error:", e);
      setStats(null);
    } finally {
      setLoadingStats(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const tabs = [
    { id: "apprentissage", label: "Apprentissage" },
    { id: "skills",        label: "Skills appris" },
    { id: "episodes",      label: "Épisodes analysables" },
  ];

  return (
    <div style={{ padding: 24, maxWidth: 960, margin: "0 auto" }}>
      {/* ── Header ── */}
      <div style={{
        marginBottom: 20,
        display: "flex", alignItems: "flex-start",
        justifyContent: "space-between", flexWrap: "wrap", gap: 12,
      }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: S.text, margin: 0 }}>
            Learner
          </h1>
          <p style={{ fontSize: 13, color: S.text3, margin: "6px 0 0" }}>
            Extraction automatique de skills · Analyse des épisodes réussis · Service :8009
          </p>
        </div>

        {/* Status pill */}
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          background: S.surface, border: `1px solid ${S.border}`,
          borderRadius: 8, padding: "6px 14px", fontSize: 12,
        }}>
          <span style={{
            width: 7, height: 7, borderRadius: "50%",
            background: status?.learner === "ok" ? S.green : S.amber,
            display: "inline-block",
          }} />
          <span style={{ color: S.text2 }}>
            {status?.learner === "ok" ? "Connecté" : "En attente"}
          </span>
          <span style={{ color: S.text3 }}>:8009</span>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div style={{
        display: "flex", gap: 0,
        borderBottom: `1px solid ${S.border}`,
        marginBottom: 24,
      }}>
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              background: "transparent", border: "none", cursor: "pointer",
              padding: "9px 20px", fontSize: 13,
              fontWeight: tab === t.id ? 700 : 400,
              color: tab === t.id ? S.primary : S.text2,
              borderBottom: `2px solid ${tab === t.id ? S.primary : "transparent"}`,
              marginBottom: -1,
              transition: "color 0.15s",
            }}
            onMouseEnter={e => {
              if (tab !== t.id) e.currentTarget.style.color = S.text;
            }}
            onMouseLeave={e => {
              if (tab !== t.id) e.currentTarget.style.color = S.text2;
            }}
          >{t.label}</button>
        ))}
      </div>

      {/* ── Contenu ── */}
      {tab === "apprentissage" && (
        <TabApprentissage
          stats={stats}
          loadingStats={loadingStats}
          onRefreshStats={loadStats}
        />
      )}
      {tab === "skills" && (
        <TabSkillsAppris onNavigate={onNavigate} />
      )}
      {tab === "episodes" && (
        <TabEpisodes />
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
