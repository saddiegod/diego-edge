import { useState, useEffect, useCallback } from "react";
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
    "Máximo 5% del bankroll por apuesta ($25 MXN)",
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

// Group sessions by date string
const groupByDate = (arr) => {
  const map = {};
  arr.forEach((s) => {
    if (!map[s.date]) map[s.date] = [];
    map[s.date].push(s);
  });
  return Object.entries(map); // [ [date, [sessions]] ]
};

// ─── COLOR SYSTEM ────────────────────────────────────────────────────────────

const makeC = (accent = "#60a5fa") => ({
  bg: "#06060e",
  surface: "#0b0b1a",
  card: "#0f0f20",
  cardHi: "#13132a",
  border: "#1a1a32",
  borderHi: "#25254a",
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
  blueD: "#1e3a5f",
});

// ─── SPARKLINE ───────────────────────────────────────────────────────────────

const Sparkline = ({ data, color, W = 120, H = 32 }) => {
  if (!data || data.length < 2) return null;
  const mn = Math.min(...data) - 0.5;
  const mx = Math.max(...data) + 0.5;
  const range = mx - mn || 1;
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * W},${H - ((v - mn) / range) * (H - 2) + 1}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H, display: "block", marginTop: 8 }}>
      <defs>
        <linearGradient id={`sg${color.replace("#", "")}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" points={pts} />
    </svg>
  );
};

// ─── BAR CHART (Analytics) ───────────────────────────────────────────────────

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
            <div
              style={{
                width: "100%",
                height: h,
                background: isPos ? `linear-gradient(180deg, ${C.green}cc, ${C.green}44)` : `linear-gradient(0deg, ${C.red}cc, ${C.red}44)`,
                borderRadius: isPos ? "4px 4px 0 0" : "0 0 4px 4px",
                transition: "height 0.4s ease",
              }}
            />
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
  // ── Auth ─────────────────────────────────────────────────────────────────
  const [session, setSession] = useState(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [isLogin, setIsLogin] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);

  // ── Core ─────────────────────────────────────────────────────────────────
  const [tab, setTab] = useState("dash");
  const [sessions, setSessions] = useState([]);
  const [baseCapital, setBaseCapital] = useState({ poker: 50, sports: 500 });
  const [poker, setPoker] = useState(50);
  const [sports, setSports] = useState(500);
  const [habits, setHabits] = useState({ meditar: false, agua: false, omega: false, ejercicio: false });
  const [tilt, setTilt] = useState({});
  const [form, setForm] = useState({ type: "cash", result: "win", amount: "", note: "" });
  const [leakForm, setLeakForm] = useState({ position: "BTN", note: "" });
  const [rulesOpen, setRulesOpen] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [flash, setFlash] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [pushStatus, setPushStatus] = useState("Checking...");

  // ── New features ─────────────────────────────────────────────────────────
  const [accent, setAccent] = useState("#60a5fa");
  const [timerActive, setTimerActive] = useState(false);
  const [timerStart, setTimerStart] = useState(null);
  const [timerElapsed, setTimerElapsed] = useState(0);
  const [journal, setJournal] = useState("");
  const [journalSaved, setJournalSaved] = useState(false);

  const C = makeC(accent);

  const active = sessions.filter((x) => !x.archived);
  const archived = sessions.filter((x) => x.archived);
  const todayStr = new Date().toLocaleDateString("es-MX", { day: "2-digit", month: "short" });

  // ── Timer ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!timerActive) return;
    const id = setInterval(() => setTimerElapsed(Date.now() - timerStart), 1000);
    return () => clearInterval(id);
  }, [timerActive, timerStart]);

  const toggleTimer = () => {
    if (timerActive) {
      setTimerActive(false);
    } else {
      setTimerStart(Date.now() - timerElapsed);
      setTimerActive(true);
    }
  };

  const resetTimer = () => {
    setTimerActive(false);
    setTimerElapsed(0);
    setTimerStart(null);
  };

  // ── Auth ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => setSession(session));
    return () => subscription.unsubscribe();
  }, []);

  const handleAuth = async (e) => {
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
    } catch (err) {
      alert(err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setSessions([]);
    setLoaded(false);
  };

  // ── Notifications ─────────────────────────────────────────────────────────
  const sendAlert = async (title, body) => {
    if ("serviceWorker" in navigator && Notification.permission === "granted") {
      try {
        const reg = await navigator.serviceWorker.ready;
        reg.showNotification(title, { body, icon: "/icon.png", vibrate: [200, 100, 200] });
      } catch (e) {}
    }
  };

  const requestNotificationPermission = async () => {
    if (!("Notification" in window)) { alert("Tu navegador no soporta notificaciones."); return; }
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      setPushStatus("Activas");
      sendAlert("♠️ Diego's Edge", "Alertas activadas. Listo para grindear.");
    } else {
      setPushStatus("Denegado");
    }
  };

  // ── Time alerts ───────────────────────────────────────────────────────────
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
        const todaySess = active.filter((s) => s.date === todayStr && s.type !== "leak");
        if (todaySess.length > 0) {
          const pokerTotal = todaySess.filter((s) => s.type !== "sports").reduce((a, s) => a + s.amount, 0);
          const sportsTotal = todaySess.filter((s) => s.type === "sports").reduce((a, s) => a + s.amount, 0);
          sendAlert("📊 Resumen del Día", `Poker: ${sgn(pokerTotal)}${fmt(pokerTotal)} USD | Depor: ${sgn(sportsTotal)}${fmt(sportsTotal, 0)} MXN`);
        }
        noted.night = true;
      }
      localStorage.setItem(`bk_alerts_${today}`, JSON.stringify(noted));
    };
    const id = setInterval(checkTimeAlerts, 60000);
    checkTimeAlerts();
    return () => clearInterval(id);
  }, [loaded, active, todayStr, session]);

  // ── Load ──────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!session) return;
    try {
      if ("Notification" in window) setPushStatus(Notification.permission === "granted" ? "Activas" : "Pendiente");

      let currentBase = { poker: 50, sports: 500 };
      const meta = session.user.user_metadata;
      if (meta?.base_capital) { currentBase = meta.base_capital; setBaseCapital(currentBase); }
      if (meta?.accent) setAccent(meta.accent);

      const today = new Date().toLocaleDateString("es-MX");
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
        const loadedHabits = { meditar: false, agua: false, omega: false, ejercicio: false };
        const loadedTilt = {};
        let loadedJournal = "";
        hData.forEach((item) => {
          if (item.id === "journal") loadedJournal = item.note || "";
          else if (item.id.startsWith("tilt_")) loadedTilt[item.id.replace("tilt_", "")] = item.status;
          else loadedHabits[item.id] = item.status;
        });
        setHabits(loadedHabits);
        setTilt(loadedTilt);
        setJournal(loadedJournal);
      }
    } catch (err) {
      console.error("Error cargando:", err);
    }
    setLoaded(true);
  }, [session]);

  useEffect(() => { load(); }, [load]);

  // ── Save config ───────────────────────────────────────────────────────────
  const saveConfig = async () => {
    await supabase.auth.updateUser({ data: { base_capital: baseCapital, accent } });
    load();
    sendAlert("⚙️ Config guardada", "Capital y tema actualizados.");
  };

  // ── Add session ───────────────────────────────────────────────────────────
  const addSession = async () => {
    const amt = parseFloat(form.amount);
    if (!amt || amt <= 0) return;
    const value = form.result === "win" ? amt : -amt;
    const s = {
      id: Date.now(),
      user_id: session.user.id,
      type: form.type,
      amount: value,
      note: form.note,
      date: todayStr,
      archived: false,
    };
    const { error } = await supabase.from("sessions").insert([s]);
    if (!error) {
      setSessions([s, ...sessions]);
      if (form.type === "sports") setSports((p) => parseFloat((p + value).toFixed(2)));
      else setPoker((p) => parseFloat((p + value).toFixed(2)));
      setForm({ ...form, amount: "", note: "" });
      setFlash(value > 0 ? "win" : "loss");
      setTimeout(() => setFlash(null), 900);
      setTab("dash");
      if (form.type === "cash" && value <= -6) sendAlert("⚠️ STOP LOSS", "3 buy-ins perdidos. Cierra la mesa.");
      if (form.type === "cash" && value >= 10) sendAlert("🏆 Buena sesión", "Protege las ganancias.");
    } else {
      alert("Error al guardar.");
    }
  };

  // ── Add leak ──────────────────────────────────────────────────────────────
  const addLeak = async () => {
    if (!leakForm.note.trim()) return;
    const s = {
      id: Date.now(),
      user_id: session.user.id,
      type: "leak",
      amount: 0,
      note: leakForm.note,
      buyin: leakForm.position,
      date: todayStr,
      archived: false,
    };
    const { error } = await supabase.from("sessions").insert([s]);
    if (!error) {
      setSessions([s, ...sessions]);
      setLeakForm({ ...leakForm, note: "" });
      setFlash("win");
      setTimeout(() => setFlash(null), 900);
    } else {
      alert("Error al guardar leak.");
    }
  };

  // ── Toggle habit ──────────────────────────────────────────────────────────
  const toggleHabit = async (k) => {
    const next = !habits[k];
    setHabits({ ...habits, [k]: next });
    await supabase.from("daily_habits").upsert({ id: k, user_id: session.user.id, status: next });
  };

  const toggleTilt = async (k) => {
    const next = !tilt[k];
    setTilt({ ...tilt, [k]: next });
    await supabase.from("daily_habits").upsert({ id: `tilt_${k}`, user_id: session.user.id, status: next });
  };

  // ── Save journal ──────────────────────────────────────────────────────────
  const saveJournal = async () => {
    await supabase.from("daily_habits").upsert({ id: "journal", user_id: session.user.id, status: false, note: journal });
    setJournalSaved(true);
    setTimeout(() => setJournalSaved(false), 2000);
  };

  // ── Archive all ───────────────────────────────────────────────────────────
  const archiveAll = async () => {
    if (!confirm("¿Archivar todos los datos y empezar desde cero?")) return;
    const activeIds = sessions.filter((s) => !s.archived).map((s) => s.id);
    if (activeIds.length > 0) await supabase.from("sessions").update({ archived: true }).in("id", activeIds);
    await supabase.from("daily_habits").delete().eq("user_id", session.user.id).neq("id", "dummy");
    setSessions(sessions.map((s) => ({ ...s, archived: true })));
    setPoker(baseCapital.poker);
    setSports(baseCapital.sports);
    setHabits({ meditar: false, agua: false, omega: false, ejercicio: false });
    setTilt({});
    setJournal("");
    setTab("dash");
  };

  // ─── DERIVED STATE ────────────────────────────────────────────────────────

  const pokerSessions = active.filter((x) => x.type !== "sports" && x.type !== "leak");
  const sportsSessions = active.filter((x) => x.type === "sports");
  const leakSessions = active.filter((x) => x.type === "leak");

  const pokerWins = pokerSessions.filter((x) => x.amount > 0).length;
  const pokerProfit = parseFloat((poker - baseCapital.poker).toFixed(2));
  const sportsProfit = parseFloat((sports - baseCapital.sports).toFixed(2));

  const tiltScore = TILT_QS.filter((q) => tilt[q.id]).length;
  const tiltColor = tiltScore >= 4 ? C.green : tiltScore >= 2 ? C.gold : C.red;
  const tiltLabel = tiltScore >= 4 ? "Óptimo" : tiltScore >= 2 ? "Cuidado" : "No juegues";

  const streak = (() => {
    let s = 0;
    for (const x of pokerSessions) { if (x.amount > 0) s++; else break; }
    return s;
  })();

  const danger = poker < baseCapital.poker * 0.6;
  const warning = poker < baseCapital.poker * 0.8 && poker >= baseCapital.poker * 0.6;

  // Sparkline data points (cumulative)
  const pokerCurve = (() => {
    const pts = [baseCapital.poker];
    let cur = baseCapital.poker;
    [...pokerSessions].reverse().forEach((s) => { cur = parseFloat((cur + s.amount).toFixed(2)); pts.push(cur); });
    return pts;
  })();

  const sportsCurve = (() => {
    const pts = [baseCapital.sports];
    let cur = baseCapital.sports;
    [...sportsSessions].reverse().forEach((s) => { cur = parseFloat((cur + s.amount).toFixed(2)); pts.push(cur); });
    return pts;
  })();

  // Analytics: last 7 poker sessions
  const last7 = [...pokerSessions].slice(0, 7).reverse().map((s, i) => ({
    value: s.amount,
    label: s.date.replace(/\s/g, "\n"),
  }));

  // Best/worst/avg
  const pokerAmounts = pokerSessions.map((s) => s.amount);
  const bestSession = pokerAmounts.length ? Math.max(...pokerAmounts) : 0;
  const worstSession = pokerAmounts.length ? Math.min(...pokerAmounts) : 0;
  const avgSession = pokerAmounts.length ? pokerAmounts.reduce((a, b) => a + b, 0) / pokerAmounts.length : 0;

  // This month sessions
  const now = new Date();
  const monthStr = now.toLocaleDateString("es-MX", { month: "short" });
  const thisMonthSessions = pokerSessions.filter((s) => s.date.includes(monthStr));
  const thisMonthProfit = thisMonthSessions.reduce((a, s) => a + s.amount, 0);

  // ─── STYLE HELPERS ────────────────────────────────────────────────────────

  const pill = (on, color) => ({
    padding: "8px 14px",
    borderRadius: 20,
    border: `1px solid ${on ? color : C.border}`,
    background: on ? color + "22" : "transparent",
    color: on ? color : C.muted,
    fontSize: 12,
    cursor: "pointer",
    fontFamily: "Georgia, serif",
    transition: "all 0.2s",
  });

  const typeBtn = (v) => ({
    flex: 1,
    padding: "10px 4px",
    borderRadius: 8,
    border: `1px solid ${form.type === v ? C.accent + "88" : C.border}`,
    cursor: "pointer",
    background: form.type === v ? C.accentDim : C.surface,
    color: form.type === v ? C.accent : C.muted,
    fontFamily: "Georgia, serif",
    fontSize: 11,
    transition: "all 0.2s",
  });

  const resBtn = (v) => ({
    flex: 1,
    padding: 13,
    borderRadius: 8,
    border: "none",
    cursor: "pointer",
    background: form.result === v ? (v === "win" ? C.greenD : C.redD) : C.surface,
    color: form.result === v ? (v === "win" ? C.green : C.red) : C.muted,
    fontFamily: "Georgia, serif",
    fontSize: 13,
    transition: "all 0.2s",
  });

  const inputStyle = {
    width: "100%",
    padding: "13px 14px",
    borderRadius: 9,
    border: `1px solid ${C.border}`,
    background: C.surface,
    color: C.text,
    fontSize: 15,
    fontFamily: "Georgia, serif",
    boxSizing: "border-box",
    outline: "none",
  };

  // ─── LOGIN SCREEN ─────────────────────────────────────────────────────────

  if (!session) {
    return (
      <div style={{ background: C.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: "Georgia, serif" }}>
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 18, padding: 32, width: "100%", maxWidth: 360 }}>
          <div style={{ textAlign: "center", marginBottom: 32 }}>
            <div style={{ fontSize: 9, letterSpacing: 5, color: C.muted, textTransform: "uppercase", marginBottom: 10 }}>Sistema de gestión</div>
            <div style={{ fontSize: 26, fontWeight: "bold", color: C.text, letterSpacing: -0.5 }}>Diego's Edge ♠</div>
          </div>
          <form onSubmit={handleAuth}>
            <input type="email" placeholder="Correo electrónico" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} required
              style={{ ...inputStyle, marginBottom: 12, fontSize: 14 }} />
            <input type="password" placeholder="Contraseña" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} required
              style={{ ...inputStyle, marginBottom: 20, fontSize: 14 }} />
            <button type="submit" disabled={authLoading}
              style={{ width: "100%", padding: 14, borderRadius: 10, border: "none", background: C.accentDim, color: C.accent, fontSize: 13, fontWeight: "bold", cursor: "pointer", letterSpacing: 2, textTransform: "uppercase" }}>
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

  // ─── LOADING ──────────────────────────────────────────────────────────────

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

      {/* Flash overlay */}
      {flash && (
        <div style={{ position: "fixed", inset: 0, background: flash === "win" ? "rgba(74,222,128,0.06)" : "rgba(248,113,113,0.06)", pointerEvents: "none", zIndex: 999, transition: "opacity 0.3s" }} />
      )}

      {/* ── HEADER ──────────────────────────────────────────────────────── */}
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

      <div style={{ padding: "14px 16px", maxWidth: 480, margin: "0 auto" }}>

        {/* ════════════════════════════════════════════════════════════════
            DASHBOARD
        ════════════════════════════════════════════════════════════════ */}
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
              <Sparkline data={pokerCurve} color={pokerProfit >= 0 ? C.green : C.red} />
            </div>

            {/* Sports card */}
            <div style={{ background: C.card, border: `1px solid ${sportsProfit >= 0 ? C.accentMid : C.redD}`, borderRadius: 16, padding: 14, position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: 0, right: 0, width: 60, height: 60, background: (sportsProfit >= 0 ? C.accent : C.red) + "08", borderRadius: "0 16px 0 60px" }} />
              <div style={{ fontSize: 8, letterSpacing: 3, color: C.muted, textTransform: "uppercase", marginBottom: 6 }}>Depor · MXN</div>
              <div style={{ fontSize: 28, fontWeight: "bold", color: sportsProfit >= 0 ? C.accent : C.red, letterSpacing: -1 }}>${fmt(sports, 0)}</div>
              <div style={{ fontSize: 11, color: sportsProfit >= 0 ? C.accent : C.red, marginTop: 2, opacity: 0.8 }}>
                {sgn(sportsProfit)}{fmt(sportsProfit, 0)} ({sgn(sportsProfit)}{fmt((sportsProfit / baseCapital.sports) * 100, 1)}%)
              </div>
              <Sparkline data={sportsCurve} color={sportsProfit >= 0 ? C.accent : C.red} />
            </div>
          </div>

          {/* Stats row */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "12px 14px", marginBottom: 10, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4 }}>
            {[
              { v: pokerSessions.length, l: "Sesiones" },
              { v: pokerWins, l: "Ganadas" },
              { v: pokerSessions.length ? `${((pokerWins / pokerSessions.length) * 100).toFixed(0)}%` : "—", l: "Win rate" },
              { v: streak > 0 ? `${streak}🔥` : "—", l: "Racha" },
            ].map((s) => (
              <div key={s.l} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 19, fontWeight: "bold", color: C.text }}>{s.v}</div>
                <div style={{ fontSize: 8, color: C.muted, marginTop: 2, letterSpacing: 1, textTransform: "uppercase" }}>{s.l}</div>
              </div>
            ))}
          </div>

          {/* Timer Card */}
          <div style={{ background: C.card, border: `1px solid ${timerActive ? C.accentMid : C.border}`, borderRadius: 14, padding: "12px 14px", marginBottom: 10, display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 8, letterSpacing: 3, color: C.muted, textTransform: "uppercase", marginBottom: 4 }}>Sesión activa</div>
              <div style={{ fontSize: 26, fontWeight: "bold", color: timerActive ? C.accent : C.muted, fontFamily: "monospace", letterSpacing: 2 }}>
                {fmtElapsed(timerElapsed)}
              </div>
              {timerElapsed > 0 && !timerActive && (
                <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>Pausado</div>
              )}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={toggleTimer} style={{ padding: "10px 18px", borderRadius: 10, border: `1px solid ${timerActive ? C.accent : C.border}`, background: timerActive ? C.accentDim : C.surface, color: timerActive ? C.accent : C.muted, fontSize: 12, cursor: "pointer", fontFamily: "Georgia", fontWeight: "bold" }}>
                {timerActive ? "⏸ Pausa" : timerElapsed > 0 ? "▶ Reanudar" : "▶ Iniciar"}
              </button>
              {timerElapsed > 0 && (
                <button onClick={resetTimer} style={{ padding: "10px 12px", borderRadius: 10, border: `1px solid ${C.border}`, background: "transparent", color: C.muted, fontSize: 12, cursor: "pointer" }}>
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Tilt + Hábitos */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "12px 14px", marginBottom: 10 }}>
            {/* Habits */}
            <div style={{ fontSize: 8, letterSpacing: 3, color: C.muted, textTransform: "uppercase", marginBottom: 10 }}>Hábitos de hoy</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
              {[{ k: "meditar", l: "🧘 Meditar" }, { k: "agua", l: "💧 Agua" }, { k: "omega", l: "🐟 Omega-3" }, { k: "ejercicio", l: "🏃 Ejercicio" }].map((h) => (
                <button key={h.k} onClick={() => toggleHabit(h.k)} style={pill(habits[h.k], C.accent)}>
                  {habits[h.k] ? "✓ " : ""}{h.l}
                </button>
              ))}
            </div>

            {/* Tilt */}
            <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontSize: 8, letterSpacing: 3, color: C.muted, textTransform: "uppercase" }}>Estado mental</div>
                <div style={{ fontSize: 12, color: tiltColor, fontWeight: "bold", letterSpacing: 1 }}>
                  {tiltScore >= 4 ? "✓" : tiltScore >= 2 ? "⚠" : "✗"} {tiltLabel}
                </div>
              </div>
              {/* Tilt progress bar */}
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

          {/* Poker Ladder */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "12px 14px", marginBottom: 10 }}>
            <div style={{ fontSize: 8, letterSpacing: 3, color: C.muted, textTransform: "uppercase", marginBottom: 12 }}>Escalera NL</div>
            {POKER_LADDER.map((r) => {
              const prev = POKER_LADDER[POKER_LADDER.indexOf(r) - 1]?.at || baseCapital.poker;
              const pct = Math.min(((poker - prev) / (r.at - prev)) * 100, 100);
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

        {/* ════════════════════════════════════════════════════════════════
            REGISTRAR
        ════════════════════════════════════════════════════════════════ */}
        {tab === "reg" && (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 16 }}>
            <div style={{ fontSize: 8, letterSpacing: 3, color: C.muted, textTransform: "uppercase", marginBottom: 16 }}>Nueva sesión</div>

            {/* Type */}
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              {[["cash", "Cash NL2"], ["tournament", "Torneo"], ["sports", "Depor"]].map(([v, l]) => (
                <button key={v} onClick={() => setForm({ ...form, type: v })} style={typeBtn(v)}>{l}</button>
              ))}
            </div>

            {/* Result */}
            <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
              <button onClick={() => setForm({ ...form, result: "win" })} style={resBtn("win")}>▲ Ganancia</button>
              <button onClick={() => setForm({ ...form, result: "loss" })} style={resBtn("loss")}>▼ Pérdida</button>
            </div>

            {/* Quick amounts */}
            <div style={{ fontSize: 9, letterSpacing: 2, color: C.muted, textTransform: "uppercase", marginBottom: 6 }}>Acceso rápido</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 12 }}>
              {(form.type === "sports" ? QUICK_SPORTS : QUICK_POKER).map((q) => (
                <button key={q} onClick={() => setForm({ ...form, amount: String(q) })}
                  style={{ padding: "6px 11px", borderRadius: 8, border: `1px solid ${String(form.amount) === String(q) ? C.accent : C.border}`, background: String(form.amount) === String(q) ? C.accentDim : C.surface, color: String(form.amount) === String(q) ? C.accent : C.muted, fontSize: 12, cursor: "pointer", fontFamily: "Georgia" }}>
                  {form.type === "sports" ? `$${q}` : `${q}$`}
                </button>
              ))}
            </div>

            {/* Manual input */}
            <input type="number" min="0" step="0.01"
              placeholder={form.type === "sports" ? "Monto en MXN" : "Monto en USD"}
              value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}
              style={{ ...inputStyle, marginBottom: 10 }}
            />
            <input type="text" placeholder="Nota — ej: 'AA vs KK, board seco'"
              value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
              style={{ ...inputStyle, fontSize: 13, marginBottom: 14 }}
            />

            <button onClick={addSession}
              style={{ width: "100%", padding: 15, borderRadius: 10, border: "none", cursor: "pointer", background: form.result === "win" ? C.greenD : C.redD, color: form.result === "win" ? C.green : C.red, fontSize: 14, fontFamily: "Georgia, serif", fontWeight: "bold", letterSpacing: 2 }}>
              REGISTRAR
            </button>
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════
            ANALYTICS
        ════════════════════════════════════════════════════════════════ */}
        {tab === "analytics" && (
          <div>
            {/* P&L Chart */}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 16, marginBottom: 10 }}>
              <div style={{ fontSize: 8, letterSpacing: 3, color: C.muted, textTransform: "uppercase", marginBottom: 16 }}>Últimas 7 sesiones poker</div>
              <BarChart data={last7} C={C} />
            </div>

            {/* Key metrics */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
              {[
                { label: "Profit total", value: `${sgn(pokerProfit)}$${fmt(Math.abs(pokerProfit))}`, color: pokerProfit >= 0 ? C.green : C.red },
                { label: `Este mes (${monthStr})`, value: `${sgn(thisMonthProfit)}$${fmt(Math.abs(thisMonthProfit))}`, color: thisMonthProfit >= 0 ? C.green : C.red },
                { label: "Mejor sesión", value: `+$${fmt(bestSession)}`, color: C.green },
                { label: "Peor sesión", value: `$${fmt(worstSession)}`, color: C.red },
              ].map((m) => (
                <div key={m.label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14 }}>
                  <div style={{ fontSize: 8, letterSpacing: 2, color: C.muted, textTransform: "uppercase", marginBottom: 6 }}>{m.label}</div>
                  <div style={{ fontSize: 22, fontWeight: "bold", color: m.color }}>{m.value}</div>
                </div>
              ))}
            </div>

            {/* Avg session + sessions this month */}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14, marginBottom: 10 }}>
              <div style={{ fontSize: 8, letterSpacing: 3, color: C.muted, textTransform: "uppercase", marginBottom: 12 }}>Promedios</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                {[
                  { label: "Promedio", value: `${sgn(avgSession)}$${fmt(Math.abs(avgSession))}`, c: avgSession >= 0 ? C.green : C.red },
                  { label: `Sesiones ${monthStr}`, value: thisMonthSessions.length, c: C.accent },
                  { label: "Win rate", value: pokerSessions.length ? `${((pokerWins / pokerSessions.length) * 100).toFixed(0)}%` : "—", c: C.text },
                ].map((x) => (
                  <div key={x.label} style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 20, fontWeight: "bold", color: x.c }}>{x.value}</div>
                    <div style={{ fontSize: 8, color: C.muted, marginTop: 3, letterSpacing: 1, textTransform: "uppercase" }}>{x.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Equity curve full */}
            {pokerCurve.length >= 2 && (
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14 }}>
                <div style={{ fontSize: 8, letterSpacing: 3, color: C.muted, textTransform: "uppercase", marginBottom: 8 }}>Curva de equity</div>
                <svg viewBox="0 0 300 60" style={{ width: "100%", height: 60, display: "block" }}>
                  {(() => {
                    const pts = pokerCurve;
                    const mn = Math.min(...pts) - 1, mx = Math.max(...pts) + 1;
                    const range = mx - mn || 1;
                    const W = 300, H = 58;
                    const points = pts.map((v, i) => `${(i / (pts.length - 1)) * W},${H - ((v - mn) / range) * H}`).join(" ");
                    const areaPoints = `0,${H} ` + points + ` ${W},${H}`;
                    return (
                      <>
                        <defs>
                          <linearGradient id="eqgrad" x1="0" x2="0" y1="0" y2="1">
                            <stop offset="0%" stopColor={pokerProfit >= 0 ? C.green : C.red} stopOpacity="0.2" />
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
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════
            SPOTS & LEAKS
        ════════════════════════════════════════════════════════════════ */}
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
                  <div style={{ background: C.card, border: `1px solid ${C.border}`, color: C.gold, padding: "4px 8px", borderRadius: 6, fontSize: 10, fontWeight: "bold", whiteSpace: "nowrap", height: "fit-content", marginTop: 2 }}>
                    {s.buyin || "GNRL"}
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

        {/* ════════════════════════════════════════════════════════════════
            HISTORIAL — grouped by date
        ════════════════════════════════════════════════════════════════ */}
        {tab === "hist" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 8, letterSpacing: 3, color: C.muted, textTransform: "uppercase" }}>{showArchived ? "Archivadas" : "Historial"}</div>
              <button onClick={() => setShowArchived(!showArchived)} style={{ fontSize: 10, background: "none", border: `1px solid ${C.border}`, color: C.muted, padding: "4px 10px", borderRadius: 6, cursor: "pointer" }}>
                {showArchived ? "Ver activas" : "Archivadas"}
              </button>
            </div>

            {(() => {
              const list = (showArchived ? archived : active).filter((x) => x.type !== "leak");
              if (list.length === 0) return (
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 32, textAlign: "center", color: C.muted, fontSize: 13 }}>
                  Sin sesiones registradas
                </div>
              );

              const grouped = groupByDate(list);
              return grouped.map(([date, daySessions]) => {
                const dayTotal = daySessions.reduce((a, s) => {
                  if (s.type === "sports") return a; // separate currencies
                  return a + s.amount;
                }, 0);
                const dayTotalSports = daySessions.filter((s) => s.type === "sports").reduce((a, s) => a + s.amount, 0);

                return (
                  <div key={date} style={{ marginBottom: 8 }}>
                    {/* Date header */}
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

                    {/* Sessions for that day */}
                    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
                      {daySessions.map((s, i) => (
                        <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 14px", borderBottom: i < daySessions.length - 1 ? `1px solid ${C.border}` : "none" }}>
                          <div>
                            <div style={{ fontSize: 12, color: C.text }}>
                              <span style={{ fontSize: 8, letterSpacing: 2, textTransform: "uppercase", color: s.type === "sports" ? C.accent : s.type === "tournament" ? C.gold : C.green, marginRight: 6 }}>{s.type}</span>
                              {s.note && <span style={{ color: C.textDim }}>{s.note}</span>}
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

        {/* ════════════════════════════════════════════════════════════════
            REGLAS & CONFIG
        ════════════════════════════════════════════════════════════════ */}
        {tab === "rules" && (
          <div>
            {/* Capital inicial */}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 16, marginBottom: 12 }}>
              <div style={{ fontSize: 8, letterSpacing: 3, color: C.muted, textTransform: "uppercase", marginBottom: 14 }}>⚙️ Capital inicial</div>
              <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 9, color: C.muted, marginBottom: 4, letterSpacing: 1 }}>Poker (USD)</div>
                  <input type="number" min="0" value={baseCapital.poker} onChange={(e) => setBaseCapital({ ...baseCapital, poker: Number(e.target.value) })}
                    style={{ ...inputStyle, fontSize: 14, padding: "10px" }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 9, color: C.muted, marginBottom: 4, letterSpacing: 1 }}>Depor (MXN)</div>
                  <input type="number" min="0" value={baseCapital.sports} onChange={(e) => setBaseCapital({ ...baseCapital, sports: Number(e.target.value) })}
                    style={{ ...inputStyle, fontSize: 14, padding: "10px" }} />
                </div>
              </div>

              {/* Accent color picker */}
              <div style={{ fontSize: 9, color: C.muted, marginBottom: 8, letterSpacing: 1, textTransform: "uppercase" }}>Color del tema</div>
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                {ACCENT_PRESETS.map((p) => (
                  <button key={p.v} onClick={() => setAccent(p.v)}
                    style={{ width: 28, height: 28, borderRadius: "50%", border: `2px solid ${accent === p.v ? "#fff" : "transparent"}`, background: p.v, cursor: "pointer", boxShadow: accent === p.v ? `0 0 0 1px ${p.v}` : "none", transition: "all 0.2s" }} />
                ))}
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

      {/* ── BOTTOM NAV ───────────────────────────────────────────────────── */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: C.surface, borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "center", zIndex: 10 }}>
        <div style={{ display: "flex", width: "100%", maxWidth: 480 }}>
          {[
            { k: "dash", icon: "◈", l: "Inicio" },
            { k: "reg", icon: "+", l: "Sesión" },
            { k: "analytics", icon: "↗", l: "Stats" },
            { k: "leaks", icon: "⚑", l: "Leaks" },
            { k: "hist", icon: "≡", l: "Historial" },
            { k: "rules", icon: "◉", l: "Config" },
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