import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "./supabase";

/* * ─── NOTA PARA EL INGENIERO ──────────────────────────────────────────────
 * Para que las nuevas analíticas funcionen al 100%, ejecuta esto en tu 
 * SQL Editor de Supabase (aunque la app no romperá si no lo haces):
 * * ALTER TABLE sessions ADD COLUMN IF NOT EXISTS rating INT DEFAULT 3;
 * ALTER TABLE sessions ADD COLUMN IF NOT EXISTS duration_ms BIGINT;
 * ──────────────────────────────────────────────────────────────────────────
 */

// ─── CONSTANTES ──────────────────────────────────────────────────────────────
const RULES = {
  cash: [
    "Stop-loss por sesión: máximo 3 buyins ($6 USD)",
    "Si el bankroll baja a $30, paras la semana",
    "Si el bankroll baja a $25, dejas de jugar hasta recargar",
    "Máximo 2 horas por sesión en un solo bloque",
    "No jugar con menos de 6 horas de sueño",
    "Stop-loss emocional: si sientes tilt, cierra inmediatamente",
  ],
  tournament: [
    "Máximo 5% del bankroll por torneo ($2.50 con $50)",
    "Máximo 3 torneos al día",
    "No re-entry si ya perdiste 2 torneos en el día",
    "Registra resultado antes de abrir otro torneo",
    "Si pierdes 5 seguidos, pausa 24h",
  ],
  sports: [
    "Máximo 5% del bankroll por apuesta",
    "Solo mercados donde tengas criterio real",
    "No apuestas en vivo si llevas sesión perdedora",
    "Máximo 2 apuestas activas simultáneas",
    "No apostar para recuperar pérdidas del día",
  ],
  casino: [
    "BLACKJACK — PROHIBIDO",
    "BACCARAT — PROHIBIDO",
    "RULETA — PROHIBIDO",
    "SLOTS — PROHIBIDO",
    "Regla absoluta. Sin excepciones.",
  ],
};

const POKER_LADDER = [
  { at: 100, label: "NL5" },
  { at: 250, label: "NL10" },
  { at: 500, label: "NL25" },
];

const TILT_QS = [
  { id: "sleep", label: "6h+ sueño", icon: "🌙" },
  { id: "calm", label: "Calmado", icon: "🧘" },
  { id: "noAlcohol", label: "Sin alcohol", icon: "🚫" },
  { id: "notChasing", label: "Sin urgencia", icon: "🎯" },
  { id: "ate", label: "Comí bien", icon: "🍽" },
];

const POSITIONS = ["UTG", "MP", "HJ", "CO", "BTN", "SB", "BB", "General"];

const ACCENT_PRESETS = [
  { name: "Azul", v: "#60a5fa" },
  { name: "Esmeralda", v: "#34d399" },
  { name: "Oro", v: "#fbbf24" },
  { name: "Violeta", v: "#a78bfa" },
  { name: "Rosa", v: "#f472b6" },
  { name: "Cyan", v: "#22d3ee" },
];

const QUICK_POKER = [0.5, 1, 2, 5, 10, 20];
const QUICK_SPORTS = [25, 50, 100, 200, 500];

// ─── HELPERS ────────────────────────────────────────────────────────────────
const fmt = (n, d = 2) => Number(n).toFixed(d);
const sgn = (n) => (n >= 0 ? "+" : "");

const fmtElapsed = (ms) => {
  const totalSecs = Math.floor(ms / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

const groupByDate = (arr) => {
  const map = {};
  arr.forEach((s) => {
    if (!map[s.date]) map[s.date] = [];
    map[s.date].push(s);
  });
  return Object.entries(map);
};

const getLast7DayStrings = () => {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toLocaleDateString("es-MX", { day: "2-digit", month: "short" }));
  }
  return days;
};

// ─── COLOR SYSTEM ────────────────────────────────────────────────────────────
const makeC = (accent = "#60a5fa") => ({
  bg: "#06060e",
  surface: "#0b0b1a",
  card: "#0f0f20",
  border: "#1a1a32",
  green: "#4ade80",
  greenD: "#14532d",
  red: "#f87171",
  redD: "#7f1d1d",
  accent,
  accentDim: accent + "28",
  accentMid: accent + "55",
  gold: "#fbbf24",
  goldD: "#78350f",
  muted: "#3d3d66",
  text: "#e0ddf0",
  textDim: "#6666a0",
  blue: "#60a5fa",
});

const INPUT_STYLE_BASE = {
  width: "100%",
  padding: "13px 14px",
  borderRadius: 9,
  fontSize: 15,
  fontFamily: "Georgia, serif",
  boxSizing: "border-box",
  outline: "none",
};

// ─── COMPONENTES DE APOYO ───────────────────────────────────────────────────

const Sparkline = ({ data, color, id, W = 120, H = 32 }) => {
  if (!data || data.length < 2) return null;
  const gradId = `sg-${id}-${color.replace("#", "")}`;
  const mn = Math.min(...data) - 0.5;
  const mx = Math.max(...data) + 0.5;
  const range = mx - mn || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * W},${H - ((v - mn) / range) * (H - 2) + 1}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H, display: "block", marginTop: 8 }}>
      <defs>
        <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" points={pts} />
    </svg>
  );
};

const BarChart = ({ data, C }) => {
  if (!data || data.length === 0)
    return <div style={{ textAlign: "center", color: C.textDim, padding: 24, fontSize: 12 }}>Sin datos suficientes</div>;
  const values = data.map((d) => d.value);
  const maxAbs = Math.max(...values.map(Math.abs), 0.1);
  const barH = 80;
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: barH + 36, padding: "0 4px" }}>
      {data.map((d, i) => {
        const pct = Math.abs(d.value) / maxAbs;
        const isPos = d.value >= 0;
        const h = Math.max(pct * barH, 2);
        return (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: barH + 36 }}>
            <div style={{ fontSize: 9, color: isPos ? C.green : C.red, marginBottom: 3, fontWeight: "bold" }}>
              {d.value !== 0 ? `${sgn(d.value)}${fmt(Math.abs(d.value), 1)}` : "—"}
            </div>
            <div style={{ width: "100%", height: h, background: isPos ? `linear-gradient(180deg,${C.green}cc,${C.green}44)` : `linear-gradient(0deg,${C.red}cc,${C.red}44)`, borderRadius: isPos ? "4px 4px 0 0" : "0 0 4px 4px", transition: "height 0.4s ease" }} />
            <div style={{ fontSize: 8, color: C.textDim, marginTop: 5, textAlign: "center", letterSpacing: 0.5 }}>{d.label}</div>
          </div>
        );
      })}
    </div>
  );
};

const HeatmapCalendar = ({ sessions, C, monthStr }) => {
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const firstDow = new Date(now.getFullYear(), now.getMonth(), 1).getDay();
  const dayMap = {};
  sessions.forEach((s) => {
    if (s.type === "leak" || s.type === "sports") return;
    if (!s.date.includes(monthStr)) return;
    const day = parseInt(s.date);
    if (!isNaN(day)) dayMap[day] = (dayMap[day] || 0) + s.amount;
  });
  const values = Object.values(dayMap);
  const maxAbs = values.length ? Math.max(...values.map(Math.abs), 0.01) : 0.01;
  const dayLabels = ["D", "L", "M", "X", "J", "V", "S"];
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 3, marginBottom: 6 }}>
        {dayLabels.map((d) => <div key={d} style={{ textAlign: "center", fontSize: 9, color: C.muted }}>{d}</div>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 3 }}>
        {cells.map((d, i) => {
          if (!d) return <div key={`e${i}`} />;
          const profit = dayMap[d];
          const intensity = profit !== undefined ? Math.min(Math.abs(profit) / maxAbs, 1) : 0;
          let bg = C.border;
          if (profit !== undefined) bg = profit >= 0 ? `rgba(74,222,128,${0.2 + intensity * 0.6})` : `rgba(248,113,113,${0.2 + intensity * 0.6})`;
          return <div key={d} style={{ aspectRatio: "1", borderRadius: 4, background: bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: profit !== undefined ? (profit >= 0 ? C.green : C.red) : C.textDim }}>{d}</div>;
        })}
      </div>
    </div>
  );
};

const StarRating = ({ value, onChange, C }) => (
  <div style={{ display: "flex", gap: 2 }}>
    {[1, 2, 3, 4, 5].map((n) => (
      <button key={n} onClick={() => onChange(n)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 22, color: n <= value ? C.gold : C.border }}>★</button>
    ))}
  </div>
);

// ═══════════════════════════════════════════════════════════════════════════════
// APP PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════════

export default function App() {
  const [session, setSession] = useState(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [isLogin, setIsLogin] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);

  const [tab, setTab] = useState("dash");
  const [sessions, setSessions] = useState([]);
  const [baseCapital, setBaseCapital] = useState({ poker: 50, sports: 500 });
  const [poker, setPoker] = useState(50);
  const [sports, setSports] = useState(500);
  const [habits, setHabits] = useState({ meditar: false, agua: false, omega: false, ejercicio: false });
  const [tilt, setTilt] = useState({});
  const [form, setForm] = useState({ type: "cash", result: "win", amount: "", note: "", rating: 3 });
  const [leakForm, setLeakForm] = useState({ position: "BTN", note: "" });
  const [rulesOpen, setRulesOpen] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [flash, setFlash] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [pushStatus, setPushStatus] = useState("Checking...");

  const [accent, setAccent] = useState("#60a5fa");
  const [timerActive, setTimerActive] = useState(false);
  const [timerStart, setTimerStart] = useState(null);
  const [timerElapsed, setTimerElapsed] = useState(0);
  const [journal, setJournal] = useState("");
  const [journalSaved, setJournalSaved] = useState(false);

  const [monthlyGoal, setMonthlyGoal] = useState(50);
  const [analyticsSubTab, setAnalyticsSubTab] = useState("general");

  const C = useMemo(() => makeC(accent), [accent]);
  const todayStr = useMemo(() => new Date().toLocaleDateString("es-MX", { day: "2-digit", month: "short" }), []);
  const active = useMemo(() => sessions.filter((x) => !x.archived), [sessions]);

  // --- TIMER LOGIC ---
  useEffect(() => {
    if (!timerActive) return;
    const id = setInterval(() => setTimerElapsed(Date.now() - timerStart), 1000);
    return () => clearInterval(id);
  }, [timerActive, timerStart]);

  const toggleTimer = useCallback(() => {
    if (timerActive) setTimerActive(false);
    else { setTimerStart(Date.now() - timerElapsed); setTimerActive(true); }
  }, [timerActive, timerElapsed]);

  const resetTimer = useCallback(() => { setTimerActive(false); setTimerElapsed(0); setTimerStart(null); }, []);

  // --- AUTH ---
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => setSession(session));
    return () => subscription.unsubscribe();
  }, []);

  const handleAuth = async (e) => {
    e.preventDefault();
    setAuthLoading(true);
    try {
      if (isLogin) await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword });
      else await supabase.auth.signUp({ email: authEmail, password: authPassword });
    } catch (err) { alert(err.message); } finally { setAuthLoading(false); }
  };

  const handleLogout = () => { supabase.auth.signOut(); setSessions([]); setLoaded(false); };

  // --- LOAD & SYNC ---
  const load = useCallback(async () => {
    if (!session) return;
    try {
      const { data: sData } = await supabase.from("sessions").select("*").eq("user_id", session.user.id).order("id", { ascending: false });
      const { data: hData } = await supabase.from("daily_habits").select("*").eq("user_id", session.user.id);
      
      const meta = session.user.user_metadata;
      let pBase = Number(meta?.base_capital?.poker) || 50;
      let sBase = Number(meta?.base_capital?.sports) || 500;
      setBaseCapital({ poker: pBase, sports: sBase });
      if (meta?.accent) setAccent(meta.accent);
      if (meta?.monthly_goal) setMonthlyGoal(meta.monthly_goal);

      if (sData) {
        setSessions(sData);
        const act = sData.filter(x => !x.archived);
        setPoker(act.filter(x => x.type !== "sports" && x.type !== "leak").reduce((a, x) => a + Number(x.amount), pBase));
        setSports(act.filter(x => x.type === "sports").reduce((a, x) => a + Number(x.amount), sBase));
      }

      if (hData) {
        const h = { meditar: false, agua: false, omega: false, ejercicio: false };
        const t = {};
        hData.forEach(item => {
          if (item.id === "journal") setJournal(item.note || "");
          else if (item.id.startsWith("tilt_")) t[item.id.replace("tilt_", "")] = item.status;
          else h[item.id] = item.status;
        });
        setHabits(h); setTilt(t);
      }
    } catch (e) { console.error(e); }
    setLoaded(true);
  }, [session]);

  useEffect(() => { load(); }, [load]);

  // --- ACTIONS ---
  const addSession = async () => {
    const amt = parseFloat(form.amount);
    if (!amt || amt <= 0) return;
    const value = form.result === "win" ? amt : -amt;
    const s = { id: Date.now(), user_id: session.user.id, type: form.type, amount: value, note: form.note, date: todayStr, archived: false, rating: form.rating, duration_ms: timerElapsed > 0 ? timerElapsed : null };
    
    const { error } = await supabase.from("sessions").insert([s]);
    if (!error) {
      setSessions([s, ...sessions]);
      if (form.type === "sports") setSports(prev => prev + value);
      else setPoker(prev => prev + value);
      setForm({ ...form, amount: "", note: "", rating: 3 });
      setFlash(value > 0 ? "win" : "loss");
      setTimeout(() => setFlash(null), 900);
      setTab("dash");
    }
  };

  const addLeak = async () => {
    if (!leakForm.note.trim()) return;
    const s = { id: Date.now(), user_id: session.user.id, type: "leak", amount: 0, note: leakForm.note, buyin: leakForm.position, date: todayStr, archived: false };
    await supabase.from("sessions").insert([s]);
    setSessions([s, ...sessions]);
    setLeakForm({ ...leakForm, note: "" });
    setFlash("win"); setTimeout(() => setFlash(null), 900);
  };

  const toggleHabit = (k) => {
    const next = !habits[k];
    setHabits({ ...habits, [k]: next });
    supabase.from("daily_habits").upsert({ id: k, user_id: session.user.id, status: next });
  };

  const toggleTilt = (k) => {
    const next = !tilt[k];
    setTilt({ ...tilt, [k]: next });
    supabase.from("daily_habits").upsert({ id: `tilt_${k}`, user_id: session.user.id, status: next });
  };

  const saveJournal = async () => {
    await supabase.from("daily_habits").upsert({ id: "journal", user_id: session.user.id, note: journal, status: false });
    setJournalSaved(true); setTimeout(() => setJournalSaved(false), 2000);
  };

  // --- ANALYTICS DERIVED ---
  const pokerSessions = useMemo(() => active.filter(x => x.type !== "sports" && x.type !== "leak"), [active]);
  const pokerProfit = useMemo(() => parseFloat((poker - baseCapital.poker).toFixed(2)), [poker, baseCapital.poker]);
  const sportsProfit = useMemo(() => parseFloat((sports - baseCapital.sports).toFixed(2)), [sports, baseCapital.sports]);
  const monthlyProgress = useMemo(() => Math.min((pokerProfit / monthlyGoal) * 100, 100), [pokerProfit, monthlyGoal]);
  
  const pokerCurve = useMemo(() => {
    const pts = [baseCapital.poker]; let cur = baseCapital.poker;
    [...pokerSessions].reverse().forEach(s => { cur += s.amount; pts.push(cur); });
    return pts;
  }, [pokerSessions, baseCapital.poker]);

  const sportsCurve = useMemo(() => {
    const sSess = active.filter(x => x.type === "sports");
    const pts = [baseCapital.sports]; let cur = baseCapital.sports;
    [...sSess].reverse().forEach(s => { cur += s.amount; pts.push(cur); });
    return pts;
  }, [active, baseCapital.sports]);

  const durationStats = useMemo(() => {
    const wd = pokerSessions.filter(s => s.duration_ms > 0);
    if (!wd.length) return { hr: 0, bb: 0 };
    const hours = wd.reduce((a, s) => a + s.duration_ms, 0) / 3600000;
    const profit = wd.reduce((a, s) => a + s.amount, 0);
    return { hr: profit / hours, bb: (profit / 0.02) / (hours * 60 / 100) }; // bb/100 asumiendo 60 hands/hr
  }, [pokerSessions]);

  // --- UI HELPERS ---
  const pill = (on, color) => ({ padding: "8px 14px", borderRadius: 20, border: `1px solid ${on ? color : C.border}`, background: on ? color + "22" : "transparent", color: on ? color : C.muted, fontSize: 11, cursor: "pointer", transition: "0.2s" });

  if (!session) return (
    <div style={{ background: C.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: "Georgia" }}>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 18, padding: 32, width: "100%", maxWidth: 360 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 9, letterSpacing: 5, color: C.muted, textTransform: "uppercase", marginBottom: 10 }}>Acceso Seguro</div>
          <div style={{ fontSize: 26, fontWeight: "bold", color: C.text }}>Diego's Edge ♠</div>
        </div>
        <form onSubmit={handleAuth}>
          <input type="email" placeholder="Email" value={authEmail} onChange={e => setAuthEmail(e.target.value)} required style={{ ...INPUT_STYLE_BASE, background: C.card, color: C.text, border: `1px solid ${C.border}`, marginBottom: 12 }} />
          <input type="password" placeholder="Contraseña" value={authPassword} onChange={e => setAuthPassword(e.target.value)} required style={{ ...INPUT_STYLE_BASE, background: C.card, color: C.text, border: `1px solid ${C.border}`, marginBottom: 20 }} />
          <button type="submit" disabled={authLoading} style={{ width: "100%", padding: 14, borderRadius: 10, border: "none", background: C.accentMid, color: C.accent, fontWeight: "bold", cursor: "pointer" }}>{isLogin ? "ACCEDER" : "REGISTRAR"}</button>
        </form>
        <button onClick={() => setIsLogin(!isLogin)} style={{ background: "none", border: "none", color: C.muted, width: "100%", marginTop: 15, fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>{isLogin ? "Crear cuenta nueva" : "Ya tengo cuenta"}</button>
      </div>
    </div>
  );

  if (!loaded) return <div style={{ background: C.bg, height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, letterSpacing: 4 }}>CONECTANDO...</div>;

  return (
    <div style={{ fontFamily: "Georgia, serif", background: C.bg, minHeight: "100vh", color: C.text, paddingBottom: 80 }}>
      {flash && <div style={{ position: "fixed", inset: 0, background: flash === "win" ? "rgba(74,222,128,0.06)" : "rgba(248,113,113,0.06)", zIndex: 999 }} />}

      {/* HEADER */}
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "16px 20px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 9, letterSpacing: 4, color: C.muted, textTransform: "uppercase" }}>High Roller Engine</div>
          <div style={{ fontSize: 21, fontWeight: "bold", color: C.text }}>Diego's Edge <span style={{ color: C.accent }}>♠</span></div>
        </div>
        <div style={{ textAlign: "right" }}>
          {timerActive && <div style={{ fontSize: 13, color: C.accent, fontWeight: "bold", fontFamily: "monospace" }}>⏱ {fmtElapsed(timerElapsed)}</div>}
          <div style={{ fontSize: 9, color: C.muted }}>{session.user.email.split("@")[0].toUpperCase()}</div>
        </div>
      </div>

      <div style={{ padding: "14px 16px", maxWidth: 480, margin: "0 auto" }}>
        
        {/* DASHBOARD */}
        {tab === "dash" && <>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14, marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: C.muted, textTransform: "uppercase", marginBottom: 8 }}>
              <span>Meta mensual</span>
              <span>{fmt(monthlyProgress, 0)}%</span>
            </div>
            <div style={{ height: 6, background: C.border, borderRadius: 6, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${monthlyProgress}%`, background: C.accent, transition: "0.5s" }} />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
            <div style={{ background: C.card, border: `1px solid ${pokerProfit >= 0 ? C.greenD : C.redD}`, borderRadius: 16, padding: 14 }}>
              <div style={{ fontSize: 8, color: C.muted, textTransform: "uppercase" }}>Poker · USD</div>
              <div style={{ fontSize: 28, fontWeight: "bold", color: pokerProfit >= 0 ? C.green : C.red }}>${fmt(poker)}</div>
              <Sparkline id="p" data={pokerCurve} color={pokerProfit >= 0 ? C.green : C.red} />
            </div>
            <div style={{ background: C.card, border: `1px solid ${sportsProfit >= 0 ? C.accentMid : C.redD}`, borderRadius: 16, padding: 14 }}>
              <div style={{ fontSize: 8, color: C.muted, textTransform: "uppercase" }}>Depor · MXN</div>
              <div style={{ fontSize: 28, fontWeight: "bold", color: sportsProfit >= 0 ? C.accent : C.red }}>${fmt(sports, 0)}</div>
              <Sparkline id="s" data={sportsCurve} color={sportsProfit >= 0 ? C.accent : C.red} />
            </div>
          </div>

          {/* TIMER CONTROL */}
          <div style={{ background: C.card, border: `1px solid ${timerActive ? C.accentMid : C.border}`, borderRadius: 14, padding: 14, marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 8, color: C.muted, textTransform: "uppercase" }}>Sesión de hoy</div>
              <div style={{ fontSize: 22, fontWeight: "bold", fontFamily: "monospace" }}>{fmtElapsed(timerElapsed)}</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={toggleTimer} style={{ padding: "10px 16px", borderRadius: 10, border: "none", background: timerActive ? C.redD : C.accentMid, color: timerActive ? C.red : C.accent, fontWeight: "bold", cursor: "pointer" }}>{timerActive ? "PAUSAR" : "INICIAR"}</button>
              <button onClick={resetTimer} style={{ padding: "10px", borderRadius: 10, background: C.surface, border: `1px solid ${C.border}`, color: C.muted }}>✕</button>
            </div>
          </div>

          {/* HABITS & TILT */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14, marginBottom: 10 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 15 }}>
              {["meditar", "agua", "omega", "ejercicio"].map(k => (
                <button key={k} onClick={() => toggleHabit(k)} style={pill(habits[k], C.accent)}>{habits[k] ? "✓ " : ""}{k.toUpperCase()}</button>
              ))}
            </div>
            <div style={{ height: 1, background: C.border, marginBottom: 15 }} />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {TILT_QS.map(q => (
                <button key={q.id} onClick={() => toggleTilt(q.id)} style={pill(tilt[q.id], C.gold)}>{tilt[q.id] ? "✓ " : ""}{q.icon}</button>
              ))}
            </div>
          </div>
        </>}

        {/* REGISTRAR */}
        {tab === "reg" && (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 16 }}>
            <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
              {["cash", "tournament", "sports"].map(v => (
                <button key={v} onClick={() => setForm({ ...form, type: v })} style={{ flex: 1, padding: 10, borderRadius: 8, border: `1px solid ${form.type === v ? C.accent : C.border}`, background: form.type === v ? C.accentDim : C.surface, color: form.type === v ? C.accent : C.muted }}>{v.toUpperCase()}</button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
              <button onClick={() => setForm({ ...form, result: "win" })} style={{ flex: 1, padding: 12, borderRadius: 8, background: form.result === "win" ? C.greenD : C.surface, color: form.result === "win" ? C.green : C.muted, border: "none" }}>GANANCIA</button>
              <button onClick={() => setForm({ ...form, result: "loss" })} style={{ flex: 1, padding: 12, borderRadius: 8, background: form.result === "loss" ? C.redD : C.surface, color: form.result === "loss" ? C.red : C.muted, border: "none" }}>PÉRDIDA</button>
            </div>
            <input type="number" placeholder="Monto" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} style={{ ...INPUT_STYLE_BASE, background: C.surface, color: C.text, border: `1px solid ${C.border}`, marginBottom: 12 }} />
            <input type="text" placeholder="Nota de la sesión" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} style={{ ...INPUT_STYLE_BASE, background: C.surface, color: C.text, border: `1px solid ${C.border}`, marginBottom: 12 }} />
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 8 }}>CALIDAD DE JUEGO</div>
              <StarRating value={form.rating} onChange={v => setForm({ ...form, rating: v })} C={C} />
            </div>
            <button onClick={addSession} style={{ width: "100%", padding: 16, borderRadius: 10, background: form.result === "win" ? C.greenD : C.redD, color: form.result === "win" ? C.green : C.red, fontWeight: "bold", border: "none" }}>GUARDAR REGISTRO</button>
          </div>
        )}

        {/* ANALYTICS */}
        {tab === "analytics" && (
          <div>
            <div style={{ display: "flex", gap: 6, marginBottom: 15 }}>
              {["general", "heatmap", "meses"].map(k => (
                <button key={k} onClick={() => setAnalyticsSubTab(k)} style={{ flex: 1, padding: "8px", borderRadius: 20, border: `1px solid ${analyticsSubTab === k ? C.accent : C.border}`, background: analyticsSubTab === k ? C.accentDim : "transparent", color: analyticsSubTab === k ? C.accent : C.muted, fontSize: 10 }}>{k.toUpperCase()}</button>
              ))}
            </div>

            {analyticsSubTab === "general" && <>
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 16, marginBottom: 10 }}>
                <div style={{ fontSize: 8, color: C.muted, textTransform: "uppercase", marginBottom: 15 }}>Últimas 7 sesiones</div>
                <BarChart data={pokerSessions.slice(0,7).reverse().map(s => ({ value: s.amount, label: s.date.split(" ")[0] }))} C={C} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14 }}>
                  <div style={{ fontSize: 8, color: C.muted }}>WIN RATE $/HORA</div>
                  <div style={{ fontSize: 20, fontWeight: "bold", color: C.accent }}>${fmt(durationStats.hr)}</div>
                </div>
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14 }}>
                  <div style={{ fontSize: 8, color: C.muted }}>ESTIMADO BB/100</div>
                  <div style={{ fontSize: 20, fontWeight: "bold", color: C.gold }}>{fmt(durationStats.bb, 1)}</div>
                </div>
              </div>
            </>}

            {analyticsSubTab === "heatmap" && (
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 16 }}>
                <div style={{ fontSize: 8, color: C.muted, textTransform: "uppercase", marginBottom: 15 }}>Frecuencia y Resultados</div>
                <HeatmapCalendar sessions={active} C={C} monthStr={todayStr.split(" ")[1]} />
              </div>
            )}
          </div>
        )}

        {/* HISTORIAL */}
        {tab === "hist" && (
          <div>
            {groupByDate(active.filter(x => x.type !== "leak")).map(([date, daySessions]) => (
              <div key={date} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, color: C.accent, marginBottom: 5, paddingLeft: 4 }}>{date.toUpperCase()}</div>
                <div style={{ background: C.card, borderRadius: 12, overflow: "hidden", border: `1px solid ${C.border}` }}>
                  {daySessions.map((s, i) => (
                    <div key={s.id} style={{ padding: 12, borderBottom: i < daySessions.length - 1 ? `1px solid ${C.border}` : "none", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ fontSize: 11 }}>{s.type.toUpperCase()} <span style={{ color: C.muted }}>{s.note ? `· ${s.note}` : ""}</span></div>
                        <div style={{ fontSize: 14, fontWeight: "bold", color: s.amount >= 0 ? C.green : C.red }}>{sgn(s.amount)}${fmt(Math.abs(s.amount))}</div>
                      </div>
                      <div style={{ fontSize: 10, color: C.gold }}>{"★".repeat(s.rating)}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* CONFIG */}
        {tab === "rules" && (
          <div>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 16, marginBottom: 12 }}>
              <div style={{ fontSize: 8, color: C.muted, marginBottom: 15 }}>CONFIGURACIÓN DEL SISTEMA</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 15 }}>
                <div>
                  <label style={{ fontSize: 9, color: C.muted }}>BASE POKER (USD)</label>
                  <input type="number" value={baseCapital.poker} onChange={e => setBaseCapital({ ...baseCapital, poker: e.target.value })} style={{ ...INPUT_STYLE_BASE, background: C.surface, color: C.text, border: `1px solid ${C.border}`, padding: 8 }} />
                </div>
                <div>
                  <label style={{ fontSize: 9, color: C.muted }}>META MENSUAL (USD)</label>
                  <input type="number" value={monthlyGoal} onChange={e => setMonthlyGoal(e.target.value)} style={{ ...INPUT_STYLE_BASE, background: C.surface, color: C.text, border: `1px solid ${C.border}`, padding: 8 }} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, marginBottom: 15 }}>
                {ACCENT_PRESETS.map(p => (
                  <button key={p.v} onClick={() => setAccent(p.v)} style={{ width: 30, height: 30, borderRadius: "50%", background: p.v, border: accent === p.v ? "2px solid white" : "none" }} />
                ))}
              </div>
              <button onClick={async () => { await supabase.auth.updateUser({ data: { base_capital: baseCapital, accent, monthly_goal: monthlyGoal } }); alert("Sincronizado"); }} style={{ width: "100%", padding: 12, borderRadius: 10, background: C.accentDim, color: C.accent, border: "none", fontWeight: "bold" }}>GUARDAR CAMBIOS EN NUBE</button>
            </div>
            <button onClick={handleLogout} style={{ width: "100%", padding: 12, borderRadius: 10, background: "transparent", border: `1px solid ${C.border}`, color: C.muted, marginBottom: 10 }}>CERRAR SESIÓN</button>
          </div>
        )}

      </div>

      {/* BOTTOM NAV */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: C.surface, borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "center", zIndex: 100 }}>
        <div style={{ display: "flex", width: "100%", maxWidth: 480 }}>
          {[
            { k: "dash", i: "◈", l: "DASH" },
            { k: "reg", i: "+", l: "ADD" },
            { k: "analytics", i: "↗", l: "STATS" },
            { k: "hist", i: "≡", l: "HIST" },
            { k: "rules", i: "◉", l: "CONFIG" }
          ].map(t => (
            <button key={t.k} onClick={() => setTab(t.k)} style={{ flex: 1, padding: "15px 0", border: "none", background: "transparent", color: tab === t.k ? C.accent : C.muted, cursor: "pointer" }}>
              <div style={{ fontSize: 18 }}>{t.i}</div>
              <div style={{ fontSize: 7, marginTop: 4 }}>{t.l}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}