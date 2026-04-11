import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "./supabase";

// ─── SONIDOS NATIVOS (Web Audio API) ────────────────────────────────────────
let audioCtx = null;
const playSound = (type) => {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    const now = audioCtx.currentTime;
    if (type === 'click') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, now);
      osc.frequency.exponentialRampToValueAtTime(300, now + 0.05);
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
      osc.start(now);
      osc.stop(now + 0.05);
    } else if (type === 'success') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(400, now);
      osc.frequency.setValueAtTime(600, now + 0.1);
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.2);
      osc.start(now);
      osc.stop(now + 0.2);
    } else if (type === 'error') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(150, now);
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.start(now);
      osc.stop(now + 0.2);
    }
  } catch(e) {} // Ignorar si el navegador bloquea el audio
};

// ─── CONSTANTS ──────────────────────────────────────────────────────────────

const RULES = {
  cash: [
    "Stop-loss por sesión: máximo 3 buyins ($6 USD)",
    "Si el bankroll baja a $30, paras la semana",
    "Máximo 2 horas por sesión en un solo bloque",
    "Stop-loss emocional: si sientes tilt, cierra inmediatamente",
  ],
  tournament: [
    "Máximo 5% del bankroll por torneo ($2.50 con $50)",
    "Máximo 3 torneos al día",
    "Si pierdes 5 seguidos, pausa 24h",
  ],
  sports: [
    "Máximo 5% del bankroll por apuesta",
    "Solo mercados donde tengas criterio real",
    "No apostar para recuperar pérdidas del día",
  ],
  casino: [
    "PROHIBIDO ABSOLUTO. Sin excepciones.",
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
  { id: "notChasing", label: "Sin urgencia", icon: "🎯" },
  { id: "ate", label: "Comí bien", icon: "🍽" },
];

const POSITIONS = ["UTG", "MP", "HJ", "CO", "BTN", "SB", "BB", "General"];

// Tablas GTO expandidas
const GTO_TABLES = {
  "100bb_cash": [
    { pos: "UTG", range: "77+, ATs+, KJs+, QJs, JTs, AQo+", notes: "10% RFI. Muy tight. Foldear AQo a 3bets." },
    { pos: "MP", range: "55+, A8s+, KTs+, QTs+, JTs, T9s, AJo+, KQo", notes: "15% RFI. Empezar a abrir conectores suited fuertes." },
    { pos: "CO", range: "22+, A2s+, K8s+, Q9s+, J9s+, T9s, 98s, 87s, ATo+, KJo+", notes: "25% RFI. Rango de robo medio. Atacar ciegas tight." },
    { pos: "BTN", range: "22+, A2s+, K2s+, Q5s+, J7s+, T7s+, 97s+, 87s, 76s, A2o+, K8o+, Q9o+, J9o+", notes: "45% RFI. Máxima agresión, ventaja de posición absoluta." },
    { pos: "SB", range: "22+, A2s+, K2s+, Q7s+, J8s+, T8s+, 98s, A2o+, KTo+, QTo+, JTo", notes: "40% RFI. Abrir o 3bet, evitar pagar pasivo fuera de posición." },
  ],
  "40bb_mtt": [
    { pos: "UTG", range: "66+, ATs+, KJs+, QJs, JTs, AQo+", notes: "12% RFI. Cuidado con set mining (poca implícita)." },
    { pos: "MP", range: "44+, A7s+, KTs+, QTs+, JTs, T9s, ATo+, KQo", notes: "17% RFI. Priorizar cartas altas sobre conectores suited." },
    { pos: "CO", range: "22+, A2s+, K7s+, Q9s+, J9s+, T9s, ATo+, KTo+", notes: "27% RFI. Cuidado con los resteals (3bet push)." },
    { pos: "BTN", range: "22+, A2s+, K2s+, Q2s+, J7s+, T7s+, 97s+, A2o+, K8o+, Q9o+", notes: "48% RFI. Abrir pequeño (2x-2.2x) para atacar ciegas." },
  ],
  "20bb_mtt": [
    { pos: "UTG", range: "22+, A9s+, KTs+, QJs, AJo+", notes: "Zona de Push/Fold o Min-Raise muy polarizado." },
    { pos: "MP", range: "22+, A7s+, K9s+, QTs+, JTs, ATo+, KQo", notes: "Push directo con pares bajos y Ases medios suited." },
    { pos: "CO", range: "22+, A2s+, K7s+, Q9s+, J9s+, T9s, A8o+, KTo+, QJo", notes: "Mucha presión a ciegas débiles. Push agresivo." },
    { pos: "BTN", range: "22+, A2s+, K2s+, Q2s+, J7s+, T7s+, 97s+, A2o+, K8o+, Q9o+", notes: "Rango de Resteal / Push amplísimo vs aperturas previas." },
  ]
};

const ACCENT_PRESETS = [
  { name: "Azul", v: "#3b82f6" },
  { name: "Esmeralda", v: "#10b981" },
  { name: "Oro", v: "#f59e0b" },
  { name: "Violeta", v: "#8b5cf6" },
  { name: "Rosa", v: "#ec4899" },
  { name: "Cyan", v: "#06b6d4" },
];

const QUICK_POKER  = [0.5, 1, 2, 5, 10, 20];
const QUICK_SPORTS = [25, 50, 100, 200, 500];

// ─── HELPERS ────────────────────────────────────────────────────────────────

const fmt = (n, d = 2) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const sgn = (n) => (n >= 0 ? "+" : "");
const isValid = (hex) => /^#[0-9A-Fa-f]{6}$/.test(hex);

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

const getTodayStr = () => new Date().toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
const getMonthStr = () => new Date().toLocaleDateString("es-MX", { month: "short" });

// ─── COLOR SYSTEM ────────────────────────────────────────────────────────────

const makeC = (accent = "#3b82f6") => ({
  bg: "#0d1117", surface: "#161b22", card: "#1e242e", border: "#30363d",
  green: "#10b981", greenD: "#065f46", red: "#ef4444", redD: "#7f1d1d",
  accent, accentDim: accent + "25", accentMid: accent + "50",
  gold: "#f59e0b", goldD: "#78350f", muted: "#8b949e", text: "#f0f6fc", textDim: "#c9d1d9",
});

const fontClassic = "'Georgia', serif";
const fontClean   = "system-ui, -apple-system, sans-serif";

const INPUT_STYLE_BASE = {
  width: "100%", padding: "14px 16px", borderRadius: 10,
  fontSize: 15, fontFamily: fontClean, boxSizing: "border-box", outline: "none",
};

// ═══════════════════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

const StarRating = ({ value, onChange, C }) => (
  <div style={{ display: "flex", gap: 6 }}>
    {[1, 2, 3, 4, 5].map((n) => (
      <button key={n} type="button" onClick={(e) => { e.preventDefault(); playSound('click'); onChange(n === value ? 0 : n); }}
        style={{ background: "none", border: "none", cursor: "pointer", fontSize: 26, color: n <= value ? C.gold : C.border, padding: "0", lineHeight: 1 }}>
        ★
      </button>
    ))}
  </div>
);

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
    if (p === undefined) return C.surface; 
    const intensity = Math.min(Math.abs(p) / maxAbs, 1);
    const alpha = Math.round(intensity * 155 + 100).toString(16).padStart(2, "0");
    return p >= 0 ? `${C.green}${alpha}` : `${C.red}${alpha}`;
  };

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {["D","L","M","M","J","V","S"].map((d, i) => (
          <div key={i} style={{ fontSize: 11, color: C.muted, textAlign: "center", paddingBottom: 6, fontWeight: "500" }}>{d}</div>
        ))}
        {cells.map((day, i) => (
          <div key={i} style={{
            aspectRatio: "1", borderRadius: 6, background: day ? getColor(day) : "transparent", border: day === today ? `2px solid ${C.accent}` : "none",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: day ? (profitByDay[day] !== undefined ? "#fff" : C.textDim) : "transparent",
            fontWeight: day === today ? "bold" : "normal", fontFamily: fontClean
          }}>{day || ""}</div>
        ))}
      </div>
    </div>
  );
};

const Sparkline = ({ data, color, id, W = 120, H = 36 }) => {
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
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" points={pts} />
    </svg>
  );
};

const BarChart = ({ data, C }) => {
  if (!data || data.length === 0) return <div style={{ textAlign: "center", color: C.muted, padding: 24, fontSize: 13 }}>Sin datos suficientes</div>;
  const values = data.map((d) => d.value);
  const maxAbs = Math.max(...values.map(Math.abs), 0.1);
  const barH = 80;
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: barH + 40, padding: "0 4px" }}>
      {data.map((d, i) => {
        const pct = Math.abs(d.value) / maxAbs; const isPos = d.value >= 0; const h = Math.max(pct * barH, 4);
        return (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: barH + 40 }}>
            <div style={{ fontSize: 11, color: isPos ? C.green : C.red, marginBottom: 5, fontWeight: "600", fontFamily: fontClean }}>
              {d.value !== 0 ? `${sgn(d.value)}${fmt(Math.abs(d.value), 0)}` : "—"}
            </div>
            <div style={{ width: "100%", height: h, maxWidth: 24, background: isPos ? C.green : C.red, opacity: 0.85, borderRadius: isPos ? "6px 6px 0 0" : "0 0 6px 6px" }} />
            <div style={{ fontSize: 10, color: C.muted, marginTop: 8, textAlign: "center", fontFamily: fontClean }}>{d.label}</div>
          </div>
        );
      })}
    </div>
  );
};

// ─── MATRIZ GTO 13x13 ────────────────────────────────────────────────────────
const RANKS = ['A','K','Q','J','T','9','8','7','6','5','4','3','2'];
const getRankVal = r => RANKS.length - RANKS.indexOf(r);

const parseGTOString = (str) => {
  const hands = new Set();
  if(!str || str.includes("Mix")) return hands;
  str.split(',').forEach(p => {
    const part = p.trim();
    if (part.endsWith('+')) {
      const base = part.slice(0, -1);
      if (base.length === 2 && base[0] === base[1]) {
        let val = getRankVal(base[0]);
        for(let i=val; i<=13; i++) hands.add(RANKS[13-i]+RANKS[13-i]);
      } else if (base.length === 3) {
        let r1 = getRankVal(base[0]);
        let r2 = getRankVal(base[1]);
        let suffix = base[2];
        for(let i=r2; i<r1; i++) hands.add(base[0]+RANKS[13-i]+suffix);
      }
    } else { hands.add(part); }
  });
  return hands;
};

const GTOMatrix = ({ rangeStr, C }) => {
  const activeHands = useMemo(() => parseGTOString(rangeStr), [rangeStr]);
  
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(13, 1fr)', gap: 2, background: C.border, padding: 2, borderRadius: 8, marginTop: 12 }}>
      {RANKS.map((r1, row) => 
        RANKS.map((r2, col) => {
          let hand;
          let isPair = row === col;
          let isSuited = row < col; 
          
          if (isPair) hand = r1+r2;
          else if (isSuited) hand = r1+r2+'s';
          else hand = r2+r1+'o'; 
          
          const isActive = activeHands.has(hand) || rangeStr.includes("Mix");
          
          let bg = C.surface;
          let color = C.textDim;
          let border = "none";
          
          if (isActive) {
            color = "#fff";
            if (isPair) { bg = C.greenD; border = `1px solid ${C.green}`; }
            else if (isSuited) { bg = "#0284c7"; border = "1px solid #38bdf8"; } // Azul para Suited
            else { bg = C.goldD; border = `1px solid ${C.gold}`; } // Dorado para Offsuit
          }

          return (
            <div key={hand} style={{ 
              aspectRatio: "1", display: "flex", alignItems: "center", justifyContent: "center", 
              fontSize: "clamp(8px, 2.5vw, 11px)", fontWeight: isActive ? "bold" : "normal",
              background: bg, color: color, borderRadius: 3, border: border, fontFamily: fontClean
            }}>
              {hand}
            </div>
          );
        })
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════════════════

export default function App() {

  const [session,      setSession]      = useState(null);
  const [authEmail,    setAuthEmail]    = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [isLogin,      setIsLogin]      = useState(true);
  const [authLoading,  setAuthLoading]  = useState(false);

  const [tab,          setTab]          = useState("dash");
  const [sessions,     setSessions]     = useState([]);
  const [baseCapital,  setBaseCapital]  = useState({ poker: 50, sports: 500 });
  const [poker,        setPoker]        = useState(50);
  const [sports,       setSports]       = useState(500);
  const [habits,       setHabits]       = useState({ meditar: false, agua: false, omega: false, ejercicio: false });
  const [tilt,         setTilt]         = useState({});
  const [form,         setForm]         = useState({ type: "cash", result: "win", amount: "", note: "", rating: 0, durationMins: "" });
  const [leakForm,     setLeakForm]     = useState({ position: "BTN", note: "" });
  const [rulesOpen,    setRulesOpen]    = useState(null);
  const [loaded,       setLoaded]       = useState(false);
  const [flash,        setFlash]        = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [pushStatus,   setPushStatus]   = useState("Checking...");

  const [timerActive,  setTimerActive]  = useState(false);
  const [timerStart,   setTimerStart]   = useState(null);
  const [timerElapsed, setTimerElapsed] = useState(0);
  const [journal,      setJournal]      = useState("");
  const [journalSaved, setJournalSaved] = useState(false);
  const [accent,       setAccent]       = useState("#3b82f6");
  const [recentColors, setRecentColors] = useState([]);
  const [customHex,    setCustomHex]    = useState("");
  const [monthlyGoal,     setMonthlyGoal]     = useState(20);
  const [showWeeklyModal, setShowWeeklyModal] = useState(false);
  const [showPreSession,  setShowPreSession]  = useState(false);
  const [preSessionNote,  setPreSessionNote]  = useState("");
  const [analyticsView,   setAnalyticsView]   = useState("general"); 
  const [leaksView,       setLeaksView]       = useState("registry"); 
  
  const [gtoDepth, setGtoDepth] = useState("100bb_cash");
  const [gtoPosIdx, setGtoPosIdx] = useState(0);

  const timerElapsedRef   = useRef(0);
  const preSessionNoteRef = useRef("");
  useEffect(() => { timerElapsedRef.current = timerElapsed; },   [timerElapsed]);
  useEffect(() => { preSessionNoteRef.current = preSessionNote; }, [preSessionNote]);

  const C = useMemo(() => makeC(accent), [accent]);
  const active   = useMemo(() => sessions.filter((x) => !x.archived),  [sessions]);
  const archived = useMemo(() => sessions.filter((x) =>  x.archived),  [sessions]);

  // ── Timer Logic
  useEffect(() => {
    if (!timerActive) return;
    const id = setInterval(() => setTimerElapsed(Date.now() - timerStart), 1000);
    return () => clearInterval(id);
  }, [timerActive, timerStart]);

  const toggleTimer = useCallback((e) => {
    if(e) e.preventDefault();
    playSound('click');
    if (timerActive) setTimerActive(false);
    else if (timerElapsed > 0) { setTimerStart(Date.now() - timerElapsed); setTimerActive(true); }
    else setShowPreSession(true);
  }, [timerActive, timerElapsed]);

  const startTimerActual = useCallback((note) => {
    playSound('click');
    setPreSessionNote(note); setTimerStart(Date.now()); setTimerActive(true); setShowPreSession(false);
  }, []);

  const resetTimer = useCallback((e) => {
    if(e) e.preventDefault();
    playSound('click');
    setTimerActive(false); setTimerElapsed(0); setTimerStart(null); setPreSessionNote("");
  }, []);

  const stopAndRegister = useCallback((e) => {
    if(e) e.preventDefault();
    playSound('success');
    if(timerActive) setTimerActive(false); 
    setTab("reg"); 
    
    const elapsedMins = Math.floor(timerElapsedRef.current / 60000);
    setForm(prev => ({ 
      ...prev, 
      type: "cash", 
      amount: "", 
      note: preSessionNoteRef.current ? `Foco: ${preSessionNoteRef.current}` : "",
      durationMins: elapsedMins > 0 ? String(elapsedMins) : ""
    }));
  }, [timerActive]);

  // ── Auth & Load Logic
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  const handleAuth = useCallback(async (e) => {
    e.preventDefault(); setAuthLoading(true);
    try {
      if (isLogin) { const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword }); if (error) throw error; }
      else { const { error } = await supabase.auth.signUp({ email: authEmail, password: authPassword }); if (error) throw error; alert("Cuenta creada."); }
    } catch (err) { alert(err.message); } finally { setAuthLoading(false); }
  }, [isLogin, authEmail, authPassword]);

  const handleLogout = useCallback(async (e) => { if(e) e.preventDefault(); await supabase.auth.signOut(); setSessions([]); setLoaded(false); }, []);

  const sendAlert = useCallback(async (title, body, type="error") => {
    playSound(type);
    if ("serviceWorker" in navigator && Notification.permission === "granted") {
      try { const reg = await navigator.serviceWorker.ready; reg.showNotification(title, { body, icon: "/icon.png", vibrate: [200, 100, 200] }); } catch (e) {}
    }
  }, []);

  const requestNotificationPermission = useCallback(async (e) => {
    if(e) e.preventDefault();
    playSound('click');
    if (!("Notification" in window)) { alert("Tu navegador no soporta notificaciones."); return; }
    const perm = await Notification.requestPermission();
    if (perm === "granted") { setPushStatus("Activas"); sendAlert("♠️ Diego's Edge", "Alertas activadas.", "success"); } else setPushStatus("Denegado");
  }, [sendAlert]);

  const activeRef = useRef(active);
  useEffect(() => { activeRef.current = active; }, [active]);

  useEffect(() => {
    if (!loaded || !session) return;
    const checkTimeAlerts = () => {
      const now = new Date(); const h = now.getHours(), m = now.getMinutes();
      const today = now.toLocaleDateString("es-MX"); const todayString = getTodayStr();
      let noted = {}; try { noted = JSON.parse(localStorage.getItem(`bk_alerts_${today}`)) || {}; } catch {}
      
      if (h === 10 && m === 0 && !noted.morning) { sendAlert("🌅 Buenos días", "Omega-3 y agua antes de la primera sesión.", "click"); noted.morning = true; }
      if (h === 14 && m === 0 && !noted.afternoon) { sendAlert("🧠 Check-in", "¿Cómo va el tilt?", "click"); noted.afternoon = true; }
      if (h === 20 && m === 0 && !noted.evening) { sendAlert("📖 Hora de estudio", "Revisa Spots y Leaks.", "click"); noted.evening = true; }
      if (h === 22 && m === 0 && !noted.night) {
        const todaySess = activeRef.current.filter((s) => s.date === todayString && s.type !== "leak");
        if (todaySess.length > 0) {
          const pt = todaySess.filter((s) => s.type !== "sports").reduce((a, s) => a + s.amount, 0);
          const st = todaySess.filter((s) => s.type === "sports").reduce((a, s) => a + s.amount, 0);
          sendAlert("📊 Resumen del Día", `Poker: ${sgn(pt)}${fmt(pt)} USD | Depor: ${sgn(st)}${fmt(st, 2)} MXN`, "success");
        }
        noted.night = true;
      }
      localStorage.setItem(`bk_alerts_${today}`, JSON.stringify(noted));
    };
    const id = setInterval(checkTimeAlerts, 60000); checkTimeAlerts(); return () => clearInterval(id);
  }, [loaded, session, sendAlert]);

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

      const today = new Date().toLocaleDateString("es-MX");
      const lastDate = localStorage.getItem("bk_last_date");
      if (lastDate && lastDate !== today) await supabase.from("daily_habits").delete().eq("user_id", session.user.id).neq("id", "dummy");
      localStorage.setItem("bk_last_date", today);

      const openedToday = localStorage.getItem("bk_opened_today");
      if (openedToday !== today) { setTimeout(() => sendAlert("🌅 Diego's Edge", "Nuevo día. Registra tus check-ins.", "click"), 3000); localStorage.setItem("bk_opened_today", today); }

      const { data: sData } = await supabase.from("sessions").select("*").eq("user_id", session.user.id).order("id", { ascending: false });
      const { data: hData } = await supabase.from("daily_habits").select("*").eq("user_id", session.user.id);

      if (sData) {
        setSessions(sData);
        const activeData = sData.filter((x) => !x.archived);
        const pSess = activeData.filter((x) => x.type !== "sports" && x.type !== "leak");
        const sSess = activeData.filter((x) => x.type === "sports");
        setPoker(pSess.reduce((a, x) => a + x.amount, currentBase.poker));
        setSports(sSess.reduce((a, x) => a + x.amount, currentBase.sports));
      } else { setPoker(currentBase.poker); setSports(currentBase.sports); }

      if (hData) {
        const lH = { meditar: false, agua: false, omega: false, ejercicio: false }; const lT = {}; let lJ = "";
        hData.forEach((item) => {
          if (item.id === "journal") lJ = item.note || "";
          else if (item.id.startsWith("tilt_")) lT[item.id.replace("tilt_", "")] = item.status;
          else lH[item.id] = item.status;
        });
        setHabits(lH); setTilt(lT); setJournal(lJ);
      }
    } catch (err) { console.error(err); }
    setLoaded(true);
  }, [session, sendAlert]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!loaded || !session) return;
    const now = new Date(); if (now.getDay() !== 1) return;
    const key = `bk_weekly_${now.toISOString().slice(0, 10)}`;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "1"); setShowWeeklyModal(true);
  }, [loaded, session]);

  const saveConfig = useCallback(async (e) => {
    if(e) e.preventDefault();
    await supabase.auth.updateUser({ data: { base_capital: baseCapital, accent, monthly_goal: monthlyGoal } });
    load(); sendAlert("⚙️ Config guardada", "Capital y tema actualizados.", "success");
  }, [baseCapital, accent, monthlyGoal, load, sendAlert]);

  const handleSetAccent = useCallback((color) => {
    playSound('click');
    setAccent(color);
    setRecentColors((prev) => {
      const filtered = prev.filter((c) => c !== color);
      const next     = [color, ...filtered].slice(0, 3);
      localStorage.setItem("bk_recent_colors", JSON.stringify(next)); return next;
    });
  }, []);

  const addSession = useCallback(async (e) => {
    if(e) e.preventDefault();
    const amt = parseFloat(form.amount); 
    if (!amt || amt <= 0) { playSound('error'); return; }
    
    const value = form.result === "win" ? amt : -amt;
    const finalDurationMs = form.durationMins ? parseInt(form.durationMins, 10) * 60000 : 0;

    const payload = {
      id: Date.now(), 
      user_id: session.user.id, type: form.type, amount: value, note: form.note,
      date: getTodayStr(), archived: false, rating: form.rating || 0,
      duration: finalDurationMs, pre_note: preSessionNoteRef.current || "",
    };
    
    const { data, error } = await supabase.from("sessions").insert([payload]).select();
    if (error) { playSound('error'); alert(`Error: ${error.message}`); return; }

    if (data && data.length > 0) {
      playSound('success');
      setSessions((prev) => [data[0], ...prev]);
      if (form.type === "sports") setSports((p) => parseFloat((p + value).toFixed(2)));
      else                        setPoker((p)  => parseFloat((p + value).toFixed(2)));
      
      setForm((f) => ({ ...f, amount: "", note: "", rating: 0, durationMins: "" }));
      setFlash(value > 0 ? "win" : "loss"); setTimeout(() => setFlash(null), 900); setTab("dash");
      resetTimer(); 

      if (form.type === "cash" && value <= -6) sendAlert("⚠️ STOP LOSS", "3 buy-ins perdidos. Cierra la mesa.", "error");
      if (form.type === "cash" && value >= 10)  sendAlert("🏆 Buena sesión", "Protege las ganancias.", "success");
    }
  }, [form, session, sendAlert, resetTimer]);

  const addLeak = useCallback(async (e) => {
    if(e) e.preventDefault();
    if (!leakForm.note.trim()) { playSound('error'); return; }
    const payload = { id: Date.now(), user_id: session.user.id, type: "leak", amount: 0, note: leakForm.note, buyin: leakForm.position, date: getTodayStr(), archived: false }; 
    const { data, error } = await supabase.from("sessions").insert([payload]).select();
    if (error) { playSound('error'); alert(`Error: ${error.message}`); return; }
    if (data && data.length > 0) {
      playSound('success');
      setSessions((prev) => [data[0], ...prev]);
      setLeakForm((f) => ({ ...f, note: "" })); setFlash("win"); setTimeout(() => setFlash(null), 900);
    }
  }, [leakForm, session]);

  const toggleHabit = useCallback(async (e, k) => {
    e.preventDefault(); e.stopPropagation(); playSound('click');
    const nextStatus = !habits[k];
    setHabits((prev) => ({ ...prev, [k]: nextStatus }));
    supabase.from("daily_habits").upsert({ id: k, user_id: session.user.id, status: nextStatus }).catch(console.error);
  }, [habits, session]);

  const toggleTilt = useCallback(async (e, k) => {
    e.preventDefault(); e.stopPropagation(); playSound('click');
    const nextStatus = !tilt[k];
    setTilt((prev) => ({ ...prev, [k]: nextStatus }));
    supabase.from("daily_habits").upsert({ id: `tilt_${k}`, user_id: session.user.id, status: nextStatus }).catch(console.error);
  }, [tilt, session]);

  const saveJournal = useCallback(async (e) => {
    if(e) e.preventDefault();
    playSound('success');
    await supabase.from("daily_habits").upsert({ id: "journal", user_id: session.user.id, status: false, note: journal });
    setJournalSaved(true); setTimeout(() => setJournalSaved(false), 2000);
  }, [session, journal]);

  const archiveAll = useCallback(async (e) => {
    if(e) e.preventDefault(); playSound('error');
    if (!window.confirm("¿Archivar las sesiones y resetear los datos a cero? Las sesiones seguirán disponibles en el historial oculto.")) return;
    const activeIds = sessions.filter((s) => !s.archived).map((s) => s.id);
    if (activeIds.length > 0) await supabase.from("sessions").update({ archived: true }).in("id", activeIds);
    await supabase.from("daily_habits").delete().eq("user_id", session.user.id).neq("id", "dummy");
    setSessions((prev) => prev.map((s) => ({ ...s, archived: true })));
    setPoker(baseCapital.poker); setSports(baseCapital.sports); setHabits({ meditar: false, agua: false, omega: false, ejercicio: false }); setTilt({}); setJournal(""); setTab("dash");
  }, [sessions, session, baseCapital]);

  const deleteAllData = useCallback(async (e) => {
    if(e) e.preventDefault(); playSound('error');
    if (!window.confirm("⚠️ ¡PELIGRO! ¿Estás completamente seguro de ELIMINAR TODOS TUS DATOS de forma permanente? Esto no se puede deshacer.")) return;
    await supabase.from("sessions").delete().eq("user_id", session.user.id);
    await supabase.from("daily_habits").delete().eq("user_id", session.user.id);
    setSessions([]); setPoker(baseCapital.poker); setSports(baseCapital.sports); setHabits({ meditar: false, agua: false, omega: false, ejercicio: false }); setTilt({}); setJournal(""); setTab("dash");
    alert("Todos los datos han sido borrados de la base de datos de Supabase.");
  }, [session, baseCapital]);

  const exportCSV = useCallback((e) => {
    if(e) e.preventDefault(); playSound('success');
    const header = "Fecha,Tipo,Monto,Nota,Rating,Duración(min),Foco previo\n";
    const rows = active.filter((x) => x.type !== "leak").map((s) => [s.date, s.type, s.amount, `"${(s.note || "").replace(/"/g, "'")}"`, s.rating || 0, s.duration ? Math.round(s.duration / 60000) : 0, `"${(s.pre_note || "").replace(/"/g, "'")}"`].join(",")).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `diegos-edge-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
  }, [active]);

  // ═══════════════════════════════════════════════════════════════════════════
  // DERIVED STATE
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

  const streak = useMemo(() => { let s = 0; for (const x of pokerSessions) { if (x.amount > 0) s++; else break; } return s; }, [pokerSessions]);
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

  // Poker Analytics
  const last7 = useMemo(() => [...pokerSessions].slice(0, 7).reverse().map((s) => ({ value: s.amount, label: s.date.replace(/\s/g, "\n") })), [pokerSessions]);
  const pokerAmounts  = useMemo(() => pokerSessions.map((s) => s.amount), [pokerSessions]);
  const bestSession   = useMemo(() => pokerAmounts.length ? Math.max(...pokerAmounts) : 0, [pokerAmounts]);
  const worstSession  = useMemo(() => pokerAmounts.length ? Math.min(...pokerAmounts) : 0, [pokerAmounts]);
  const avgSession    = useMemo(() => pokerAmounts.length ? pokerAmounts.reduce((a, b) => a + b, 0) / pokerAmounts.length : 0, [pokerAmounts]);

  // Sports Analytics (Con centavos .00)
  const sportsAmounts = useMemo(() => sportsSessions.map((s) => s.amount), [sportsSessions]);
  const sportsWins    = useMemo(() => sportsSessions.filter((x) => x.amount > 0).length, [sportsSessions]);
  const sportsWinRate = sportsSessions.length ? Math.round((sportsWins / sportsSessions.length) * 100) : 0;
  const sportsBest    = sportsAmounts.length ? Math.max(...sportsAmounts) : 0;
  const sportsWorst   = sportsAmounts.length ? Math.min(...sportsAmounts) : 0;
  const sportsAvg     = sportsAmounts.length ? sportsAmounts.reduce((a, b) => a + b, 0) / sportsAmounts.length : 0;
  const last7Sports   = useMemo(() => [...sportsSessions].slice(0, 7).reverse().map((s) => ({ value: s.amount, label: s.date.replace(/\s/g, "\n") })), [sportsSessions]);

  const monthStr = getMonthStr();
  const thisMonthSessions = useMemo(() => pokerSessions.filter((s) => s.date.includes(monthStr)), [pokerSessions, monthStr]);
  const thisMonthProfit   = useMemo(() => thisMonthSessions.reduce((a, s) => a + s.amount, 0), [thisMonthSessions]);

  const groupedActive   = useMemo(() => groupByDate(active.filter((x)   => x.type !== "leak")), [active]);
  const groupedArchived = useMemo(() => groupByDate(archived.filter((x) => x.type !== "leak")), [archived]);

  const monthlyProgress = useMemo(() => { if (!monthlyGoal) return 0; return Math.max(Math.min((thisMonthProfit / monthlyGoal) * 100, 100), 0); }, [thisMonthProfit, monthlyGoal]);
  const avgLast10 = useMemo(() => { const last10 = pokerAmounts.slice(0, 10); if (!last10.length) return 0; return last10.reduce((a, b) => a + b, 0) / last10.length; }, [pokerAmounts]);

  const nextLevel = useMemo(() => {
    const next = POKER_LADDER.find((r) => poker < r.at); if (!next) return null;
    if (avgLast10 <= 0) return { label: next.label, sessions: null, target: next.at };
    return { label: next.label, sessions: Math.ceil((next.at - poker) / avgLast10), target: next.at };
  }, [poker, avgLast10]);

  const leakAlerts = useMemo(() => {
    const counts = {}; leakSessions.forEach((s) => { const key = s.buyin || "GNRL"; counts[key] = (counts[key] || 0) + 1; });
    return Object.entries(counts).filter(([, n]) => n >= 3).map(([pos, n]) => ({ pos, n }));
  }, [leakSessions]);

  const monthlyBreakdown = useMemo(() => {
    const months = {};
    [...pokerSessions].reverse().forEach((s) => {
      const parts = s.date.split(" "); const m = parts[1] || "?";
      if (!months[m]) months[m] = { sessions: 0, profit: 0, wins: 0 };
      months[m].sessions++; months[m].profit += s.amount; if (s.amount > 0) months[m].wins++;
    });
    return Object.entries(months).map(([month, d]) => ({ month, sessions: d.sessions, profit: parseFloat(d.profit.toFixed(2)), winRate: d.sessions ? Math.round((d.wins / d.sessions) * 100) : 0 })).reverse();
  }, [pokerSessions]);

  const sportsMonthlyBreakdown = useMemo(() => {
    const months = {};
    [...sportsSessions].reverse().forEach((s) => {
      const parts = s.date.split(" "); const m = parts[1] || "?";
      if (!months[m]) months[m] = { sessions: 0, profit: 0, wins: 0 };
      months[m].sessions++; months[m].profit += s.amount; if (s.amount > 0) months[m].wins++;
    });
    return Object.entries(months).map(([month, d]) => ({ month, sessions: d.sessions, profit: parseFloat(d.profit.toFixed(2)), winRate: d.sessions ? Math.round((d.wins / d.sessions) * 100) : 0 })).reverse();
  }, [sportsSessions]);

  const tournamentROI = useMemo(() => {
    if (!tournamentSessions.length) return null;
    const total = tournamentSessions.length, wins = tournamentSessions.filter((s) => s.amount > 0).length;
    const invested = tournamentSessions.filter((s) => s.amount < 0).reduce((a, s) => a + Math.abs(s.amount), 0);
    const profit = tournamentSessions.reduce((a, s) => a + s.amount, 0);
    return { total, wins, invested, profit: parseFloat(profit.toFixed(2)), roi: invested > 0 ? (profit / invested) * 100 : 0, itm: (wins / total) * 100 };
  }, [tournamentSessions]);

  const sessionsWithDuration = useMemo(() => pokerSessions.filter((s) => s.duration && s.duration > 60000), [pokerSessions]);
  const avgPerHour = useMemo(() => {
    if (!sessionsWithDuration.length) return null;
    const totalProfit = sessionsWithDuration.reduce((a, s) => a + s.amount, 0);
    const totalHours  = sessionsWithDuration.reduce((a, s) => a + s.duration / 3600000, 0);
    return totalHours > 0 ? totalProfit / totalHours : null;
  }, [sessionsWithDuration]);
  
  const bb100 = useMemo(() => { if (avgPerHour === null) return null; return ((avgPerHour / 80) / 0.02) * 100; }, [avgPerHour]);

  const weeklyStats = useMemo(() => ({ sessions: pokerSessions.length, profit: pokerProfit, winRate: pokerSessions.length ? Math.round((pokerWins / pokerSessions.length) * 100) : 0, leaks: leakSessions.length, best: bestSession }), [pokerSessions, pokerProfit, pokerWins, leakSessions, bestSession]);
  const sports5pct = useMemo(() => parseFloat((sports * 0.05).toFixed(2)), [sports]);

  // ─── STYLE HELPERS ─────────────────────────────────────────────────────────

  const inputStyle = { ...INPUT_STYLE_BASE, border: `1px solid ${C.border}`, background: C.surface, color: C.text };

  const getPillStyle = (on, color) => ({
    padding: "10px 18px", borderRadius: 12, border: `2px solid ${on ? color : C.border}`,
    background: on ? color : "transparent", color: on ? "#ffffff" : C.muted,
    fontSize: 13, cursor: "pointer", fontFamily: fontClean, fontWeight: "bold",
    transition: "all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)", transform: on ? "scale(1.05)" : "scale(1)", 
    boxShadow: on ? `0 6px 12px ${color}40` : "none", display: "flex", alignItems: "center", gap: 6, outline: "none"
  });

  const getTypeBtnStyle = (v) => ({
    flex: 1, padding: "12px 6px", borderRadius: 10, border: `1px solid ${form.type === v ? C.accent + "88" : C.border}`,
    cursor: "pointer", background: form.type === v ? C.accentDim : C.surface, color: form.type === v ? C.accent : C.muted,
    fontFamily: fontClean, fontSize: 13, fontWeight: "600", transition: "all 0.2s",
  });

  const getResBtnStyle = (v) => ({
    flex: 1, padding: 14, borderRadius: 10, border: "none", cursor: "pointer",
    background: form.result === v ? (v === "win" ? C.greenD : C.redD) : C.surface,
    color: form.result === v ? (v === "win" ? C.green : C.red) : C.muted,
    fontFamily: fontClean, fontSize: 14, fontWeight: "600", transition: "all 0.2s",
  });

  const cardStyle = {
    background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 20, marginBottom: 16, boxShadow: "0 4px 12px rgba(0,0,0,0.15)"
  };

  const sectionLabelStyle = {
    fontSize: 12, fontWeight: "600", color: C.muted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 16, fontFamily: fontClean
  };

  // ─── LOGIN SCREEN ────────────────────────────────────────────────────────

  if (!session) {
    return (
      <div style={{ background: C.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: fontClean }}>
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 20, padding: 36, width: "100%", maxWidth: 380, boxShadow: "0 8px 24px rgba(0,0,0,0.3)" }}>
          <div style={{ textAlign: "center", marginBottom: 36 }}>
            <div style={{ fontSize: 12, fontWeight: "600", color: C.muted, textTransform: "uppercase", letterSpacing: 2, marginBottom: 12 }}>Sistema de gestión</div>
            <div style={{ fontSize: 32, fontWeight: "bold", color: C.text, fontFamily: fontClassic }}>Diego's Edge ♠</div>
          </div>
          <form onSubmit={handleAuth}>
            <input type="email" placeholder="Correo electrónico" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} required style={{ ...inputStyle, marginBottom: 16 }} />
            <input type="password" placeholder="Contraseña" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} required style={{ ...inputStyle, marginBottom: 24 }} />
            <button type="submit" disabled={authLoading} onClick={() => playSound('click')} style={{ width: "100%", padding: 16, borderRadius: 12, border: "none", background: C.accentDim, color: C.accent, fontSize: 15, fontWeight: "bold", cursor: "pointer", letterSpacing: 1, textTransform: "uppercase" }}>
              {authLoading ? "Cargando..." : isLogin ? "Acceder" : "Crear cuenta"}
            </button>
          </form>
          <div style={{ textAlign: "center", marginTop: 24 }}>
            <button type="button" onClick={() => { playSound('click'); setIsLogin(!isLogin); }} style={{ background: "none", border: "none", color: C.muted, fontSize: 13, cursor: "pointer", textDecoration: "underline" }}>
              {isLogin ? "¿Sin cuenta? Regístrate" : "Ya tengo cuenta"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!loaded) return <div style={{ background: C.bg, height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, fontFamily: fontClean, letterSpacing: 2, fontSize: 14 }}>CONECTANDO...</div>;

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <div style={{ fontFamily: fontClean, background: C.bg, minHeight: "100vh", color: C.text, paddingBottom: 90 }}>

      {flash && <div style={{ position: "fixed", inset: 0, background: flash === "win" ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.08)", pointerEvents: "none", zIndex: 999 }} />}

      {/* ── Pre-session modal ── */}
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
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button type="button" onClick={() => startTimerActual(preSessionNote)}
                style={{ width: "100%", padding: 13, borderRadius: 10, border: "none", background: C.accentDim, color: C.accent, fontSize: 13, fontWeight: "bold", cursor: "pointer" }}>
                ▶ Iniciar sesión con foco
              </button>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" onClick={() => startTimerActual("")}
                  style={{ flex: 1, padding: "12px 16px", borderRadius: 10, border: `1px solid ${C.border}`, background: "transparent", color: C.muted, fontSize: 12, cursor: "pointer" }}>
                  Omitir y empezar
                </button>
                <button type="button" onClick={(e) => { e.preventDefault(); playSound('click'); setShowPreSession(false); setPreSessionNote(""); }}
                  style={{ flex: 1, padding: "12px 16px", borderRadius: 10, border: `1px solid ${C.border}`, background: "transparent", color: C.muted, fontSize: 12, cursor: "pointer" }}>
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "20px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: "600", color: C.muted, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 4 }}>Bankroll Manager</div>
          <div style={{ fontSize: 24, fontWeight: "bold", color: C.text, fontFamily: fontClassic }}>Diego's Edge <span style={{ color: C.accent }}>♠</span></div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 12, color: C.muted, fontWeight: "500" }}>{session.user.email.split("@")[0]}</div>
          {timerActive && (
            <div style={{ fontSize: 15, color: C.accent, fontWeight: "bold", marginTop: 4, fontFamily: "monospace" }}>
              ⏱ {fmtElapsed(timerElapsed)}
            </div>
          )}
        </div>
      </div>

      {(danger || warning) && (
        <div style={{ background: danger ? C.redD : C.goldD, borderLeft: `4px solid ${danger ? C.red : C.gold}`, padding: "12px 24px", fontSize: 14, color: "#fff", fontWeight: "600" }}>
          {danger ? "⛔ Bankroll crítico — Pausa esta semana" : "⚠️ Bankroll bajo — Máximo 1 buyin por sesión"}
        </div>
      )}

      {leakAlerts.length > 0 && (
        <div style={{ background: C.goldD, borderLeft: `4px solid ${C.gold}`, padding: "12px 24px", fontSize: 14, color: "#fff", fontWeight: "600" }}>
          ⚑ Patrón detectado: {leakAlerts.map((a) => `${a.pos} (${a.n}×)`).join(" · ")} — revisa antes de jugar
        </div>
      )}

      <div style={{ padding: "20px 20px", maxWidth: 540, margin: "0 auto" }}>

        {/* ══════════════════════════════════════════════════════════════
            DASHBOARD
        ══════════════════════════════════════════════════════════════ */}
        {tab === "dash" && <>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
            {/* Poker card */}
            <div style={{ ...cardStyle, border: `1px solid ${pokerProfit >= 0 ? C.greenD : C.redD}`, position: "relative", overflow: "hidden", marginBottom: 0 }}>
              <div style={{ position: "absolute", top: 0, right: 0, width: 80, height: 80, background: (pokerProfit >= 0 ? C.green : C.red) + "10", borderRadius: "0 16px 0 80px" }} />
              <div style={sectionLabelStyle}>Poker · USD</div>
              <div style={{ fontSize: 34, fontWeight: "bold", color: pokerProfit >= 0 ? C.green : C.red, fontFamily: fontClassic }}>${fmt(poker)}</div>
              <div style={{ fontSize: 13, color: pokerProfit >= 0 ? C.green : C.red, marginTop: 4, fontWeight: "500" }}>
                {sgn(pokerProfit)}{fmt(pokerProfit)} ({sgn(pokerProfit)}{fmt((pokerProfit / baseCapital.poker) * 100, 1)}%)
              </div>
              <Sparkline id="poker" data={pokerCurve} color={pokerProfit >= 0 ? C.green : C.red} />
            </div>

            {/* Sports card */}
            <div style={{ ...cardStyle, border: `1px solid ${sportsProfit >= 0 ? C.accentMid : C.redD}`, position: "relative", overflow: "hidden", marginBottom: 0 }}>
              <div style={{ position: "absolute", top: 0, right: 0, width: 80, height: 80, background: (sportsProfit >= 0 ? C.accent : C.red) + "10", borderRadius: "0 16px 0 80px" }} />
              <div style={sectionLabelStyle}>Depor · MXN</div>
              <div style={{ fontSize: 34, fontWeight: "bold", color: sportsProfit >= 0 ? C.accent : C.red, fontFamily: fontClassic }}>${fmt(sports, 2)}</div>
              <div style={{ fontSize: 13, color: sportsProfit >= 0 ? C.accent : C.red, marginTop: 4, fontWeight: "500" }}>
                {sgn(sportsProfit)}{fmt(sportsProfit, 2)} ({sgn(sportsProfit)}{fmt((sportsProfit / baseCapital.sports) * 100, 1)}%)
              </div>
              <div style={{ fontSize: 12, color: C.gold, marginTop: 8, fontWeight: "bold" }}>5% = ${sports5pct}</div>
              <Sparkline id="sports" data={sportsCurve} color={sportsProfit >= 0 ? C.accent : C.red} />
            </div>
          </div>

          {/* Stats row */}
          <div style={{ ...cardStyle, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
            {[
              { v: pokerSessions.length, l: "Sesiones" },
              { v: pokerWins,            l: "Ganadas"  },
              { v: pokerSessions.length ? `${((pokerWins / pokerSessions.length) * 100).toFixed(0)}%` : "—", l: "Win rate" },
              { v: streak > 0 ? `${streak}🔥` : "—", l: "Racha" },
            ].map((s) => (
              <div key={s.l} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 22, fontWeight: "bold", color: C.text, fontFamily: fontClassic }}>{s.v}</div>
                <div style={{ fontSize: 10, color: C.muted, marginTop: 4, textTransform: "uppercase", fontWeight: "600" }}>{s.l}</div>
              </div>
            ))}
          </div>

          {/* Monthly goal */}
          {monthlyGoal > 0 && (
            <div style={cardStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={sectionLabelStyle}>Meta {monthStr}</div>
                <div style={{ fontSize: 14, color: thisMonthProfit >= monthlyGoal ? C.green : C.accent, fontWeight: "bold", fontFamily: fontClassic }}>
                  {sgn(thisMonthProfit)}${fmt(Math.abs(thisMonthProfit))} / ${fmt(monthlyGoal)} USD
                </div>
              </div>
              <div style={{ height: 8, background: C.surface, borderRadius: 8, overflow: "hidden" }}>
                <div style={{ height: "100%", borderRadius: 8, transition: "width 0.5s ease", width: `${monthlyProgress}%`, background: thisMonthProfit < 0 ? C.red : monthlyProgress >= 100 ? C.green : C.accent }} />
              </div>
            </div>
          )}

          {/* Timer Card */}
          <div style={{ ...cardStyle, border: `1px solid ${timerActive ? C.accentMid : C.border}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: timerElapsed > 0 ? 16 : 0 }}>
              <div style={{ flex: 1 }}>
                <div style={{ ...sectionLabelStyle, marginBottom: 8 }}>Sesión activa</div>
                <div style={{ fontSize: 32, fontWeight: "bold", color: timerActive ? C.accent : C.muted, fontFamily: "monospace" }}>
                  {fmtElapsed(timerElapsed)}
                </div>
                {preSessionNote && <div style={{ fontSize: 13, color: C.accent, marginTop: 6, fontWeight: "500" }}>🎯 {preSessionNote}</div>}
                {timerElapsed > 0 && !timerActive && !preSessionNote && <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>Pausado</div>}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" onClick={toggleTimer} style={{ padding: "14px 20px", borderRadius: 12, border: `1px solid ${timerActive ? C.accent : C.border}`, background: timerActive ? C.accentDim : C.surface, color: timerActive ? C.accent : C.text, fontSize: 14, cursor: "pointer", fontWeight: "bold" }}>
                  {timerActive ? "⏸ Pausa" : timerElapsed > 0 ? "▶ Reanudar" : "▶ Iniciar"}
                </button>
                {timerElapsed > 0 && <button type="button" onClick={resetTimer} style={{ padding: "14px 16px", borderRadius: 12, border: `1px solid ${C.border}`, background: C.surface, color: C.muted, fontSize: 14, cursor: "pointer" }}>✕</button>}
              </div>
            </div>
            
            {timerElapsed > 0 && (
              <button type="button" onClick={stopAndRegister} 
                style={{ width: "100%", padding: "14px", borderRadius: 10, border: `1px solid ${C.accent}`, background: C.accentDim, color: C.accent, fontSize: 14, cursor: "pointer", fontWeight: "bold", letterSpacing: 1 }}>
                🏁 FINALIZAR Y REGISTRAR
              </button>
            )}
          </div>

          {/* Tilt + Hábitos */}
          <div style={cardStyle}>
            <div style={sectionLabelStyle}>Hábitos de hoy</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 24 }}>
              {[{ k: "meditar", l: "🧘 Meditar" }, { k: "agua", l: "💧 Agua" }, { k: "omega", l: "🐟 Omega-3" }, { k: "ejercicio", l: "🏃 Ejercicio" }].map((h) => (
                <button type="button" key={h.k} onClick={(e) => toggleHabit(e, h.k)} style={getPillStyle(habits[h.k], C.accent)}>
                  {h.l} {habits[h.k] && <span style={{ marginLeft: 4 }}>✓</span>}
                </button>
              ))}
            </div>
            <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ ...sectionLabelStyle, marginBottom: 0 }}>Estado mental</div>
                <div style={{ fontSize: 14, color: tiltColor, fontWeight: "bold" }}>
                  {tiltScore >= 4 ? "✓" : tiltScore >= 2 ? "⚠" : "✗"} {tiltLabel}
                </div>
              </div>
              <div style={{ height: 6, background: C.surface, borderRadius: 6, marginBottom: 16, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${(tiltScore / TILT_QS.length) * 100}%`, background: tiltColor, borderRadius: 6, transition: "width 0.4s ease" }} />
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {TILT_QS.map((q) => (
                  <button type="button" key={q.id} onClick={(e) => toggleTilt(e, q.id)} style={getPillStyle(tilt[q.id], tiltColor)}>
                    {q.icon} {q.label} {tilt[q.id] && <span style={{ marginLeft: 4 }}>✓</span>}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* NL Ladder */}
          <div style={cardStyle}>
            <div style={sectionLabelStyle}>Escalera NL</div>
            {POKER_LADDER.map((r) => {
              const prev = POKER_LADDER[POKER_LADDER.indexOf(r) - 1]?.at || baseCapital.poker;
              const pct  = Math.min(((poker - prev) / (r.at - prev)) * 100, 100);
              const done = poker >= r.at;
              return (
                <div key={r.at} style={{ marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <div style={{ fontSize: 14, fontWeight: "bold", color: done ? C.green : C.text }}>{r.label}</div>
                    <div style={{ fontSize: 12, color: done ? C.green : C.muted, fontWeight: "500" }}>
                      {done ? "✓ Alcanzado" : `$${fmt(poker, 0)} / $${r.at} · faltan $${fmt(r.at - poker, 0)}`}
                    </div>
                  </div>
                  <div style={{ height: 8, background: C.surface, borderRadius: 8, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${Math.max(done ? 100 : pct, 0)}%`, background: done ? C.green : C.accent, borderRadius: 8, transition: "width 0.5s ease" }} />
                  </div>
                </div>
              );
            })}
            {nextLevel && (
              <div style={{ marginTop: 16, padding: "12px 16px", background: C.surface, borderRadius: 10, fontSize: 13, color: C.muted, fontWeight: "500" }}>
                {nextLevel.sessions !== null
                  ? `📈 A tu ritmo (+${fmt(avgLast10)} USD/sesión): ${nextLevel.sessions} sesiones para ${nextLevel.label}`
                  : `⚠ Promedio negativo — enfócate en el juego antes de proyectar ${nextLevel.label}`}
              </div>
            )}
          </div>

          {/* Journal */}
          <div style={cardStyle}>
            <div style={sectionLabelStyle}>Diario del día</div>
            <textarea
              placeholder="Reflexión, mano interesante, decisión clave del día..."
              value={journal}
              onChange={(e) => { setJournal(e.target.value); setJournalSaved(false); }}
              style={{ width: "100%", padding: "14px 16px", borderRadius: 12, border: `1px solid ${C.border}`, background: C.surface, color: C.text, fontSize: 14, fontFamily: fontClean, boxSizing: "border-box", outline: "none", minHeight: 90, resize: "none", lineHeight: 1.6 }}
            />
            <button type="button" onClick={saveJournal} style={{ marginTop: 12, padding: "10px 20px", borderRadius: 10, border: `1px solid ${journalSaved ? C.green : C.border}`, background: journalSaved ? C.greenD + "44" : C.surface, color: journalSaved ? C.green : C.text, fontSize: 13, cursor: "pointer", fontWeight: "600", transition: "all 0.3s" }}>
              {journalSaved ? "✓ Guardado" : "Guardar nota"}
            </button>
          </div>

        </>}

        {/* ══════════════════════════════════════════════════════════════
            REGISTRAR
        ══════════════════════════════════════════════════════════════ */}
        {tab === "reg" && (
          <div style={cardStyle}>
            <div style={sectionLabelStyle}>Nueva sesión</div>

            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              {[["cash", "Cash NL2"], ["tournament", "Torneo"], ["sports", "Depor"]].map(([v, l]) => (
                <button type="button" key={v} onClick={(e) => { e.preventDefault(); playSound('click'); setForm({ ...form, type: v }); }} style={getTypeBtnStyle(v)}>{l}</button>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
              <button type="button" onClick={(e) => { e.preventDefault(); playSound('click'); setForm({ ...form, result: "win" }); }}  style={getResBtnStyle("win")}>▲ Ganancia</button>
              <button type="button" onClick={(e) => { e.preventDefault(); playSound('click'); setForm({ ...form, result: "loss" }); }} style={getResBtnStyle("loss")}>▼ Pérdida</button>
            </div>

            {form.type === "sports" && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, padding: "12px 16px", background: C.gold + "15", borderRadius: 10, border: `1px solid ${C.gold}33` }}>
                <span style={{ fontSize: 13, color: C.gold, fontWeight: "500" }}>5% recomendado:</span>
                <span style={{ fontSize: 16, fontWeight: "bold", color: C.gold, fontFamily: fontClassic }}>${sports5pct} MXN</span>
                <button type="button" onClick={(e) => { e.preventDefault(); playSound('click'); setForm({ ...form, amount: String(sports5pct) }); }}
                  style={{ marginLeft: "auto", fontSize: 12, padding: "6px 14px", borderRadius: 8, border: `1px solid ${C.gold}55`, background: C.gold + "22", color: C.gold, cursor: "pointer", fontWeight: "bold" }}>
                  Usar
                </button>
              </div>
            )}

            {timerElapsedRef.current > 0 && form.type !== "sports" && (
              <div style={{ padding: "10px 14px", background: C.accentDim, border: `1px solid ${C.accent}44`, borderRadius: 10, marginBottom: 16, fontSize: 13, color: C.accent, fontWeight: "500" }}>
                ⏱ Se asociará un tiempo de <strong>{fmtElapsed(timerElapsedRef.current)}</strong> a este registro para calcular tu Rentabilidad por Hora (BB/100).
              </div>
            )}

            <div style={{ fontSize: 11, fontWeight: "600", color: C.muted, textTransform: "uppercase", marginBottom: 8 }}>Acceso rápido</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
              {(form.type === "sports" ? QUICK_SPORTS : QUICK_POKER).map((q) => (
                <button type="button" key={q} onClick={(e) => { e.preventDefault(); playSound('click'); setForm({ ...form, amount: String(q) }); }}
                  style={{ padding: "8px 16px", borderRadius: 10, border: `1px solid ${String(form.amount) === String(q) ? C.accent : C.border}`, background: String(form.amount) === String(q) ? C.accentDim : C.surface, color: String(form.amount) === String(q) ? C.accent : C.text, fontSize: 14, cursor: "pointer", fontWeight: "600", fontFamily: fontClassic }}>
                  {form.type === "sports" ? `$${q}` : `${q}$`}
                </button>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <input type="number" min="0" step="0.01"
                placeholder={form.type === "sports" ? "Monto en MXN" : "Monto en USD"}
                value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}
                style={{ ...inputStyle, fontSize: 18, fontFamily: fontClassic, flex: 2 }}
              />
              {form.type !== "sports" && (
                <input type="number" min="0" step="1"
                  placeholder="Min. jugados"
                  value={form.durationMins} onChange={(e) => setForm({ ...form, durationMins: e.target.value })}
                  style={{ ...inputStyle, fontSize: 14, flex: 1 }}
                />
              )}
            </div>

            <input type="text" placeholder="Nota — ej: 'AA vs KK, board seco'"
              value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
              style={{ ...inputStyle, marginBottom: 20 }}
            />

            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, fontWeight: "600", color: C.muted, textTransform: "uppercase", marginBottom: 12 }}>Calificación de decisión</div>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <StarRating value={form.rating} onChange={(r) => setForm({ ...form, rating: r })} C={C} />
                <div style={{ fontSize: 13, color: C.muted, fontWeight: "500" }}>
                  {form.rating === 0 ? "Sin calificar" : ["", "Muy mal", "Mal", "Regular", "Bien", "Excelente"][form.rating]}
                </div>
              </div>
            </div>

            <button type="button" onClick={addSession}
              style={{ width: "100%", padding: 18, borderRadius: 12, border: "none", cursor: "pointer", background: form.result === "win" ? C.greenD : C.redD, color: form.result === "win" ? C.green : C.red, fontSize: 16, fontWeight: "bold", letterSpacing: 1 }}>
              REGISTRAR SESIÓN
            </button>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════
            ANALYTICS 
        ══════════════════════════════════════════════════════════════ */}
        {tab === "analytics" && (
          <div>
            <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
              {[["general", "General"], ["months", "Meses"], ["tournaments", "Torneos"], ["sports", "Deportes"]].map(([v, l]) => (
                <button type="button" key={v} onClick={(e) => { e.preventDefault(); playSound('click'); setAnalyticsView(v); }}
                  style={{ flex: 1, padding: "10px 4px", borderRadius: 10, border: `1px solid ${analyticsView === v ? C.accent + "88" : C.border}`, background: analyticsView === v ? C.accentDim : C.card, color: analyticsView === v ? C.accent : C.muted, fontSize: 12, cursor: "pointer", fontWeight: "600" }}>
                  {l}
                </button>
              ))}
            </div>

            {/* ANALÍTICAS GENERALES (POKER) */}
            {analyticsView === "general" && <>
              <div style={cardStyle}>
                <div style={sectionLabelStyle}>Últimas 7 sesiones poker</div>
                <BarChart data={last7} C={C} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
                {[
                  { label: "Profit total",        value: `${sgn(pokerProfit)}$${fmt(Math.abs(pokerProfit))}`,        color: pokerProfit  >= 0 ? C.green : C.red },
                  { label: `Este mes (${monthStr})`, value: `${sgn(thisMonthProfit)}$${fmt(Math.abs(thisMonthProfit))}`, color: thisMonthProfit >= 0 ? C.green : C.red },
                  { label: "Mejor sesión",         value: `+$${fmt(bestSession)}`,  color: C.green },
                  { label: "Peor sesión",          value: `$${fmt(worstSession)}`,  color: C.red   },
                ].map((m) => (
                  <div key={m.label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 16, boxShadow: "0 4px 12px rgba(0,0,0,0.15)" }}>
                    <div style={{ fontSize: 11, fontWeight: "600", color: C.muted, textTransform: "uppercase", marginBottom: 8 }}>{m.label}</div>
                    <div style={{ fontSize: 26, fontWeight: "bold", color: m.color, fontFamily: fontClassic }}>{m.value}</div>
                  </div>
                ))}
              </div>

              <div style={cardStyle}>
                <div style={sectionLabelStyle}>Promedios</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                  {[
                    { label: "Promedio",        value: `${sgn(avgSession)}$${fmt(Math.abs(avgSession))}`, c: avgSession >= 0 ? C.green : C.red },
                    { label: `Ses. ${monthStr}`, value: thisMonthSessions.length, c: C.accent },
                    { label: "Win rate",         value: pokerSessions.length ? `${((pokerWins / pokerSessions.length) * 100).toFixed(0)}%` : "—", c: C.text },
                  ].map((x) => (
                    <div key={x.label} style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 24, fontWeight: "bold", color: x.c, fontFamily: fontClassic }}>{x.value}</div>
                      <div style={{ fontSize: 10, color: C.muted, marginTop: 6, textTransform: "uppercase", fontWeight: "600" }}>{x.label}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={cardStyle}>
                <div style={sectionLabelStyle}>Rentabilidad por hora</div>
                {sessionsWithDuration.length === 0 ? (
                  <div style={{ fontSize: 14, color: C.textDim, textAlign: "center", padding: "16px 0" }}>
                    Usa el timer al jugar para calcular $/hora y BB/100
                  </div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                    {[
                      { label: "$/hora",           value: avgPerHour !== null ? `${sgn(avgPerHour)}$${fmt(Math.abs(avgPerHour), 2)}` : "—", c: avgPerHour !== null && avgPerHour >= 0 ? C.green : C.red },
                      { label: "BB/100 (est. 80 manos/hr)", value: bb100 !== null ? `${sgn(bb100)}${fmt(Math.abs(bb100), 1)}` : "—", c: bb100 !== null && bb100 >= 0 ? C.green : C.red },
                      { label: "Ses. con timer",   value: sessionsWithDuration.length, c: C.accent },
                    ].map((x) => (
                      <div key={x.label} style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 22, fontWeight: "bold", color: x.c, fontFamily: fontClassic }}>{x.value}</div>
                        <div style={{ fontSize: 10, color: C.muted, marginTop: 6, textTransform: "uppercase", fontWeight: "600" }}>{x.label}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={cardStyle}>
                <div style={sectionLabelStyle}>Heatmap — {monthStr}</div>
                <HeatmapCalendar sessions={pokerSessions} monthStr={monthStr} C={C} />
              </div>

              {pokerCurve.length >= 2 && (
                <div style={cardStyle}>
                  <div style={sectionLabelStyle}>Curva de equity</div>
                  <svg viewBox="0 0 300 80" style={{ width: "100%", height: 80, display: "block" }}>
                    {(() => {
                      const pts = pokerCurve;
                      const mn  = Math.min(...pts) - 1, mx = Math.max(...pts) + 1;
                      const range = mx - mn || 1;
                      const W = 300, H = 78;
                      const points     = pts.map((v, i) => `${(i / (pts.length - 1)) * W},${H - ((v - mn) / range) * H}`).join(" ");
                      const areaPoints = `0,${H} ${points} ${W},${H}`;
                      return (
                        <>
                          <defs>
                            <linearGradient id="eqgrad" x1="0" x2="0" y1="0" y2="1">
                              <stop offset="0%"   stopColor={pokerProfit >= 0 ? C.green : C.red} stopOpacity="0.3" />
                              <stop offset="100%" stopColor={pokerProfit >= 0 ? C.green : C.red} stopOpacity="0" />
                            </linearGradient>
                          </defs>
                          <polygon fill="url(#eqgrad)" points={areaPoints} />
                          <polyline fill="none" stroke={pokerProfit >= 0 ? C.green : C.red} strokeWidth="2.5" strokeLinejoin="round" points={points} />
                        </>
                      );
                    })()}
                  </svg>
                </div>
              )}
            </>}

            {/* ANALÍTICAS MESES (POKER) */}
            {analyticsView === "months" && (
              <div style={cardStyle}>
                <div style={sectionLabelStyle}>Comparativa por mes — poker</div>
                {monthlyBreakdown.length === 0 ? (
                  <div style={{ textAlign: "center", color: C.textDim, fontSize: 14, padding: 24 }}>Sin datos suficientes</div>
                ) : (
                  monthlyBreakdown.map((m) => {
                    const maxP    = Math.max(...monthlyBreakdown.map((x) => Math.abs(x.profit)), 1);
                    const barPct  = Math.abs(m.profit) / maxP * 100;
                    const isPos   = m.profit >= 0;
                    return (
                      <div key={m.month} style={{ marginBottom: 20 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                          <div style={{ fontSize: 14, color: C.text, fontWeight: "bold", textTransform: "uppercase", letterSpacing: 1 }}>{m.month}</div>
                          <div style={{ display: "flex", gap: 16, fontSize: 13 }}>
                            <span style={{ color: C.muted }}>{m.sessions} ses.</span>
                            <span style={{ color: C.muted }}>{m.winRate}% wr</span>
                            <span style={{ color: isPos ? C.green : C.red, fontWeight: "bold", fontFamily: fontClassic }}>{sgn(m.profit)}${fmt(Math.abs(m.profit))}</span>
                          </div>
                        </div>
                        <div style={{ height: 8, background: C.surface, borderRadius: 8, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${barPct}%`, background: isPos ? C.green : C.red, borderRadius: 8, transition: "width 0.4s ease" }} />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* ANALÍTICAS TORNEOS */}
            {analyticsView === "tournaments" && (
              <div style={cardStyle}>
                <div style={{ ...sectionLabelStyle, color: C.gold }}>Rendimiento en torneos</div>
                {!tournamentROI ? (
                  <div style={{ textAlign: "center", color: C.textDim, fontSize: 14, padding: 24 }}>Sin torneos registrados</div>
                ) : (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
                      {[
                        { l: "ROI",            v: `${sgn(tournamentROI.roi)}${fmt(Math.abs(tournamentROI.roi), 1)}%`, c: tournamentROI.roi  >= 0 ? C.green : C.red },
                        { l: "ITM %",          v: `${fmt(tournamentROI.itm, 1)}%`,                                    c: tournamentROI.itm  >= 33 ? C.green : C.gold },
                        { l: "Total torneos",  v: tournamentROI.total,                                                c: C.text  },
                        { l: "Profit neto",    v: `${sgn(tournamentROI.profit)}$${fmt(Math.abs(tournamentROI.profit))}`, c: tournamentROI.profit >= 0 ? C.green : C.red },
                      ].map((m) => (
                        <div key={m.l} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16, textAlign: "center" }}>
                          <div style={{ fontSize: 26, fontWeight: "bold", color: m.c, fontFamily: fontClassic }}>{m.v}</div>
                          <div style={{ fontSize: 11, color: C.muted, marginTop: 6, textTransform: "uppercase", fontWeight: "600" }}>{m.l}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ padding: "14px 16px", background: C.surface, borderRadius: 12, fontSize: 13, color: C.textDim, lineHeight: 1.6, textAlign: "center" }}>
                      Invertido: <span style={{ color: C.text, fontWeight: "bold", fontFamily: fontClassic }}>${fmt(tournamentROI.invested)} USD</span> <br/> 
                      Ganadas: <span style={{ color: C.text, fontWeight: "bold" }}>{tournamentROI.wins}</span> de {tournamentROI.total}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ANALÍTICAS DEPORTIVAS */}
            {analyticsView === "sports" && <>
              <div style={cardStyle}>
                <div style={{ ...sectionLabelStyle, color: C.accent }}>Últimas 7 apuestas</div>
                <BarChart data={last7Sports} C={C} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
                {[
                  { label: "Win Rate",       value: sportsSessions.length ? `${sportsWinRate}%` : "—", color: sportsWinRate >= 50 ? C.green : C.red },
                  { label: "Total Apuestas", value: sportsSessions.length, color: C.text },
                  { label: "Mejor ganancia", value: `+$${fmt(sportsBest, 2)}`, color: C.green },
                  { label: "Peor pérdida",   value: `$${fmt(sportsWorst, 2)}`, color: C.red },
                ].map((m) => (
                  <div key={m.label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 16, boxShadow: "0 4px 12px rgba(0,0,0,0.15)" }}>
                    <div style={{ fontSize: 11, fontWeight: "600", color: C.muted, textTransform: "uppercase", marginBottom: 8 }}>{m.label}</div>
                    <div style={{ fontSize: 26, fontWeight: "bold", color: m.color, fontFamily: fontClassic }}>{m.value}</div>
                  </div>
                ))}
              </div>

              <div style={cardStyle}>
                <div style={{ ...sectionLabelStyle, color: C.accent }}>Promedio por apuesta</div>
                <div style={{ textAlign: "center", padding: "10px 0" }}>
                  <div style={{ fontSize: 36, fontWeight: "bold", color: sportsAvg >= 0 ? C.green : C.red, fontFamily: fontClassic }}>
                    {sgn(sportsAvg)}${fmt(Math.abs(sportsAvg), 2)} MXN
                  </div>
                  <div style={{ fontSize: 12, color: C.muted, marginTop: 8, textTransform: "uppercase", fontWeight: "600" }}>Beneficio neto promedio</div>
                </div>
              </div>

              <div style={cardStyle}>
                <div style={{ ...sectionLabelStyle, color: C.accent }}>Desglose por Mes — Deportes</div>
                {sportsMonthlyBreakdown.length === 0 ? (
                  <div style={{ textAlign: "center", color: C.textDim, fontSize: 14, padding: 24 }}>Sin datos suficientes</div>
                ) : (
                  sportsMonthlyBreakdown.map((m) => {
                    const maxP    = Math.max(...sportsMonthlyBreakdown.map((x) => Math.abs(x.profit)), 1);
                    const barPct  = Math.abs(m.profit) / maxP * 100;
                    const isPos   = m.profit >= 0;
                    return (
                      <div key={m.month} style={{ marginBottom: 20 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                          <div style={{ fontSize: 14, color: C.text, fontWeight: "bold", textTransform: "uppercase", letterSpacing: 1 }}>{m.month}</div>
                          <div style={{ display: "flex", gap: 16, fontSize: 13 }}>
                            <span style={{ color: C.muted }}>{m.sessions} ap.</span>
                            <span style={{ color: C.muted }}>{m.winRate}% wr</span>
                            <span style={{ color: isPos ? C.green : C.red, fontWeight: "bold", fontFamily: fontClassic }}>{sgn(m.profit)}${fmt(Math.abs(m.profit), 2)}</span>
                          </div>
                        </div>
                        <div style={{ height: 8, background: C.surface, borderRadius: 8, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${barPct}%`, background: isPos ? C.green : C.red, borderRadius: 8, transition: "width 0.4s ease" }} />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════
            SPOTS & LEAKS (AHORA CON MATRIZ GTO 13x13)
        ══════════════════════════════════════════════════════════════ */}
        {tab === "leaks" && (
          <div>
            <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
              <button type="button" onClick={(e) => { e.preventDefault(); playSound('click'); setLeaksView("registry"); }}
                style={{ flex: 1, padding: "12px", borderRadius: 10, border: `1px solid ${leaksView === "registry" ? C.gold : C.border}`, background: leaksView === "registry" ? C.gold + "22" : C.card, color: leaksView === "registry" ? C.gold : C.muted, fontSize: 13, cursor: "pointer", fontWeight: "bold" }}>
                Mis Leaks
              </button>
              <button type="button" onClick={(e) => { e.preventDefault(); playSound('click'); setLeaksView("gto"); }}
                style={{ flex: 1, padding: "12px", borderRadius: 10, border: `1px solid ${leaksView === "gto" ? C.accent : C.border}`, background: leaksView === "gto" ? C.accentDim : C.card, color: leaksView === "gto" ? C.accent : C.muted, fontSize: 13, cursor: "pointer", fontWeight: "bold" }}>
                Tablas GTO
              </button>
            </div>

            {leaksView === "registry" && (
              <>
                <div style={cardStyle}>
                  <div style={{ ...sectionLabelStyle, color: C.gold }}>Registrar leak / error</div>
                  <div style={{ fontSize: 12, color: C.muted, marginBottom: 10, fontWeight: "500" }}>Posición</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                    {POSITIONS.map((p) => (
                      <button type="button" key={p} onClick={(e) => { e.preventDefault(); playSound('click'); setLeakForm({ ...leakForm, position: p }); }}
                        style={{ padding: "8px 14px", borderRadius: 10, border: `1px solid ${leakForm.position === p ? C.gold : C.border}`, background: leakForm.position === p ? C.gold + "22" : C.surface, color: leakForm.position === p ? C.gold : C.text, fontSize: 13, cursor: "pointer", fontWeight: "600" }}>
                        {p}
                      </button>
                    ))}
                  </div>
                  <textarea
                    placeholder="Describe el error... ej: Pagué 3bet OOP con AJo"
                    value={leakForm.note} onChange={(e) => setLeakForm({ ...leakForm, note: e.target.value })}
                    style={{ ...inputStyle, minHeight: 100, resize: "none", lineHeight: 1.6, marginBottom: 20 }}
                  />
                  <button type="button" onClick={addLeak} style={{ width: "100%", padding: 16, borderRadius: 12, border: "none", cursor: "pointer", background: C.gold + "22", color: C.gold, fontSize: 15, fontWeight: "bold", letterSpacing: 1 }}>
                    GUARDAR LEAK
                  </button>
                </div>

                <div style={{ ...cardStyle, background: C.surface, border: "none" }}>
                  <div style={{ ...sectionLabelStyle, marginBottom: 12 }}>
                    Áreas de mejora ({leakSessions.length})
                  </div>
                  {leakSessions.map((s) => (
                    <div key={s.id} style={{ display: "flex", gap: 16, padding: "16px 0", borderBottom: `1px solid ${C.border}` }}>
                      <div style={{ background: C.card, border: `1px solid ${C.border}`, color: leakAlerts.some((a) => a.pos === (s.buyin || "GNRL")) ? C.red : C.gold, padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: "bold", whiteSpace: "nowrap", height: "fit-content", marginTop: 2 }}>
                        {s.buyin || "GNRL"}
                        {leakAlerts.some((a) => a.pos === (s.buyin || "GNRL")) && " ⚑"}
                      </div>
                      <div>
                        <div style={{ fontSize: 14, color: C.text, lineHeight: 1.6 }}>{s.note}</div>
                        <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>{s.date}</div>
                      </div>
                    </div>
                  ))}
                  {leakSessions.length === 0 && (
                    <div style={{ textAlign: "center", color: C.muted, padding: "32px 0", fontSize: 14 }}>Sin leaks registrados. ¡Excelente!</div>
                  )}
                </div>
              </>
            )}

            {leaksView === "gto" && (
              <div style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
                <div style={{ padding: "20px 20px 10px" }}>
                  <div style={{ ...sectionLabelStyle, color: C.accent, marginBottom: 16 }}>Matriz Preflop GTO (13x13)</div>
                  
                  {/* Selectores de Profundidad */}
                  <div style={{ display: "flex", gap: 8, marginBottom: 16, overflowX: "auto", paddingBottom: 4 }}>
                    {Object.keys(GTO_TABLES).map(k => (
                      <button type="button" key={k} onClick={(e) => { e.preventDefault(); playSound('click'); setGtoDepth(k); setGtoPosIdx(0); }} 
                        style={{ whiteSpace: "nowrap", padding: "10px 14px", borderRadius: 8, border: `1px solid ${gtoDepth === k ? C.accent : C.border}`, background: gtoDepth === k ? C.accentDim : C.surface, color: gtoDepth === k ? C.accent : C.muted, fontSize: 12, fontWeight: "bold", cursor: "pointer" }}>
                        {k.replace("_", " ").toUpperCase()}
                      </button>
                    ))}
                  </div>

                  {/* Selectores de Posición */}
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                    {GTO_TABLES[gtoDepth].map((row, idx) => (
                      <button type="button" key={idx} onClick={(e) => { e.preventDefault(); playSound('click'); setGtoPosIdx(idx); }}
                        style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${gtoPosIdx === idx ? C.text : C.border}`, background: gtoPosIdx === idx ? C.text : "transparent", color: gtoPosIdx === idx ? C.bg : C.muted, fontSize: 11, fontWeight: "bold", cursor: "pointer" }}>
                        {row.pos}
                      </button>
                    ))}
                  </div>

                  <div style={{ fontSize: 13, color: C.textDim, lineHeight: 1.5, background: C.surface, padding: 12, borderRadius: 8, border: `1px solid ${C.border}` }}>
                    <span style={{ fontWeight: "bold", color: C.accent }}>INFO: </span> 
                    {GTO_TABLES[gtoDepth][gtoPosIdx].notes}
                  </div>

                  {/* Renderizado de la Matriz */}
                  <GTOMatrix rangeStr={GTO_TABLES[gtoDepth][gtoPosIdx].range} C={C} />
                  
                  <div style={{ display: "flex", gap: 12, marginTop: 12, justifyContent: "center", fontSize: 10, color: C.muted, fontWeight: "bold" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 4 }}><div style={{width: 10, height: 10, background: C.greenD}}></div> Pares</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 4 }}><div style={{width: 10, height: 10, background: "#0284c7"}}></div> Suited</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 4 }}><div style={{width: 10, height: 10, background: C.goldD}}></div> Offsuit</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════
            HISTORIAL
        ══════════════════════════════════════════════════════════════ */}
        {tab === "hist" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div style={sectionLabelStyle}>{showArchived ? "Archivadas" : "Historial"}</div>
              <button type="button" onClick={(e) => { e.preventDefault(); playSound('click'); setShowArchived(!showArchived); }} style={{ fontSize: 12, background: C.surface, border: `1px solid ${C.border}`, color: C.text, padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontWeight: "600" }}>
                {showArchived ? "Ver activas" : "Archivadas"}
              </button>
            </div>
            {(() => {
              const grouped = showArchived ? groupedArchived : groupedActive;
              if (grouped.length === 0) return (
                <div style={{ ...cardStyle, textAlign: "center", color: C.muted, fontSize: 14, padding: 40 }}>
                  Sin sesiones registradas
                </div>
              );
              return grouped.map(([date, daySessions]) => {
                const dayTotal       = daySessions.filter((s) => s.type !== "sports").reduce((a, s) => a + s.amount, 0);
                const dayTotalSports = daySessions.filter((s) => s.type === "sports").reduce((a, s) => a + s.amount, 0);
                return (
                  <div key={date} style={{ marginBottom: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 8px", marginBottom: 8 }}>
                      <div style={{ fontSize: 13, color: C.accent, fontWeight: "600", textTransform: "uppercase" }}>{date}</div>
                      <div style={{ display: "flex", gap: 12 }}>
                        {daySessions.some((s) => s.type !== "sports") && (
                          <div style={{ fontSize: 13, fontWeight: "bold", color: dayTotal >= 0 ? C.green : C.red, fontFamily: fontClassic }}>
                            {sgn(dayTotal)}{fmt(dayTotal)} USD
                          </div>
                        )}
                        {dayTotalSports !== 0 && (
                          <div style={{ fontSize: 13, fontWeight: "bold", color: dayTotalSports >= 0 ? C.accent : C.red, fontFamily: fontClassic }}>
                            {sgn(dayTotalSports)}{fmt(dayTotalSports, 2)} MXN
                          </div>
                        )}
                      </div>
                    </div>
                    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, overflow: "hidden", boxShadow: "0 4px 12px rgba(0,0,0,0.15)" }}>
                      {daySessions.map((s, i) => (
                        <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderBottom: i < daySessions.length - 1 ? `1px solid ${C.border}` : "none" }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 14, color: C.text }}>
                              <span style={{ fontSize: 10, fontWeight: "bold", textTransform: "uppercase", color: s.type === "sports" ? C.accent : s.type === "tournament" ? C.gold : C.green, marginRight: 10 }}>{s.type}</span>
                              {s.note && <span style={{ color: C.textDim }}>{s.note}</span>}
                            </div>
                            <div style={{ display: "flex", gap: 12, marginTop: 6 }}>
                              {s.rating > 0 && <span style={{ fontSize: 13, color: C.gold }}>{"★".repeat(s.rating)}{"☆".repeat(5 - s.rating)}</span>}
                              {s.duration > 0 && <span style={{ fontSize: 12, color: C.muted }}>{Math.round(s.duration / 60000)} min</span>}
                            </div>
                          </div>
                          <div style={{ fontSize: 18, fontWeight: "bold", color: s.amount > 0 ? C.green : C.red, fontFamily: fontClassic }}>
                            {s.amount > 0 ? "+" : ""}{fmt(s.amount, s.type === "sports" ? 2 : 2)} {s.type === "sports" ? "MXN" : "USD"}
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
            <div style={cardStyle}>
              <div style={sectionLabelStyle}>⚙️ Capital inicial</div>
              <div style={{ display: "flex", gap: 16, marginBottom: 20 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: C.muted, marginBottom: 8, fontWeight: "500" }}>Poker (USD)</div>
                  <input type="number" min="0" value={baseCapital.poker} onChange={(e) => setBaseCapital({ ...baseCapital, poker: Number(e.target.value) })} style={{ ...inputStyle, fontFamily: fontClassic, fontSize: 18 }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: C.muted, marginBottom: 8, fontWeight: "500" }}>Depor (MXN)</div>
                  <input type="number" min="0" value={baseCapital.sports} onChange={(e) => setBaseCapital({ ...baseCapital, sports: Number(e.target.value) })} style={{ ...inputStyle, fontFamily: fontClassic, fontSize: 18 }} />
                </div>
              </div>

              <div style={{ fontSize: 12, color: C.muted, marginBottom: 8, fontWeight: "500" }}>Meta mensual poker (USD)</div>
              <input type="number" min="0" value={monthlyGoal}
                onChange={(e) => setMonthlyGoal(Number(e.target.value))}
                style={{ ...inputStyle, fontFamily: fontClassic, fontSize: 18, marginBottom: 24 }}
              />

              <div style={{ fontSize: 12, color: C.muted, marginBottom: 12, fontWeight: "500" }}>Color del tema</div>
              <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
                {ACCENT_PRESETS.map((p) => (
                  <button type="button" key={p.v} onClick={(e) => { e.preventDefault(); handleSetAccent(p.v); }}
                    style={{ width: 36, height: 36, borderRadius: "50%", border: `2px solid ${accent === p.v ? "#fff" : "transparent"}`, background: p.v, cursor: "pointer", boxShadow: accent === p.v ? `0 0 0 2px ${p.v}` : "none", transition: "all 0.2s" }} />
                ))}
              </div>

              {recentColors.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 11, color: C.muted, marginBottom: 10, textTransform: "uppercase", fontWeight: "600" }}>Recientes</div>
                  <div style={{ display: "flex", gap: 12 }}>
                    {recentColors.map((col) => (
                      <button type="button" key={col} onClick={(e) => { e.preventDefault(); handleSetAccent(col); }}
                        style={{ width: 32, height: 32, borderRadius: "50%", border: `2px solid ${accent === col ? "#fff" : "transparent"}`, background: col, cursor: "pointer", boxShadow: accent === col ? `0 0 0 2px ${col}` : "none" }} />
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
                <input
                  type="text" placeholder="#3b82f6" value={customHex}
                  onChange={(e) => setCustomHex(e.target.value)}
                  style={{ ...inputStyle, padding: "10px 16px", flex: 1 }}
                  maxLength={7}
                />
                <button type="button" 
                  onClick={(e) => { e.preventDefault(); playSound('click'); if (isValid(customHex)) { handleSetAccent(customHex); setCustomHex(""); } else alert("Hex inválido. Usa formato #RRGGBB"); }}
                  style={{ padding: "10px 20px", borderRadius: 10, border: `1px solid ${C.border}`, background: customHex && isValid(customHex) ? customHex + "33" : C.surface, color: C.text, fontSize: 14, cursor: "pointer", fontWeight: "600" }}>
                  Aplicar
                </button>
              </div>

              <button type="button" onClick={saveConfig} style={{ width: "100%", padding: 16, borderRadius: 12, border: "none", background: C.accentDim, color: C.accent, fontSize: 14, cursor: "pointer", fontWeight: "bold", letterSpacing: 1 }}>
                GUARDAR CONFIGURACIÓN
              </button>
            </div>

            {/* Rules accordions */}
            {[
              { k: "cash", l: "Cash NL2", c: C.green },
              { k: "tournament", l: "Torneos", c: C.accent },
              { k: "sports", l: "Deportivas", c: C.gold },
              { k: "casino", l: "Casino — Prohibido", c: C.red },
            ].map((sec) => (
              <div key={sec.k} style={{ marginBottom: 12 }}>
                <button type="button" onClick={(e) => { e.preventDefault(); playSound('click'); setRulesOpen(rulesOpen === sec.k ? null : sec.k); }}
                  style={{ width: "100%", textAlign: "left", padding: "16px 20px", borderRadius: rulesOpen === sec.k ? "12px 12px 0 0" : 12, border: `1px solid ${rulesOpen === sec.k ? sec.c + "55" : C.border}`, background: C.card, color: sec.c, fontSize: 15, fontWeight: "bold", cursor: "pointer", display: "flex", justifyContent: "space-between" }}>
                  {sec.l} <span style={{ color: C.muted }}>{rulesOpen === sec.k ? "▲" : "▼"}</span>
                </button>
                {rulesOpen === sec.k && (
                  <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderTop: "none", borderRadius: "0 0 12px 12px", padding: "12px 20px 20px" }}>
                    {RULES[sec.k].map((r, i) => (
                      <div key={i} style={{ fontSize: 14, color: C.textDim, padding: "10px 0", borderBottom: i < RULES[sec.k].length - 1 ? `1px solid ${C.border}` : "none", lineHeight: 1.5 }}>
                        {sec.k === "casino" ? `❌ ${r}` : <span style={{ color: C.text, fontWeight: "bold", marginRight: 8 }}>{i + 1}.</span>} {sec.k !== "casino" && r}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}

            <div style={{ marginTop: 32, borderTop: `1px solid ${C.border}`, paddingTop: 24 }}>
              {pushStatus !== "Activas" && (
                <button type="button" onClick={requestNotificationPermission}
                  style={{ width: "100%", padding: 16, marginBottom: 12, borderRadius: 12, border: `1px solid ${C.accentMid}`, background: C.accentDim, color: C.accent, fontSize: 14, cursor: "pointer", fontWeight: "bold", letterSpacing: 1 }}>
                  🔔 Activar alertas · {pushStatus}
                </button>
              )}

              <button type="button" onClick={exportCSV}
                style={{ width: "100%", padding: 16, marginBottom: 12, borderRadius: 12, border: `1px solid ${C.border}`, background: C.surface, color: C.text, fontSize: 14, cursor: "pointer", fontWeight: "600" }}>
                📥 Exportar historial CSV
              </button>

              <button type="button" onClick={handleLogout} style={{ width: "100%", padding: 16, marginBottom: 12, borderRadius: 12, background: "transparent", border: `1px solid ${C.muted}`, color: C.textDim, fontSize: 14, cursor: "pointer", fontWeight: "600" }}>
                CERRAR SESIÓN
              </button>

              <button type="button" onClick={archiveAll} style={{ width: "100%", padding: 16, borderRadius: 12, background: "transparent", border: `1px solid ${C.muted}`, color: C.text, fontSize: 13, cursor: "pointer", fontWeight: "bold", marginTop: 24 }}>
                ARCHIVAR SESIONES (Ocultar)
              </button>

              <button type="button" onClick={deleteAllData} style={{ width: "100%", padding: 16, borderRadius: 12, background: C.redD, border: `1px solid ${C.red}`, color: "#fff", fontSize: 13, cursor: "pointer", fontWeight: "bold", marginTop: 12 }}>
                ⚠️ ELIMINAR TODO PERMANENTEMENTE
              </button>
            </div>
          </div>
        )}

      </div>

      {/* ── BOTTOM NAV ─────────────────────────────────────────────────── */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: C.surface, borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "center", zIndex: 10, paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div style={{ display: "flex", width: "100%", maxWidth: 540 }}>
          {[
            { k: "dash",      icon: "◈", l: "Inicio"   },
            { k: "reg",       icon: "+", l: "Sesión"   },
            { k: "analytics", icon: "↗", l: "Stats"    },
            { k: "leaks",     icon: "⚑", l: "Leaks"    },
            { k: "hist",      icon: "≡", l: "Historial"},
            { k: "rules",     icon: "◉", l: "Config"   },
          ].map((t) => (
            <button type="button" key={t.k} onClick={(e) => { e.preventDefault(); playSound('click'); setTab(t.k); }}
              style={{ flex: 1, padding: "16px 4px 12px", border: "none", background: "transparent", cursor: "pointer", color: tab === t.k ? C.accent : C.muted, transition: "color 0.2s" }}>
              <div style={{ fontSize: 18, marginBottom: 4 }}>{t.icon}</div>
              <div style={{ fontSize: 10, fontWeight: "600", textTransform: "uppercase" }}>{t.l}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}