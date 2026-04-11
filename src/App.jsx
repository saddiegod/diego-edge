import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "./supabase";

// ─── CONSTANTS ──────────────────────────────────────────────────────────────

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
  { id: "sleep", label: "6h+ de sueño", icon: "🌙" },
  { id: "calm", label: "Me siento calmado", icon: "🧘" },
  { id: "noAlcohol", label: "Sin alcohol", icon: "🚫" },
  { id: "notChasing", label: "Sin urgencia de recuperar", icon: "🎯" },
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

const QUICK_POKER  = [0.5, 1, 2, 5, 10, 20];
const QUICK_SPORTS = [25, 50, 100, 200, 500];

// ─── HELPERS ────────────────────────────────────────────────────────────────

const fmt     = (n, d = 2) => Number(n).toFixed(d);
const sgn     = (n)        => (n >= 0 ? "+" : "");
const isValid = (hex)      => /^#[0-9A-Fa-f]{6}$/.test(hex);

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

// ─── COLOR SYSTEM ────────────────────────────────────────────────────────────

const makeC = (accent = "#60a5fa") => ({
  bg: "#06060e", surface: "#0b0b1a", card: "#0f0f20", cardHi: "#13132a",
  border: "#1a1a32", borderHi: "#25254a",
  green: "#4ade80", greenD: "#14532d",
  red: "#f87171", redD: "#7f1d1d",
  accent, accentDim: accent + "28", accentMid: accent + "55",
  gold: "#fbbf24", goldD: "#78350f",
  muted: "#3d3d66", text: "#e0ddf0", textDim: "#6666a0",
  blue: "#60a5fa", blueD: "#1e3a5f",
});

// ─── STATIC BASE STYLES ──────────────────────────────────────────────────────

const INPUT_STYLE_BASE = {
  width: "100%", padding: "13px 14px", borderRadius: 9,
  fontSize: 15, fontFamily: "Georgia, serif",
  boxSizing: "border-box", outline: "none",
};

// ═══════════════════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Star Rating ─────────────────────────────────────────────────────────────
const StarRating = ({ value, onChange, C }) => (
  <div style={{ display: "flex", gap: 4 }}>
    {[1, 2, 3, 4, 5].map((n) => (
      <button key={n} onClick={() => onChange(n === value ? 0 : n)}
        style={{ background: "none", border: "none", cursor: "pointer", fontSize: 22,
          color: n <= value ? C.gold : C.muted, padding: "0 2px", lineHeight: 1 }}>
        ★
      </button>
    ))}
  </div>
);

// ─── Heatmap Calendar ────────────────────────────────────────────────────────
const HeatmapCalendar = ({ sessions, monthStr, C }) => {
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const firstDay   = new Date(now.getFullYear(), now.getMonth(), 1).getDay();
  const today      = now.getDate();

  const profitByDay = useMemo(() => {
    const map = {};
    sessions.forEach((s) => {
      if (!s.date.toLowerCase().includes(monthStr.toLowerCase())) return;
      const day = parseInt(s.date, 10);
      if (!isNaN(day)) map[day] = (map[day] || 0) + s.amount;
    });
    return map;
  }, [sessions, monthStr]);

  const maxAbs = Math.max(...Object.values(profitByDay).map(Math.abs), 1);

  const getColor = (day) => {
    const p = profitByDay[day];
    if (p === undefined) return C.border + "44";
    const intensity = Math.min(Math.abs(p) / maxAbs, 1);
    const alpha = Math.round(intensity * 190 + 65).toString(16).padStart(2, "0");
    return p >= 0 ? `${C.green}${alpha}` : `${C.red}${alpha}`;
  };

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
        {["D","L","M","M","J","V","S"].map((d, i) => (
          <div key={i} style={{ fontSize: 8, color: C.muted, textAlign: "center", paddingBottom: 4 }}>{d}</div>
        ))}
        {cells.map((day, i) => (
          <div key={i} style={{
            aspectRatio: "1", borderRadius: 4,
            background: day ? getColor(day) : "transparent",
            border: day === today ? `1px solid ${C.accent}` : "none",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 8, color: day === today ? C.accent : C.textDim,
            fontWeight: day === today ? "bold" : "normal",
          }}>
            {day || ""}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 12, marginTop: 8, justifyContent: "flex-end" }}>
        {[["Pérdida", C.red], ["Sin sesión", C.border], ["Ganancia", C.green]].map(([l, col]) => (
          <div key={l} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9, color: C.muted }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: col + "99" }} />{l}
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Sparkline ───────────────────────────────────────────────────────────────
const Sparkline = ({ data, color, id, W = 120, H = 32 }) => {
  if (!data || data.length < 2) return null;
  const gradId = `sg-${id}-${color.replace("#", "")}`;
  const mn = Math.min(...data) - 0.5;
  const mx = Math.max(...data) + 0.5;
  const range = mx - mn || 1;
  const pts = data.map((v, i) =>
    `${(i / (data.length - 1)) * W},${H - ((v - mn) / range) * (H - 2) + 1}`
  ).join(" ");
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

// ─── Bar Chart ───────────────────────────────────────────────────────────────
const BarChart = ({ data, C }) => {
  if (!data || data.length === 0)
    return <div style={{ textAlign: "center", color: C.textDim, padding: 24, fontSize: 12 }}>Sin datos suficientes</div>;
  const values = data.map((d) => d.value);
  const maxAbs = Math.max(...values.map(Math.abs), 0.1);
  const barH = 80;
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: barH + 36, padding: "0 4px" }}>
      {data.map((d, i) => {
        const pct   = Math.abs(d.value) / maxAbs;
        const isPos = d.value >= 0;
        const h     = Math.max(pct * barH, 2);
        return (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: barH + 36 }}>
            <div style={{ fontSize: 9, color: isPos ? C.green : C.red, marginBottom: 3, fontWeight: "bold" }}>
              {d.value !== 0 ? `${sgn(d.value)}${fmt(Math.abs(d.value), 1)}` : "—"}
            </div>
            <div style={{
              width: "100%", height: h,
              background: isPos
                ? `linear-gradient(180deg, ${C.green}cc, ${C.green}44)`
                : `linear-gradient(0deg, ${C.red}cc, ${C.red}44)`,
              borderRadius: isPos ? "4px 4px 0 0" : "0 0 4px 4px",
              transition: "height 0.4s ease",
            }} />
            <div style={{ fontSize: 8, color: C.textDim, marginTop: 5, textAlign: "center", letterSpacing: 0.5 }}>{d.label}</div>
          </div>
        );
      })}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════════════════

export default function App() {

  // ── Auth ──────────────────────────────────────────────────────────────────
  const [session,      setSession]      = useState(null);
  const [authEmail,    setAuthEmail]    = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [isLogin,      setIsLogin]      = useState(true);
  const [authLoading,  setAuthLoading]  = useState(false);

  // ── Core ──────────────────────────────────────────────────────────────────
  const [tab,          setTab]          = useState("dash");
  const [sessions,     setSessions]     = useState([]);
  const [baseCapital,  setBaseCapital]  = useState({ poker: 50, sports: 500 });
  const [poker,        setPoker]        = useState(50);
  const [sports,       setSports]       = useState(500);
  const [habits,       setHabits]       = useState({ meditar: false, agua: false, omega: false, ejercicio: false });
  const [tilt,         setTilt]         = useState({});
  const [form,         setForm]         = useState({ type: "cash", result: "win", amount: "", note: "", rating: 0 });
  const [leakForm,     setLeakForm]     = useState({ position: "BTN", note: "" });
  const [rulesOpen,    setRulesOpen]    = useState(null);
  const [loaded,       setLoaded]       = useState(false);
  const [flash,        setFlash]        = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [pushStatus,   setPushStatus]   = useState("Checking...");

  // ── Timer ─────────────────────────────────────────────────────────────────
  const [timerActive,  setTimerActive]  = useState(false);
  const [timerStart,   setTimerStart]   = useState(null);
  const [timerElapsed, setTimerElapsed] = useState(0);

  // ── Journal ───────────────────────────────────────────────────────────────
  const [journal,      setJournal]      = useState("");
  const [journalSaved, setJournalSaved] = useState(false);

  // ── Theme ─────────────────────────────────────────────────────────────────
  const [accent,       setAccent]       = useState("#60a5fa");
  const [recentColors, setRecentColors] = useState([]);
  const [customHex,    setCustomHex]    = useState("");

  // ── New Features State ────────────────────────────────────────────────────
  const [monthlyGoal,     setMonthlyGoal]     = useState(20);
  const [showWeeklyModal, setShowWeeklyModal] = useState(false);
  const [showPreSession,  setShowPreSession]  = useState(false);
  const [preSessionNote,  setPreSessionNote]  = useState("");
  const [analyticsView,   setAnalyticsView]   = useState("general"); // general | months | tournaments

  // ── Refs for fast-changing values used inside stable callbacks ────────────
  const timerElapsedRef   = useRef(0);
  const preSessionNoteRef = useRef("");
  useEffect(() => { timerElapsedRef.current = timerElapsed; },   [timerElapsed]);
  useEffect(() => { preSessionNoteRef.current = preSessionNote; }, [preSessionNote]);

  // ── Memoized color object ─────────────────────────────────────────────────
  const C = useMemo(() => makeC(accent), [accent]);

  const todayStr = useMemo(
    () => new Date().toLocaleDateString("es-MX", { day: "2-digit", month: "short" }),
    []
  );

  // ── Memoized session splits ───────────────────────────────────────────────
  const active   = useMemo(() => sessions.filter((x) => !x.archived),  [sessions]);
  const archived = useMemo(() => sessions.filter((x) =>  x.archived),  [sessions]);

  // ── Timer ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!timerActive) return;
    const id = setInterval(() => setTimerElapsed(Date.now() - timerStart), 1000);
    return () => clearInterval(id);
  }, [timerActive, timerStart]);

  // Modified: fresh start → pre-session modal; resume → direct
  const toggleTimer = useCallback(() => {
    if (timerActive) {
      setTimerActive(false);
    } else if (timerElapsed > 0) {
      setTimerStart(Date.now() - timerElapsed);
      setTimerActive(true);
    } else {
      setShowPreSession(true);
    }
  }, [timerActive, timerElapsed]);

  const startTimerActual = useCallback((note) => {
    setPreSessionNote(note);
    setTimerStart(Date.now());
    setTimerActive(true);
    setShowPreSession(false);
  }, []);

  const resetTimer = useCallback(() => {
    setTimerActive(false);
    setTimerElapsed(0);
    setTimerStart(null);
    setPreSessionNote("");
  }, []);

  // ── Auth ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  const handleAuth = useCallback(async (e) => {
    e.preventDefault();
    setAuthLoading(true);
    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({ email: authEmail, password: authPassword });
        if (error) throw error;
        alert("Cuenta creada. Ya puedes iniciar sesión.");
      }
    } catch (err) { alert(err.message); }
    finally { setAuthLoading(false); }
  }, [isLogin, authEmail, authPassword]);

  const handleLogout = useCallback(async () => {
    await supabase.auth.signOut();
    setSessions([]);
    setLoaded(false);
  }, []);

  // ── Notifications ─────────────────────────────────────────────────────────
  const sendAlert = useCallback(async (title, body) => {
    if ("serviceWorker" in navigator && Notification.permission === "granted") {
      try {
        const reg = await navigator.serviceWorker.ready;
        reg.showNotification(title, { body, icon: "/icon.png", vibrate: [200, 100, 200] });
      } catch (e) {}
    }
  }, []);

  const requestNotificationPermission = useCallback(async () => {
    if (!("Notification" in window)) { alert("Tu navegador no soporta notificaciones."); return; }
    const perm = await Notification.requestPermission();
    if (perm === "granted") { setPushStatus("Activas"); sendAlert("♠️ Diego's Edge", "Alertas activadas."); }
    else setPushStatus("Denegado");
  }, [sendAlert]);

  // ── Time alerts (FIX: ref for active) ────────────────────────────────────
  const activeRef = useRef(active);
  useEffect(() => { activeRef.current = active; }, [active]);

  useEffect(() => {
    if (!loaded || !session) return;
    const checkTimeAlerts = () => {
      const now = new Date();
      const h = now.getHours(), m = now.getMinutes();
      const today = now.toLocaleDateString("es-MX");
      let noted = {};
      try { noted = JSON.parse(localStorage.getItem(`bk_alerts_${today}`)) || {}; } catch {}
      if (h === 10 && m === 0 && !noted.morning) { sendAlert("🌅 Buenos días", "Omega-3 y agua antes de la primera sesión."); noted.morning = true; }
      if (h === 14 && m === 0 && !noted.afternoon) { sendAlert("🧠 Check-in", "¿Cómo va el tilt?"); noted.afternoon = true; }
      if (h === 20 && m === 0 && !noted.evening) { sendAlert("📖 Hora de estudio", "Revisa Spots y Leaks."); noted.evening = true; }
      if (h === 22 && m === 0 && !noted.night) {
        const todaySess = activeRef.current.filter((s) => s.date === todayStr && s.type !== "leak");
        if (todaySess.length > 0) {
          const pt = todaySess.filter((s) => s.type !== "sports").reduce((a, s) => a + s.amount, 0);
          const st = todaySess.filter((s) => s.type === "sports").reduce((a, s) => a + s.amount, 0);
          sendAlert("📊 Resumen del Día", `Poker: ${sgn(pt)}${fmt(pt)} USD | Depor: ${sgn(st)}${fmt(st, 0)} MXN`);
        }
        noted.night = true;
      }
      localStorage.setItem(`bk_alerts_${today}`, JSON.stringify(noted));
    };
    const id = setInterval(checkTimeAlerts, 60000);
    checkTimeAlerts();
    return () => clearInterval(id);
  }, [loaded, session, sendAlert, todayStr]);

  // ── Load ──────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!session) return;
    try {
      if ("Notification" in window) setPushStatus(Notification.permission === "granted" ? "Activas" : "Pendiente");

      let currentBase = { poker: 50, sports: 500 };
      const meta = session.user.user_metadata;
      if (meta?.base_capital)  { currentBase = meta.base_capital; setBaseCapital(currentBase); }
      if (meta?.accent)        setAccent(meta.accent);
      if (meta?.monthly_goal)  setMonthlyGoal(meta.monthly_goal);

      const savedColors = localStorage.getItem("bk_recent_colors");
      if (savedColors) { try { setRecentColors(JSON.parse(savedColors)); } catch {} }

      const today    = new Date().toLocaleDateString("es-MX");
      const lastDate = localStorage.getItem("bk_last_date");
      if (lastDate && lastDate !== today) {
        await supabase.from("daily_habits").delete().eq("user_id", session.user.id).neq("id", "dummy");
      }
      localStorage.setItem("bk_last_date", today);

      const openedToday = localStorage.getItem("bk_opened_today");
      if (openedToday !== today) {
        setTimeout(() => sendAlert("🌅 Diego's Edge", "Nuevo día. Registra tus check-ins."), 3000);
        localStorage.setItem("bk_opened_today", today);
      }

      const { data: sData } = await supabase.from("sessions").select("*").eq("user_id", session.user.id).order("id", { ascending: false });
      const { data: hData } = await supabase.from("daily_habits").select("*").eq("user_id", session.user.id);

      if (sData) {
        setSessions(sData);
        const activeData = sData.filter((x) => !x.archived);
        const pSess = activeData.filter((x) => x.type !== "sports" && x.type !== "leak");
        const sSess = activeData.filter((x) => x.type === "sports");
        setPoker(pSess.reduce((a, x) => a + x.amount, currentBase.poker));
        setSports(sSess.reduce((a, x) => a + x.amount, currentBase.sports));
      } else {
        setPoker(currentBase.poker);
        setSports(currentBase.sports);
      }

      if (hData) {
        const lH = { meditar: false, agua: false, omega: false, ejercicio: false };
        const lT = {};
        let lJ   = "";
        hData.forEach((item) => {
          if (item.id === "journal")         lJ = item.note || "";
          else if (item.id.startsWith("tilt_")) lT[item.id.replace("tilt_", "")] = item.status;
          else lH[item.id] = item.status;
        });
        setHabits(lH); setTilt(lT); setJournal(lJ);
      }
    } catch (err) { console.error("Error cargando:", err); }
    setLoaded(true);
  }, [session, sendAlert]);

  useEffect(() => { load(); }, [load]);

  // ── Weekly summary modal (Mondays) ────────────────────────────────────────
  useEffect(() => {
    if (!loaded || !session) return;
    const now = new Date();
    if (now.getDay() !== 1) return;
    const key = `bk_weekly_${now.toISOString().slice(0, 10)}`;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "1");
    setShowWeeklyModal(true);
  }, [loaded, session]);

  // ── Save config ───────────────────────────────────────────────────────────
  const saveConfig = useCallback(async () => {
    await supabase.auth.updateUser({ data: { base_capital: baseCapital, accent, monthly_goal: monthlyGoal } });
    load();
    sendAlert("⚙️ Config guardada", "Capital y tema actualizados.");
  }, [baseCapital, accent, monthlyGoal, load, sendAlert]);

  // ── Set accent + track recent colors ─────────────────────────────────────
  const handleSetAccent = useCallback((color) => {
    setAccent(color);
    setRecentColors((prev) => {
      const filtered = prev.filter((c) => c !== color);
      const next     = [color, ...filtered].slice(0, 3);
      localStorage.setItem("bk_recent_colors", JSON.stringify(next));
      return next;
    });
  }, []);

  // ── Add session (with rating, duration, pre_note) ─────────────────────────
  const addSession = useCallback(async () => {
    const amt = parseFloat(form.amount);
    if (!amt || amt <= 0) return;
    const value    = form.result === "win" ? amt : -amt;
    const duration = timerElapsedRef.current || 0;
    const preNote  = preSessionNoteRef.current || "";
    const s = {
      id: Date.now(),
      user_id: session.user.id,
      type: form.type,
      amount: value,
      note: form.note,
      date: todayStr,
      archived: false,
      rating: form.rating || 0,
      duration,
      pre_note: preNote,
    };
    const { error } = await supabase.from("sessions").insert([s]);
    if (!error) {
      setSessions((prev) => [s, ...prev]);
      if (form.type === "sports") setSports((p) => parseFloat((p + value).toFixed(2)));
      else                        setPoker((p)  => parseFloat((p + value).toFixed(2)));
      setForm((f) => ({ ...f, amount: "", note: "", rating: 0 }));
      setFlash(value > 0 ? "win" : "loss");
      setTimeout(() => setFlash(null), 900);
      setTab("dash");
      if (form.type === "cash" && value <= -6) sendAlert("⚠️ STOP LOSS", "3 buy-ins perdidos. Cierra la mesa.");
      if (form.type === "cash" && value >= 10)  sendAlert("🏆 Buena sesión", "Protege las ganancias.");
    } else { alert("Error al guardar."); }
  }, [form, session, todayStr, sendAlert]);

  // ── Add leak ──────────────────────────────────────────────────────────────
  const addLeak = useCallback(async () => {
    if (!leakForm.note.trim()) return;
    const s = {
      id: Date.now(), user_id: session.user.id, type: "leak",
      amount: 0, note: leakForm.note, buyin: leakForm.position,
      date: todayStr, archived: false,
    };
    const { error } = await supabase.from("sessions").insert([s]);
    if (!error) {
      setSessions((prev) => [s, ...prev]);
      setLeakForm((f) => ({ ...f, note: "" }));
      setFlash("win"); setTimeout(() => setFlash(null), 900);
    } else { alert("Error al guardar leak."); }
  }, [leakForm, session, todayStr]);

  // ── Toggle habit / tilt ───────────────────────────────────────────────────
  const toggleHabit = useCallback(async (k) => {
    setHabits((prev) => {
      const next = !prev[k];
      supabase.from("daily_habits").upsert({ id: k, user_id: session.user.id, status: next });
      return { ...prev, [k]: next };
    });
  }, [session]);

  const toggleTilt = useCallback(async (k) => {
    setTilt((prev) => {
      const next = !prev[k];
      supabase.from("daily_habits").upsert({ id: `tilt_${k}`, user_id: session.user.id, status: next });
      return { ...prev, [k]: next };
    });
  }, [session]);

  // ── Save journal ──────────────────────────────────────────────────────────
  const saveJournal = useCallback(async () => {
    await supabase.from("daily_habits").upsert({ id: "journal", user_id: session.user.id, status: false, note: journal });
    setJournalSaved(true);
    setTimeout(() => setJournalSaved(false), 2000);
  }, [session, journal]);

  // ── Archive all ───────────────────────────────────────────────────────────
  const archiveAll = useCallback(async () => {
    if (!confirm("¿Archivar todos los datos y empezar desde cero?")) return;
    const activeIds = sessions.filter((s) => !s.archived).map((s) => s.id);
    if (activeIds.length > 0) await supabase.from("sessions").update({ archived: true }).in("id", activeIds);
    await supabase.from("daily_habits").delete().eq("user_id", session.user.id).neq("id", "dummy");
    setSessions((prev) => prev.map((s) => ({ ...s, archived: true })));
    setPoker(baseCapital.poker); setSports(baseCapital.sports);
    setHabits({ meditar: false, agua: false, omega: false, ejercicio: false });
    setTilt({}); setJournal(""); setTab("dash");
  }, [sessions, session, baseCapital]);

  // ── Export CSV ────────────────────────────────────────────────────────────
  const exportCSV = useCallback(() => {
    const header = "Fecha,Tipo,Monto,Nota,Rating,Duración(min),Foco previo\n";
    const rows = active
      .filter((x) => x.type !== "leak")
      .map((s) => [
        s.date, s.type, s.amount,
        `"${(s.note     || "").replace(/"/g, "'")}"`,
        s.rating   || 0,
        s.duration ? Math.round(s.duration / 60000) : 0,
        `"${(s.pre_note || "").replace(/"/g, "'")}"`,
      ].join(","))
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `diegos-edge-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }, [active]);

  // ═══════════════════════════════════════════════════════════════════════════
  // DERIVED STATE — all memoized
  // ═══════════════════════════════════════════════════════════════════════════

  const pokerSessions      = useMemo(() => active.filter((x) => x.type !== "sports" && x.type !== "leak"), [active]);
  const sportsSessions     = useMemo(() => active.filter((x) => x.type === "sports"),      [active]);
  const leakSessions       = useMemo(() => active.filter((x) => x.type === "leak"),         [active]);
  const tournamentSessions = useMemo(() => active.filter((x) => x.type === "tournament"),   [active]);

  const pokerWins    = useMemo(() => pokerSessions.filter((x) => x.amount > 0).length, [pokerSessions]);
  const pokerProfit  = useMemo(() => parseFloat((poker  - baseCapital.poker ).toFixed(2)), [poker,  baseCapital.poker]);
  const sportsProfit = useMemo(() => parseFloat((sports - baseCapital.sports).toFixed(2)), [sports, baseCapital.sports]);

  const tiltScore = useMemo(() => TILT_QS.filter((q) => tilt[q.id]).length, [tilt]);
  const tiltColor = useMemo(() => tiltScore >= 4 ? C.green : tiltScore >= 2 ? C.gold : C.red, [tiltScore, C.green, C.gold, C.red]);
  const tiltLabel = useMemo(() => tiltScore >= 4 ? "Óptimo" : tiltScore >= 2 ? "Cuidado" : "No juegues", [tiltScore]);

  const streak = useMemo(() => {
    let s = 0;
    for (const x of pokerSessions) { if (x.amount > 0) s++; else break; }
    return s;
  }, [pokerSessions]);

  const danger  = useMemo(() => poker < baseCapital.poker * 0.6, [poker, baseCapital.poker]);
  const warning = useMemo(() => poker < baseCapital.poker * 0.8 && poker >= baseCapital.poker * 0.6, [poker, baseCapital.poker]);

  const pokerCurve = useMemo(() => {
    const pts = [baseCapital.poker]; let cur = baseCapital.poker;
    [...pokerSessions].reverse().forEach((s) => { cur = parseFloat((cur + s.amount).toFixed(2)); pts.push(cur); });
    return pts;
  }, [pokerSessions, baseCapital.poker]);

  const sportsCurve = useMemo(() => {
    const pts = [baseCapital.sports]; let cur = baseCapital.sports;
    [...sportsSessions].reverse().forEach((s) => { cur = parseFloat((cur + s.amount).toFixed(2)); pts.push(cur); });
    return pts;
  }, [sportsSessions, baseCapital.sports]);

  const last7 = useMemo(
    () => [...pokerSessions].slice(0, 7).reverse().map((s) => ({ value: s.amount, label: s.date.replace(/\s/g, "\n") })),
    [pokerSessions]
  );

  const pokerAmounts  = useMemo(() => pokerSessions.map((s) => s.amount), [pokerSessions]);
  const bestSession   = useMemo(() => pokerAmounts.length ? Math.max(...pokerAmounts) : 0, [pokerAmounts]);
  const worstSession  = useMemo(() => pokerAmounts.length ? Math.min(...pokerAmounts) : 0, [pokerAmounts]);
  const avgSession    = useMemo(() => pokerAmounts.length ? pokerAmounts.reduce((a, b) => a + b, 0) / pokerAmounts.length : 0, [pokerAmounts]);

  const nowMemo       = useMemo(() => new Date(), []);
  const monthStr      = useMemo(() => nowMemo.toLocaleDateString("es-MX", { month: "short" }), [nowMemo]);
  const thisMonthSessions = useMemo(() => pokerSessions.filter((s) => s.date.includes(monthStr)), [pokerSessions, monthStr]);
  const thisMonthProfit   = useMemo(() => thisMonthSessions.reduce((a, s) => a + s.amount, 0), [thisMonthSessions]);

  const groupedActive   = useMemo(() => groupByDate(active.filter((x)   => x.type !== "leak")), [active]);
  const groupedArchived = useMemo(() => groupByDate(archived.filter((x) => x.type !== "leak")), [archived]);

  // ── New derived: monthly goal progress ────────────────────────────────────
  const monthlyProgress = useMemo(() => {
    if (!monthlyGoal) return 0;
    return Math.max(Math.min((thisMonthProfit / monthlyGoal) * 100, 100), 0);
  }, [thisMonthProfit, monthlyGoal]);

  // ── New derived: NL projection ────────────────────────────────────────────
  const avgLast10 = useMemo(() => {
    const last10 = pokerAmounts.slice(0, 10);
    if (!last10.length) return 0;
    return last10.reduce((a, b) => a + b, 0) / last10.length;
  }, [pokerAmounts]);

  const nextLevel = useMemo(() => {
    const next = POKER_LADDER.find((r) => poker < r.at);
    if (!next) return null;
    if (avgLast10 <= 0) return { label: next.label, sessions: null, target: next.at };
    const sessions = Math.ceil((next.at - poker) / avgLast10);
    return { label: next.label, sessions, target: next.at };
  }, [poker, avgLast10]);

  // ── New derived: frequent leak alerts ────────────────────────────────────
  const leakAlerts = useMemo(() => {
    const counts = {};
    leakSessions.forEach((s) => {
      const key = s.buyin || "GNRL";
      counts[key] = (counts[key] || 0) + 1;
    });
    return Object.entries(counts).filter(([, n]) => n >= 3).map(([pos, n]) => ({ pos, n }));
  }, [leakSessions]);

  // ── New derived: month-by-month breakdown ─────────────────────────────────
  const monthlyBreakdown = useMemo(() => {
    const months = {};
    [...pokerSessions].reverse().forEach((s) => {
      const parts = s.date.split(" ");
      const m     = parts[1] || "?";
      if (!months[m]) months[m] = { sessions: 0, profit: 0, wins: 0 };
      months[m].sessions++;
      months[m].profit += s.amount;
      if (s.amount > 0) months[m].wins++;
    });
    return Object.entries(months).map(([month, d]) => ({
      month,
      sessions: d.sessions,
      profit: parseFloat(d.profit.toFixed(2)),
      winRate: d.sessions ? Math.round((d.wins / d.sessions) * 100) : 0,
    })).reverse();
  }, [pokerSessions]);

  // ── New derived: tournament ROI ───────────────────────────────────────────
  const tournamentROI = useMemo(() => {
    if (!tournamentSessions.length) return null;
    const total    = tournamentSessions.length;
    const wins     = tournamentSessions.filter((s) => s.amount > 0).length;
    const invested = tournamentSessions.filter((s) => s.amount < 0).reduce((a, s) => a + Math.abs(s.amount), 0);
    const profit   = tournamentSessions.reduce((a, s) => a + s.amount, 0);
    const roi      = invested > 0 ? (profit / invested) * 100 : 0;
    const itm      = (wins / total) * 100;
    return { total, wins, invested, profit: parseFloat(profit.toFixed(2)), roi, itm };
  }, [tournamentSessions]);

  // ── New derived: $/hora and BB/100 ───────────────────────────────────────
  const sessionsWithDuration = useMemo(
    () => pokerSessions.filter((s) => s.duration && s.duration > 60000),
    [pokerSessions]
  );
  const avgPerHour = useMemo(() => {
    if (!sessionsWithDuration.length) return null;
    const totalProfit = sessionsWithDuration.reduce((a, s) => a + s.amount, 0);
    const totalHours  = sessionsWithDuration.reduce((a, s) => a + s.duration / 3600000, 0);
    return totalHours > 0 ? totalProfit / totalHours : null;
  }, [sessionsWithDuration]);
  const bb100 = useMemo(() => {
    if (avgPerHour === null) return null;
    const bbSize = 0.02; const handsPerHour = 25;
    return ((avgPerHour / handsPerHour) / bbSize) * 100;
  }, [avgPerHour]);

  // ── Weekly stats for modal ────────────────────────────────────────────────
  const weeklyStats = useMemo(() => ({
    sessions: pokerSessions.length,
    profit:   pokerProfit,
    winRate:  pokerSessions.length ? Math.round((pokerWins / pokerSessions.length) * 100) : 0,
    leaks:    leakSessions.length,
    best:     bestSession,
  }), [pokerSessions, pokerProfit, pokerWins, leakSessions, bestSession]);

  // ── Sports 5% computed in MXN ─────────────────────────────────────────────
  const sports5pct = useMemo(() => parseFloat((sports * 0.05).toFixed(0)), [sports]);

  // ─── STYLE HELPERS ───────────────────────────────────────────────────────

  const inputStyle = useMemo(() => ({
    ...INPUT_STYLE_BASE,
    border: `1px solid ${C.border}`,
    background: C.surface,
    color: C.text,
  }), [C.border, C.surface, C.text]);

  const pill = useCallback((on, color) => ({
    padding: "8px 14px", borderRadius: 20,
    border: `1px solid ${on ? color : C.border}`,
    background: on ? color + "22" : "transparent",
    color: on ? color : C.muted,
    fontSize: 12, cursor: "pointer",
    fontFamily: "Georgia, serif", transition: "all 0.2s",
  }), [C.border, C.muted]);

  const typeBtn = useCallback((v) => ({
    flex: 1, padding: "10px 4px", borderRadius: 8,
    border: `1px solid ${form.type === v ? C.accent + "88" : C.border}`,
    cursor: "pointer",
    background: form.type === v ? C.accentDim : C.surface,
    color: form.type === v ? C.accent : C.muted,
    fontFamily: "Georgia, serif", fontSize: 11, transition: "all 0.2s",
  }), [form.type, C.accent, C.border, C.accentDim, C.surface, C.muted]);

  const resBtn = useCallback((v) => ({
    flex: 1, padding: 13, borderRadius: 8, border: "none", cursor: "pointer",
    background: form.result === v ? (v === "win" ? C.greenD : C.redD) : C.surface,
    color: form.result === v ? (v === "win" ? C.green : C.red) : C.muted,
    fontFamily: "Georgia, serif", fontSize: 13, transition: "all 0.2s",
  }), [form.result, C.greenD, C.redD, C.surface, C.green, C.red, C.muted]);

  // ─── LOGIN SCREEN ────────────────────────────────────────────────────────

  if (!session) {
    return (
      <div style={{ background: C.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: "Georgia, serif" }}>
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 18, padding: 32, width: "100%", maxWidth: 360 }}>
          <div style={{ textAlign: "center", marginBottom: 32 }}>
            <div style={{ fontSize: 9, letterSpacing: 5, color: C.muted, textTransform: "uppercase", marginBottom: 10 }}>Sistema de gestión</div>
            <div style={{ fontSize: 26, fontWeight: "bold", color: C.text, letterSpacing: -0.5 }}>Diego's Edge ♠</div>
          </div>
          <form onSubmit={handleAuth}>
            <input type="email" placeholder="Correo electrónico" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} required style={{ ...inputStyle, marginBottom: 12, fontSize: 14 }} />
            <input type="password" placeholder="Contraseña" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} required style={{ ...inputStyle, marginBottom: 20, fontSize: 14 }} />
            <button type="submit" disabled={authLoading} style={{ width: "100%", padding: 14, borderRadius: 10, border: "none", background: C.accentDim, color: C.accent, fontSize: 13, fontWeight: "bold", cursor: "pointer", letterSpacing: 2, textTransform: "uppercase" }}>
              {authLoading ? "Cargando..." : isLogin ? "Acceder" : "Crear cuenta"}
            </button>
          </form>
          <div style={{ textAlign: "center", marginTop: 18 }}>
            <button onClick={() => setIsLogin(!isLogin)} style={{ background: "none", border: "none", color: C.muted, fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>
              {isLogin ? "¿Sin cuenta? Regístrate" : "Ya tengo cuenta"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div style={{ background: C.bg, height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, fontFamily: "monospace", letterSpacing: 4, fontSize: 10 }}>
        CONECTANDO...
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <div style={{ fontFamily: "'Georgia', serif", background: C.bg, minHeight: "100vh", color: C.text, paddingBottom: 80 }}>

      {/* ── Flash overlay ──────────────────────────────────────────────── */}
      {flash && (
        <div style={{ position: "fixed", inset: 0, background: flash === "win" ? "rgba(74,222,128,0.06)" : "rgba(248,113,113,0.06)", pointerEvents: "none", zIndex: 999 }} />
      )}

      {/* ── Weekly summary modal ───────────────────────────────────────── */}
      {showWeeklyModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ background: C.card, border: `1px solid ${C.accentMid}`, borderRadius: 20, padding: 28, maxWidth: 340, width: "100%" }}>
            <div style={{ fontSize: 9, letterSpacing: 4, color: C.accent, textTransform: "uppercase", marginBottom: 6 }}>Resumen semanal</div>
            <div style={{ fontSize: 20, fontWeight: "bold", color: C.text, marginBottom: 20 }}>¿Cómo fue la semana? 📋</div>
            {[
              { l: "Sesiones jugadas", v: weeklyStats.sessions },
              { l: "Profit acumulado", v: `${sgn(weeklyStats.profit)}$${fmt(Math.abs(weeklyStats.profit))} USD`, color: weeklyStats.profit >= 0 ? C.green : C.red },
              { l: "Win rate", v: weeklyStats.sessions ? `${weeklyStats.winRate}%` : "—" },
              { l: "Leaks registrados", v: weeklyStats.leaks },
              { l: "Mejor sesión", v: `+$${fmt(weeklyStats.best)} USD`, color: C.green },
            ].map((row) => (
              <div key={row.l} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 12, color: C.muted }}>{row.l}</div>
                <div style={{ fontSize: 13, fontWeight: "bold", color: row.color || C.text }}>{row.v}</div>
              </div>
            ))}
            <button onClick={() => setShowWeeklyModal(false)} style={{ width: "100%", marginTop: 20, padding: 13, borderRadius: 10, border: "none", background: C.accentDim, color: C.accent, fontSize: 13, fontWeight: "bold", cursor: "pointer", letterSpacing: 2 }}>
              EMPEZAR LA SEMANA ♠
            </button>
          </div>
        </div>
      )}

      {/* ── Pre-session modal ──────────────────────────────────────────── */}
      {showPreSession && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 20, padding: 24, maxWidth: 340, width: "100%" }}>
            <div style={{ fontSize: 9, letterSpacing: 4, color: C.accent, textTransform: "uppercase", marginBottom: 6 }}>Antes de jugar</div>
            <div style={{ fontSize: 17, fontWeight: "bold", color: C.text, marginBottom: 16 }}>¿Cuál es tu foco hoy? 🎯</div>
            <textarea
              autoFocus
              placeholder="Ej: No pagar 3bets OOP, fold más en BB vs steal..."
              value={preSessionNote}
              onChange={(e) => setPreSessionNote(e.target.value)}
              style={{ ...inputStyle, fontSize: 13, minHeight: 80, resize: "none", lineHeight: 1.6, marginBottom: 14 }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => startTimerActual(preSessionNote)}
                style={{ flex: 1, padding: 13, borderRadius: 10, border: "none", background: C.accentDim, color: C.accent, fontSize: 13, fontWeight: "bold", cursor: "pointer" }}>
                ▶ Iniciar sesión
              </button>
              <button onClick={() => { setShowPreSession(false); setPreSessionNote(""); }}
                style={{ padding: "13px 16px", borderRadius: 10, border: `1px solid ${C.border}`, background: "transparent", color: C.muted, fontSize: 12, cursor: "pointer" }}>
                Saltar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "16px 20px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 9, letterSpacing: 4, color: C.muted, textTransform: "uppercase", marginBottom: 2 }}>Bankroll Manager</div>
          <div style={{ fontSize: 21, fontWeight: "bold", color: C.text, letterSpacing: -0.5 }}>Diego's Edge <span style={{ color: C.accent }}>♠</span></div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 9, color: C.muted, letterSpacing: 2 }}>{session.user.email.split("@")[0].toUpperCase()}</div>
          {timerActive && (
            <div style={{ fontSize: 13, color: C.accent, fontWeight: "bold", marginTop: 2, fontFamily: "monospace", letterSpacing: 2 }}>
              ⏱ {fmtElapsed(timerElapsed)}
            </div>
          )}
        </div>
      </div>

      {/* Bankroll alerts */}
      {(danger || warning) && (
        <div style={{ background: danger ? "#120406" : "#121004", borderLeft: `3px solid ${danger ? C.red : C.gold}`, padding: "9px 20px", fontSize: 12, color: danger ? C.red : C.gold }}>
          {danger ? "⛔ Bankroll crítico — Pausa esta semana" : "⚠️ Bankroll bajo — Máximo 1 buyin por sesión"}
        </div>
      )}

      {/* Frequent leak alert banner */}
      {leakAlerts.length > 0 && (
        <div style={{ background: "#130a00", borderLeft: `3px solid ${C.gold}`, padding: "9px 20px", fontSize: 12, color: C.gold }}>
          ⚑ Patrón detectado: {leakAlerts.map((a) => `${a.pos} (${a.n}×)`).join(" · ")} — revisa antes de jugar
        </div>
      )}

      <div style={{ padding: "14px 16px", maxWidth: 480, margin: "0 auto" }}>

        {/* ══════════════════════════════════════════════════════════════
            DASHBOARD
        ══════════════════════════════════════════════════════════════ */}
        {tab === "dash" && <>

          {/* Bankroll Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>

            {/* Poker card */}
            <div style={{ background: C.card, border: `1px solid ${pokerProfit >= 0 ? C.greenD : C.redD}`, borderRadius: 16, padding: 14, position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: 0, right: 0, width: 60, height: 60, background: (pokerProfit >= 0 ? C.green : C.red) + "08", borderRadius: "0 16px 0 60px" }} />
              <div style={{ fontSize: 8, letterSpacing: 3, color: C.muted, textTransform: "uppercase", marginBottom: 6 }}>Poker · USD</div>
              <div style={{ fontSize: 28, fontWeight: "bold", color: pokerProfit >= 0 ? C.green : C.red, letterSpacing: -1 }}>${fmt(poker)}</div>
              <div style={{ fontSize: 11, color: pokerProfit >= 0 ? C.green : C.red, marginTop: 2, opacity: 0.8 }}>
                {sgn(pokerProfit)}{fmt(pokerProfit)} ({sgn(pokerProfit)}{fmt((pokerProfit / baseCapital.poker) * 100, 1)}%)
              </div>
              <Sparkline id="poker" data={pokerCurve} color={pokerProfit >= 0 ? C.green : C.red} />
            </div>

            {/* Sports card — 5% bet recommendation */}
            <div style={{ background: C.card, border: `1px solid ${sportsProfit >= 0 ? C.accentMid : C.redD}`, borderRadius: 16, padding: 14, position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: 0, right: 0, width: 60, height: 60, background: (sportsProfit >= 0 ? C.accent : C.red) + "08", borderRadius: "0 16px 0 60px" }} />
              <div style={{ fontSize: 8, letterSpacing: 3, color: C.muted, textTransform: "uppercase", marginBottom: 6 }}>Depor · MXN</div>
              <div style={{ fontSize: 28, fontWeight: "bold", color: sportsProfit >= 0 ? C.accent : C.red, letterSpacing: -1 }}>${fmt(sports, 0)}</div>
              <div style={{ fontSize: 11, color: sportsProfit >= 0 ? C.accent : C.red, marginTop: 2, opacity: 0.8 }}>
                {sgn(sportsProfit)}{fmt(sportsProfit, 0)} ({sgn(sportsProfit)}{fmt((sportsProfit / baseCapital.sports) * 100, 1)}%)
              </div>
              <div style={{ fontSize: 10, color: C.gold, marginTop: 4, fontWeight: "bold" }}>
                5% = ${sports5pct} MXN
              </div>
              <Sparkline id="sports" data={sportsCurve} color={sportsProfit >= 0 ? C.accent : C.red} />
            </div>
          </div>

          {/* Stats row */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "12px 14px", marginBottom: 10, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4 }}>
            {[
              { v: pokerSessions.length, l: "Sesiones" },
              { v: pokerWins,            l: "Ganadas"  },
              { v: pokerSessions.length ? `${((pokerWins / pokerSessions.length) * 100).toFixed(0)}%` : "—", l: "Win rate" },
              { v: streak > 0 ? `${streak}🔥` : "—", l: "Racha" },
            ].map((s) => (
              <div key={s.l} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 19, fontWeight: "bold", color: C.text }}>{s.v}</div>
                <div style={{ fontSize: 8, color: C.muted, marginTop: 2, letterSpacing: 1, textTransform: "uppercase" }}>{s.l}</div>
              </div>
            ))}
          </div>

          {/* Monthly goal progress */}
          {monthlyGoal > 0 && (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "12px 14px", marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontSize: 8, letterSpacing: 3, color: C.muted, textTransform: "uppercase" }}>Meta {monthStr}</div>
                <div style={{ fontSize: 11, color: thisMonthProfit >= monthlyGoal ? C.green : C.accent, fontWeight: "bold" }}>
                  {sgn(thisMonthProfit)}${fmt(Math.abs(thisMonthProfit))} / ${fmt(monthlyGoal)} USD
                </div>
              </div>
              <div style={{ height: 6, background: C.border, borderRadius: 6, overflow: "hidden" }}>
                <div style={{
                  height: "100%", borderRadius: 6, transition: "width 0.5s ease",
                  width: `${monthlyProgress}%`,
                  background: thisMonthProfit < 0 ? C.red : monthlyProgress >= 100 ? C.green : C.accent,
                }} />
              </div>
              <div style={{ fontSize: 10, color: C.muted, marginTop: 5, textAlign: "right" }}>
                {monthlyProgress >= 100 ? "✓ Meta alcanzada 🎉" : `${monthlyProgress.toFixed(0)}% — faltan $${fmt(Math.max(monthlyGoal - thisMonthProfit, 0))} USD`}
              </div>
            </div>
          )}

          {/* Timer Card */}
          <div style={{ background: C.card, border: `1px solid ${timerActive ? C.accentMid : C.border}`, borderRadius: 14, padding: "12px 14px", marginBottom: 10, display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 8, letterSpacing: 3, color: C.muted, textTransform: "uppercase", marginBottom: 4 }}>Sesión activa</div>
              <div style={{ fontSize: 26, fontWeight: "bold", color: timerActive ? C.accent : C.muted, fontFamily: "monospace", letterSpacing: 2 }}>
                {fmtElapsed(timerElapsed)}
              </div>
              {preSessionNote && (
                <div style={{ fontSize: 10, color: C.accent, marginTop: 3, opacity: 0.8 }}>🎯 {preSessionNote}</div>
              )}
              {timerElapsed > 0 && !timerActive && !preSessionNote && (
                <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>Pausado</div>
              )}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={toggleTimer} style={{ padding: "10px 18px", borderRadius: 10, border: `1px solid ${timerActive ? C.accent : C.border}`, background: timerActive ? C.accentDim : C.surface, color: timerActive ? C.accent : C.muted, fontSize: 12, cursor: "pointer", fontFamily: "Georgia", fontWeight: "bold" }}>
                {timerActive ? "⏸ Pausa" : timerElapsed > 0 ? "▶ Reanudar" : "▶ Iniciar"}
              </button>
              {timerElapsed > 0 && (
                <button onClick={resetTimer} style={{ padding: "10px 12px", borderRadius: 10, border: `1px solid ${C.border}`, background: "transparent", color: C.muted, fontSize: 12, cursor: "pointer" }}>✕</button>
              )}
            </div>
          </div>

          {/* Tilt + Hábitos */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "12px 14px", marginBottom: 10 }}>
            <div style={{ fontSize: 8, letterSpacing: 3, color: C.muted, textTransform: "uppercase", marginBottom: 10 }}>Hábitos de hoy</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
              {[{ k: "meditar", l: "🧘 Meditar" }, { k: "agua", l: "💧 Agua" }, { k: "omega", l: "🐟 Omega-3" }, { k: "ejercicio", l: "🏃 Ejercicio" }].map((h) => (
                <button key={h.k} onClick={() => toggleHabit(h.k)} style={pill(habits[h.k], C.accent)}>
                  {habits[h.k] ? "✓ " : ""}{h.l}
                </button>
              ))}
            </div>
            <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontSize: 8, letterSpacing: 3, color: C.muted, textTransform: "uppercase" }}>Estado mental</div>
                <div style={{ fontSize: 12, color: tiltColor, fontWeight: "bold", letterSpacing: 1 }}>
                  {tiltScore >= 4 ? "✓" : tiltScore >= 2 ? "⚠" : "✗"} {tiltLabel}
                </div>
              </div>
              <div style={{ height: 4, background: C.border, borderRadius: 4, marginBottom: 12, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${(tiltScore / TILT_QS.length) * 100}%`, background: tiltColor, borderRadius: 4, transition: "width 0.4s ease" }} />
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {TILT_QS.map((q) => (
                  <button key={q.id} onClick={() => toggleTilt(q.id)} style={pill(tilt[q.id], tiltColor)}>
                    {tilt[q.id] ? "✓ " : ""}{q.icon} {q.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* NL Ladder + projection */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "12px 14px", marginBottom: 10 }}>
            <div style={{ fontSize: 8, letterSpacing: 3, color: C.muted, textTransform: "uppercase", marginBottom: 12 }}>Escalera NL</div>
            {POKER_LADDER.map((r) => {
              const prev = POKER_LADDER[POKER_LADDER.indexOf(r) - 1]?.at || baseCapital.poker;
              const pct  = Math.min(((poker - prev) / (r.at - prev)) * 100, 100);
              const done = poker >= r.at;
              return (
                <div key={r.at} style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <div style={{ fontSize: 12, fontWeight: "bold", color: done ? C.green : C.textDim }}>{r.label}</div>
                    <div style={{ fontSize: 10, color: done ? C.green : C.muted }}>
                      {done ? "✓ Alcanzado" : `$${fmt(poker)} / $${r.at} · faltan $${fmt(r.at - poker)}`}
                    </div>
                  </div>
                  <div style={{ height: 5, background: C.border, borderRadius: 5, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${Math.max(done ? 100 : pct, 0)}%`, background: done ? C.green : C.accent, borderRadius: 5, transition: "width 0.5s ease" }} />
                  </div>
                </div>
              );
            })}
            {/* Projection */}
            {nextLevel && (
              <div style={{ marginTop: 10, padding: "8px 10px", background: C.surface, borderRadius: 8, fontSize: 11, color: C.muted, lineHeight: 1.5 }}>
                {nextLevel.sessions !== null
                  ? `📈 A tu ritmo (+${fmt(avgLast10)} USD/sesión): ${nextLevel.sessions} sesiones para ${nextLevel.label}`
                  : `⚠ Promedio negativo — enfócate en el juego antes de proyectar ${nextLevel.label}`}
              </div>
            )}
          </div>

          {/* Daily Journal */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "12px 14px", marginBottom: 10 }}>
            <div style={{ fontSize: 8, letterSpacing: 3, color: C.muted, textTransform: "uppercase", marginBottom: 10 }}>Diario del día</div>
            <textarea
              placeholder="Reflexión, mano interesante, decisión clave del día..."
              value={journal}
              onChange={(e) => { setJournal(e.target.value); setJournalSaved(false); }}
              style={{ width: "100%", padding: "11px 12px", borderRadius: 9, border: `1px solid ${C.border}`, background: C.surface, color: C.text, fontSize: 12, fontFamily: "Georgia, serif", boxSizing: "border-box", outline: "none", minHeight: 70, resize: "none", lineHeight: 1.6 }}
            />
            <button onClick={saveJournal} style={{ marginTop: 8, padding: "8px 16px", borderRadius: 8, border: `1px solid ${journalSaved ? C.green : C.border}`, background: journalSaved ? C.greenD + "44" : C.surface, color: journalSaved ? C.green : C.muted, fontSize: 11, cursor: "pointer", fontFamily: "Georgia", transition: "all 0.3s" }}>
              {journalSaved ? "✓ Guardado" : "Guardar nota"}
            </button>
          </div>

        </>}

        {/* ══════════════════════════════════════════════════════════════
            REGISTRAR
        ══════════════════════════════════════════════════════════════ */}
        {tab === "reg" && (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 16 }}>
            <div style={{ fontSize: 8, letterSpacing: 3, color: C.muted, textTransform: "uppercase", marginBottom: 16 }}>Nueva sesión</div>

            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              {[["cash", "Cash NL2"], ["tournament", "Torneo"], ["sports", "Depor"]].map(([v, l]) => (
                <button key={v} onClick={() => setForm({ ...form, type: v })} style={typeBtn(v)}>{l}</button>
              ))}
            </div>

            <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
              <button onClick={() => setForm({ ...form, result: "win" })}  style={resBtn("win")}>▲ Ganancia</button>
              <button onClick={() => setForm({ ...form, result: "loss" })} style={resBtn("loss")}>▼ Pérdida</button>
            </div>

            {/* Sports 5% recommendation */}
            {form.type === "sports" && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, padding: "8px 12px", background: C.gold + "15", borderRadius: 8, border: `1px solid ${C.gold}33` }}>
                <span style={{ fontSize: 11, color: C.gold }}>5% recomendado:</span>
                <span style={{ fontSize: 14, fontWeight: "bold", color: C.gold }}>${sports5pct} MXN</span>
                <button onClick={() => setForm({ ...form, amount: String(sports5pct) })}
                  style={{ marginLeft: "auto", fontSize: 10, padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.gold}55`, background: C.gold + "22", color: C.gold, cursor: "pointer", fontFamily: "Georgia" }}>
                  Usar
                </button>
              </div>
            )}

            <div style={{ fontSize: 9, letterSpacing: 2, color: C.muted, textTransform: "uppercase", marginBottom: 6 }}>Acceso rápido</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 12 }}>
              {(form.type === "sports" ? QUICK_SPORTS : QUICK_POKER).map((q) => (
                <button key={q} onClick={() => setForm({ ...form, amount: String(q) })}
                  style={{ padding: "6px 11px", borderRadius: 8, border: `1px solid ${String(form.amount) === String(q) ? C.accent : C.border}`, background: String(form.amount) === String(q) ? C.accentDim : C.surface, color: String(form.amount) === String(q) ? C.accent : C.muted, fontSize: 12, cursor: "pointer", fontFamily: "Georgia" }}>
                  {form.type === "sports" ? `$${q}` : `${q}$`}
                </button>
              ))}
            </div>

            <input type="number" min="0" step="0.01"
              placeholder={form.type === "sports" ? "Monto en MXN" : "Monto en USD"}
              value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}
              style={{ ...inputStyle, marginBottom: 10 }}
            />
            <input type="text" placeholder="Nota — ej: 'AA vs KK, board seco'"
              value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
              style={{ ...inputStyle, fontSize: 13, marginBottom: 14 }}
            />

            {/* Decision rating */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 9, color: C.muted, letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>Calificación de decisión</div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <StarRating value={form.rating} onChange={(r) => setForm({ ...form, rating: r })} C={C} />
                <div style={{ fontSize: 11, color: C.muted }}>
                  {form.rating === 0 ? "Sin calificar" : ["", "Muy mal", "Mal", "Regular", "Bien", "Excelente"][form.rating]}
                </div>
              </div>
            </div>

            <button onClick={addSession}
              style={{ width: "100%", padding: 15, borderRadius: 10, border: "none", cursor: "pointer", background: form.result === "win" ? C.greenD : C.redD, color: form.result === "win" ? C.green : C.red, fontSize: 14, fontFamily: "Georgia, serif", fontWeight: "bold", letterSpacing: 2 }}>
              REGISTRAR
            </button>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════
            ANALYTICS — sub-tabs: general | months | tournaments
        ══════════════════════════════════════════════════════════════ */}
        {tab === "analytics" && (
          <div>
            {/* Sub-tab bar */}
            <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
              {[["general", "General"], ["months", "Meses"], ["tournaments", "Torneos"]].map(([v, l]) => (
                <button key={v} onClick={() => setAnalyticsView(v)}
                  style={{ flex: 1, padding: "8px 4px", borderRadius: 9, border: `1px solid ${analyticsView === v ? C.accent + "88" : C.border}`, background: analyticsView === v ? C.accentDim : C.surface, color: analyticsView === v ? C.accent : C.muted, fontSize: 11, cursor: "pointer", fontFamily: "Georgia" }}>
                  {l}
                </button>
              ))}
            </div>

            {/* ── General ── */}
            {analyticsView === "general" && <>
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 16, marginBottom: 10 }}>
                <div style={{ fontSize: 8, letterSpacing: 3, color: C.muted, textTransform: "uppercase", marginBottom: 16 }}>Últimas 7 sesiones poker</div>
                <BarChart data={last7} C={C} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                {[
                  { label: "Profit total",        value: `${sgn(pokerProfit)}$${fmt(Math.abs(pokerProfit))}`,       color: pokerProfit  >= 0 ? C.green : C.red },
                  { label: `Este mes (${monthStr})`, value: `${sgn(thisMonthProfit)}$${fmt(Math.abs(thisMonthProfit))}`, color: thisMonthProfit >= 0 ? C.green : C.red },
                  { label: "Mejor sesión",         value: `+$${fmt(bestSession)}`,  color: C.green },
                  { label: "Peor sesión",          value: `$${fmt(worstSession)}`,  color: C.red   },
                ].map((m) => (
                  <div key={m.label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14 }}>
                    <div style={{ fontSize: 8, letterSpacing: 2, color: C.muted, textTransform: "uppercase", marginBottom: 6 }}>{m.label}</div>
                    <div style={{ fontSize: 22, fontWeight: "bold", color: m.color }}>{m.value}</div>
                  </div>
                ))}
              </div>

              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14, marginBottom: 10 }}>
                <div style={{ fontSize: 8, letterSpacing: 3, color: C.muted, textTransform: "uppercase", marginBottom: 12 }}>Promedios</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  {[
                    { label: "Promedio",        value: `${sgn(avgSession)}$${fmt(Math.abs(avgSession))}`, c: avgSession >= 0 ? C.green : C.red },
                    { label: `Ses. ${monthStr}`, value: thisMonthSessions.length, c: C.accent },
                    { label: "Win rate",         value: pokerSessions.length ? `${((pokerWins / pokerSessions.length) * 100).toFixed(0)}%` : "—", c: C.text },
                  ].map((x) => (
                    <div key={x.label} style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 20, fontWeight: "bold", color: x.c }}>{x.value}</div>
                      <div style={{ fontSize: 8, color: C.muted, marginTop: 3, letterSpacing: 1, textTransform: "uppercase" }}>{x.label}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* $/hora and BB/100 */}
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14, marginBottom: 10 }}>
                <div style={{ fontSize: 8, letterSpacing: 3, color: C.muted, textTransform: "uppercase", marginBottom: 12 }}>Rentabilidad por hora</div>
                {sessionsWithDuration.length === 0 ? (
                  <div style={{ fontSize: 12, color: C.textDim, textAlign: "center", padding: "8px 0" }}>
                    Usa el timer al jugar para calcular $/hora y BB/100
                  </div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                    {[
                      { label: "$/hora",           value: avgPerHour !== null ? `${sgn(avgPerHour)}$${fmt(Math.abs(avgPerHour), 2)}` : "—", c: avgPerHour !== null && avgPerHour >= 0 ? C.green : C.red },
                      { label: "BB/100 (NL2)",     value: bb100 !== null ? `${sgn(bb100)}${fmt(Math.abs(bb100), 1)}` : "—", c: bb100 !== null && bb100 >= 0 ? C.green : C.red },
                      { label: "Ses. con timer",   value: sessionsWithDuration.length, c: C.accent },
                    ].map((x) => (
                      <div key={x.label} style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 18, fontWeight: "bold", color: x.c }}>{x.value}</div>
                        <div style={{ fontSize: 8, color: C.muted, marginTop: 3, letterSpacing: 1, textTransform: "uppercase" }}>{x.label}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Heatmap calendar */}
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14, marginBottom: 10 }}>
                <div style={{ fontSize: 8, letterSpacing: 3, color: C.muted, textTransform: "uppercase", marginBottom: 12 }}>Heatmap — {monthStr}</div>
                <HeatmapCalendar sessions={pokerSessions} monthStr={monthStr} C={C} />
              </div>

              {/* Equity curve */}
              {pokerCurve.length >= 2 && (
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14 }}>
                  <div style={{ fontSize: 8, letterSpacing: 3, color: C.muted, textTransform: "uppercase", marginBottom: 8 }}>Curva de equity</div>
                  <svg viewBox="0 0 300 60" style={{ width: "100%", height: 60, display: "block" }}>
                    {(() => {
                      const pts = pokerCurve;
                      const mn  = Math.min(...pts) - 1, mx = Math.max(...pts) + 1;
                      const range = mx - mn || 1;
                      const W = 300, H = 58;
                      const points     = pts.map((v, i) => `${(i / (pts.length - 1)) * W},${H - ((v - mn) / range) * H}`).join(" ");
                      const areaPoints = `0,${H} ${points} ${W},${H}`;
                      return (
                        <>
                          <defs>
                            <linearGradient id="eqgrad" x1="0" x2="0" y1="0" y2="1">
                              <stop offset="0%"   stopColor={pokerProfit >= 0 ? C.green : C.red} stopOpacity="0.2" />
                              <stop offset="100%" stopColor={pokerProfit >= 0 ? C.green : C.red} stopOpacity="0" />
                            </linearGradient>
                          </defs>
                          <polygon fill="url(#eqgrad)" points={areaPoints} />
                          <polyline fill="none" stroke={pokerProfit >= 0 ? C.green : C.red} strokeWidth="1.5" strokeLinejoin="round" points={points} />
                        </>
                      );
                    })()}
                  </svg>
                </div>
              )}
            </>}

            {/* ── Month comparison ── */}
            {analyticsView === "months" && (
              <div>
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 16, marginBottom: 10 }}>
                  <div style={{ fontSize: 8, letterSpacing: 3, color: C.muted, textTransform: "uppercase", marginBottom: 14 }}>Comparativa por mes — poker</div>
                  {monthlyBreakdown.length === 0 ? (
                    <div style={{ textAlign: "center", color: C.textDim, fontSize: 12, padding: 16 }}>Sin datos suficientes</div>
                  ) : (
                    monthlyBreakdown.map((m) => {
                      const maxP    = Math.max(...monthlyBreakdown.map((x) => Math.abs(x.profit)), 1);
                      const barPct  = Math.abs(m.profit) / maxP * 100;
                      const isPos   = m.profit >= 0;
                      return (
                        <div key={m.month} style={{ marginBottom: 14 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                            <div style={{ fontSize: 12, color: C.text, fontWeight: "bold", textTransform: "uppercase", letterSpacing: 2 }}>{m.month}</div>
                            <div style={{ display: "flex", gap: 12, fontSize: 11 }}>
                              <span style={{ color: C.muted }}>{m.sessions} ses.</span>
                              <span style={{ color: C.muted }}>{m.winRate}% wr</span>
                              <span style={{ color: isPos ? C.green : C.red, fontWeight: "bold" }}>{sgn(m.profit)}${fmt(Math.abs(m.profit))}</span>
                            </div>
                          </div>
                          <div style={{ height: 6, background: C.border, borderRadius: 6, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${barPct}%`, background: isPos ? C.green : C.red, borderRadius: 6, transition: "width 0.4s ease" }} />
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {/* ── Tournament ROI ── */}
            {analyticsView === "tournaments" && (
              <div>
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 16, marginBottom: 10 }}>
                  <div style={{ fontSize: 8, letterSpacing: 3, color: C.gold, textTransform: "uppercase", marginBottom: 16 }}>Rendimiento en torneos</div>
                  {!tournamentROI ? (
                    <div style={{ textAlign: "center", color: C.textDim, fontSize: 12, padding: 16 }}>Sin torneos registrados</div>
                  ) : (
                    <>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                        {[
                          { l: "ROI",            v: `${sgn(tournamentROI.roi)}${fmt(Math.abs(tournamentROI.roi), 1)}%`, c: tournamentROI.roi  >= 0 ? C.green : C.red },
                          { l: "ITM %",          v: `${fmt(tournamentROI.itm, 1)}%`,                                   c: tournamentROI.itm  >= 33 ? C.green : C.gold },
                          { l: "Total torneos",  v: tournamentROI.total,                                                c: C.text  },
                          { l: "Profit neto",    v: `${sgn(tournamentROI.profit)}$${fmt(Math.abs(tournamentROI.profit))}`, c: tournamentROI.profit >= 0 ? C.green : C.red },
                        ].map((m) => (
                          <div key={m.l} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, textAlign: "center" }}>
                            <div style={{ fontSize: 22, fontWeight: "bold", color: m.c }}>{m.v}</div>
                            <div style={{ fontSize: 9, color: C.muted, marginTop: 4, letterSpacing: 1, textTransform: "uppercase" }}>{m.l}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{ padding: "10px 12px", background: C.surface, borderRadius: 10, fontSize: 11, color: C.muted, lineHeight: 1.6 }}>
                        Invertido: ${fmt(tournamentROI.invested)} USD · Ganadas: {tournamentROI.wins} de {tournamentROI.total}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════
            SPOTS & LEAKS
        ══════════════════════════════════════════════════════════════ */}
        {tab === "leaks" && (
          <div>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 16, marginBottom: 14 }}>
              <div style={{ fontSize: 8, letterSpacing: 3, color: C.gold, textTransform: "uppercase", marginBottom: 14 }}>Registrar leak / error</div>
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 8, letterSpacing: 1 }}>Posición</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 12 }}>
                {POSITIONS.map((p) => (
                  <button key={p} onClick={() => setLeakForm({ ...leakForm, position: p })}
                    style={{ padding: "7px 11px", borderRadius: 8, border: `1px solid ${leakForm.position === p ? C.gold : C.border}`, background: leakForm.position === p ? C.gold + "22" : C.surface, color: leakForm.position === p ? C.gold : C.muted, fontSize: 11, cursor: "pointer", fontFamily: "Georgia" }}>
                    {p}
                  </button>
                ))}
              </div>
              <textarea
                placeholder="Describe el error... ej: Pagué 3bet OOP con AJo"
                value={leakForm.note} onChange={(e) => setLeakForm({ ...leakForm, note: e.target.value })}
                style={{ ...inputStyle, fontSize: 13, minHeight: 80, resize: "none", lineHeight: 1.6, marginBottom: 14 }}
              />
              <button onClick={addLeak} style={{ width: "100%", padding: 14, borderRadius: 10, border: "none", cursor: "pointer", background: C.gold + "22", color: C.gold, fontSize: 14, fontFamily: "Georgia", fontWeight: "bold", letterSpacing: 2 }}>
                GUARDAR LEAK
              </button>
            </div>

            <div style={{ background: C.surface, borderRadius: 14, padding: "0 12px" }}>
              <div style={{ fontSize: 8, letterSpacing: 3, color: C.muted, textTransform: "uppercase", padding: "14px 0 10px" }}>
                Áreas de mejora ({leakSessions.length})
              </div>
              {leakSessions.map((s) => (
                <div key={s.id} style={{ display: "flex", gap: 12, padding: "12px 0", borderBottom: `1px solid ${C.border}` }}>
                  <div style={{ background: C.card, border: `1px solid ${C.border}`, color: leakAlerts.some((a) => a.pos === (s.buyin || "GNRL")) ? C.red : C.gold, padding: "4px 8px", borderRadius: 6, fontSize: 10, fontWeight: "bold", whiteSpace: "nowrap", height: "fit-content", marginTop: 2 }}>
                    {s.buyin || "GNRL"}
                    {leakAlerts.some((a) => a.pos === (s.buyin || "GNRL")) && " ⚑"}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, color: C.text, lineHeight: 1.5 }}>{s.note}</div>
                    <div style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>{s.date}</div>
                  </div>
                </div>
              ))}
              {leakSessions.length === 0 && (
                <div style={{ textAlign: "center", color: C.muted, padding: "24px 0", fontSize: 12 }}>Sin leaks registrados. ¡Excelente!</div>
              )}
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════
            HISTORIAL
        ══════════════════════════════════════════════════════════════ */}
        {tab === "hist" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 8, letterSpacing: 3, color: C.muted, textTransform: "uppercase" }}>{showArchived ? "Archivadas" : "Historial"}</div>
              <button onClick={() => setShowArchived(!showArchived)} style={{ fontSize: 10, background: "none", border: `1px solid ${C.border}`, color: C.muted, padding: "4px 10px", borderRadius: 6, cursor: "pointer" }}>
                {showArchived ? "Ver activas" : "Archivadas"}
              </button>
            </div>
            {(() => {
              const grouped = showArchived ? groupedArchived : groupedActive;
              if (grouped.length === 0) return (
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 32, textAlign: "center", color: C.muted, fontSize: 13 }}>
                  Sin sesiones registradas
                </div>
              );
              return grouped.map(([date, daySessions]) => {
                const dayTotal       = daySessions.filter((s) => s.type !== "sports").reduce((a, s) => a + s.amount, 0);
                const dayTotalSports = daySessions.filter((s) => s.type === "sports").reduce((a, s) => a + s.amount, 0);
                return (
                  <div key={date} style={{ marginBottom: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 4px", marginBottom: 2 }}>
                      <div style={{ fontSize: 10, color: C.accent, letterSpacing: 2, textTransform: "uppercase" }}>{date}</div>
                      <div style={{ display: "flex", gap: 8 }}>
                        {daySessions.some((s) => s.type !== "sports") && (
                          <div style={{ fontSize: 10, fontWeight: "bold", color: dayTotal >= 0 ? C.green : C.red }}>
                            {sgn(dayTotal)}{fmt(dayTotal)} USD
                          </div>
                        )}
                        {dayTotalSports !== 0 && (
                          <div style={{ fontSize: 10, fontWeight: "bold", color: dayTotalSports >= 0 ? C.accent : C.red }}>
                            {sgn(dayTotalSports)}{fmt(dayTotalSports, 0)} MXN
                          </div>
                        )}
                      </div>
                    </div>
                    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
                      {daySessions.map((s, i) => (
                        <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 14px", borderBottom: i < daySessions.length - 1 ? `1px solid ${C.border}` : "none" }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 12, color: C.text }}>
                              <span style={{ fontSize: 8, letterSpacing: 2, textTransform: "uppercase", color: s.type === "sports" ? C.accent : s.type === "tournament" ? C.gold : C.green, marginRight: 6 }}>{s.type}</span>
                              {s.note && <span style={{ color: C.textDim }}>{s.note}</span>}
                            </div>
                            <div style={{ display: "flex", gap: 8, marginTop: 3 }}>
                              {s.rating > 0 && <span style={{ fontSize: 10, color: C.gold }}>{"★".repeat(s.rating)}{"☆".repeat(5 - s.rating)}</span>}
                              {s.duration > 0 && <span style={{ fontSize: 10, color: C.muted }}>{Math.round(s.duration / 60000)} min</span>}
                            </div>
                          </div>
                          <div style={{ fontSize: 15, fontWeight: "bold", color: s.amount > 0 ? C.green : C.red }}>
                            {s.amount > 0 ? "+" : ""}{fmt(s.amount)} {s.type === "sports" ? "MXN" : "USD"}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════
            REGLAS & CONFIG
        ══════════════════════════════════════════════════════════════ */}
        {tab === "rules" && (
          <div>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 16, marginBottom: 12 }}>
              <div style={{ fontSize: 8, letterSpacing: 3, color: C.muted, textTransform: "uppercase", marginBottom: 14 }}>⚙️ Capital inicial</div>
              <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 9, color: C.muted, marginBottom: 4, letterSpacing: 1 }}>Poker (USD)</div>
                  <input type="number" min="0" value={baseCapital.poker} onChange={(e) => setBaseCapital({ ...baseCapital, poker: Number(e.target.value) })} style={{ ...inputStyle, fontSize: 14, padding: "10px" }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 9, color: C.muted, marginBottom: 4, letterSpacing: 1 }}>Depor (MXN)</div>
                  <input type="number" min="0" value={baseCapital.sports} onChange={(e) => setBaseCapital({ ...baseCapital, sports: Number(e.target.value) })} style={{ ...inputStyle, fontSize: 14, padding: "10px" }} />
                </div>
              </div>

              {/* Monthly goal */}
              <div style={{ fontSize: 9, color: C.muted, marginBottom: 4, letterSpacing: 1, textTransform: "uppercase" }}>Meta mensual poker (USD)</div>
              <input type="number" min="0" value={monthlyGoal}
                onChange={(e) => setMonthlyGoal(Number(e.target.value))}
                style={{ ...inputStyle, fontSize: 14, padding: "10px", marginBottom: 16 }}
              />

              {/* Accent color picker */}
              <div style={{ fontSize: 9, color: C.muted, marginBottom: 8, letterSpacing: 1, textTransform: "uppercase" }}>Color del tema</div>
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                {ACCENT_PRESETS.map((p) => (
                  <button key={p.v} onClick={() => handleSetAccent(p.v)}
                    style={{ width: 28, height: 28, borderRadius: "50%", border: `2px solid ${accent === p.v ? "#fff" : "transparent"}`, background: p.v, cursor: "pointer", boxShadow: accent === p.v ? `0 0 0 1px ${p.v}` : "none", transition: "all 0.2s" }} />
                ))}
              </div>

              {/* Recent colors */}
              {recentColors.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 9, color: C.muted, marginBottom: 6, letterSpacing: 1, textTransform: "uppercase" }}>Recientes</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {recentColors.map((col) => (
                      <button key={col} onClick={() => handleSetAccent(col)}
                        style={{ width: 24, height: 24, borderRadius: "50%", border: `2px solid ${accent === col ? "#fff" : "transparent"}`, background: col, cursor: "pointer", boxShadow: accent === col ? `0 0 0 1px ${col}` : "none" }} />
                    ))}
                  </div>
                </div>
              )}

              {/* Custom hex input */}
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                <input
                  type="text" placeholder="#60a5fa" value={customHex}
                  onChange={(e) => setCustomHex(e.target.value)}
                  style={{ ...inputStyle, fontSize: 13, padding: "8px 12px", flex: 1 }}
                  maxLength={7}
                />
                <button
                  onClick={() => { if (isValid(customHex)) { handleSetAccent(customHex); setCustomHex(""); } else alert("Hex inválido. Usa formato #RRGGBB"); }}
                  style={{ padding: "8px 14px", borderRadius: 9, border: `1px solid ${C.border}`, background: customHex && isValid(customHex) ? customHex + "33" : C.surface, color: C.muted, fontSize: 12, cursor: "pointer", fontFamily: "Georgia", whiteSpace: "nowrap" }}>
                  Aplicar
                </button>
              </div>

              <button onClick={saveConfig} style={{ width: "100%", padding: 12, borderRadius: 9, border: "none", background: C.accentDim, color: C.accent, fontSize: 11, cursor: "pointer", fontFamily: "Georgia", fontWeight: "bold", letterSpacing: 2, textTransform: "uppercase" }}>
                Guardar configuración
              </button>
            </div>

            {/* Rules accordions */}
            {[
              { k: "cash", l: "Cash NL2", c: C.green },
              { k: "tournament", l: "Torneos", c: C.accent },
              { k: "sports", l: "Deportivas", c: C.gold },
              { k: "casino", l: "Casino — Prohibido", c: C.red },
            ].map((sec) => (
              <div key={sec.k} style={{ marginBottom: 8 }}>
                <button onClick={() => setRulesOpen(rulesOpen === sec.k ? null : sec.k)}
                  style={{ width: "100%", textAlign: "left", padding: "13px 16px", borderRadius: rulesOpen === sec.k ? "12px 12px 0 0" : 12, border: `1px solid ${rulesOpen === sec.k ? sec.c + "55" : C.border}`, background: C.card, color: sec.c, fontFamily: "Georgia", fontSize: 13, cursor: "pointer", display: "flex", justifyContent: "space-between" }}>
                  {sec.l} <span style={{ color: C.muted }}>{rulesOpen === sec.k ? "▲" : "▼"}</span>
                </button>
                {rulesOpen === sec.k && (
                  <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderTop: "none", borderRadius: "0 0 12px 12px", padding: "6px 16px 10px" }}>
                    {RULES[sec.k].map((r, i) => (
                      <div key={i} style={{ fontSize: 12, color: C.textDim, padding: "7px 0", borderBottom: i < RULES[sec.k].length - 1 ? `1px solid ${C.border}` : "none", lineHeight: 1.5 }}>
                        {sec.k === "casino" ? `❌ ${r}` : `${i + 1}. ${r}`}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}

            <div style={{ marginTop: 24, borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
              {pushStatus !== "Activas" && (
                <button onClick={requestNotificationPermission}
                  style={{ width: "100%", padding: 12, marginBottom: 10, borderRadius: 10, border: `1px solid ${C.accentMid}`, background: C.accentDim, color: C.accent, fontSize: 11, cursor: "pointer", fontFamily: "Georgia", textTransform: "uppercase", fontWeight: "bold", letterSpacing: 2 }}>
                  🔔 Activar alertas · {pushStatus}
                </button>
              )}

              {/* Export CSV */}
              <button onClick={exportCSV}
                style={{ width: "100%", padding: 12, marginBottom: 10, borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface, color: C.muted, fontSize: 11, cursor: "pointer", fontFamily: "Georgia", letterSpacing: 2 }}>
                📥 Exportar historial CSV
              </button>

              <button onClick={handleLogout} style={{ width: "100%", padding: 12, marginBottom: 10, borderRadius: 10, background: "transparent", border: `1px solid ${C.muted}`, color: C.textDim, fontSize: 11, cursor: "pointer", fontFamily: "Georgia", letterSpacing: 2 }}>
                CERRAR SESIÓN
              </button>
              <button onClick={archiveAll} style={{ width: "100%", padding: 12, borderRadius: 10, background: "transparent", border: `1px solid ${C.redD}`, color: "#aa3333", fontSize: 10, cursor: "pointer", fontFamily: "Georgia", letterSpacing: 2 }}>
                ARCHIVAR Y RESETEAR
              </button>
            </div>
          </div>
        )}

      </div>

      {/* ── BOTTOM NAV ─────────────────────────────────────────────────── */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: C.surface, borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "center", zIndex: 10 }}>
        <div style={{ display: "flex", width: "100%", maxWidth: 480 }}>
          {[
            { k: "dash",      icon: "◈", l: "Inicio"   },
            { k: "reg",       icon: "+", l: "Sesión"   },
            { k: "analytics", icon: "↗", l: "Stats"    },
            { k: "leaks",     icon: "⚑", l: "Leaks"    },
            { k: "hist",      icon: "≡", l: "Historial"},
            { k: "rules",     icon: "◉", l: "Config"   },
          ].map((t) => (
            <button key={t.k} onClick={() => setTab(t.k)}
              style={{ flex: 1, padding: "13px 2px 9px", border: "none", background: "transparent", cursor: "pointer", color: tab === t.k ? C.accent : C.muted, fontFamily: "Georgia", transition: "color 0.2s" }}>
              <div style={{ fontSize: 14 }}>{t.icon}</div>
              <div style={{ fontSize: 6, letterSpacing: 1, marginTop: 3, textTransform: "uppercase" }}>{t.l}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
