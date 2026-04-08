import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "./supabase";

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
  { id: "sleep", label: "6h+ de sueño" },
  { id: "calm", label: "Me siento calmado" },
  { id: "noAlcohol", label: "Sin alcohol" },
  { id: "notChasing", label: "Sin urgencia de recuperar" },
  { id: "ate", label: "Comí bien" },
];

const POSITIONS = ["UTG", "MP", "HJ", "CO", "BTN", "SB", "BB", "General"];

const INIT_POKER = 50;
const INIT_SPORTS = 500;

const C = {
  bg: "#07070f", surface: "#0d0d1c", card: "#111122",
  border: "#1c1c35", green: "#4ade80", greenD: "#14532d",
  red: "#f87171", redD: "#7f1d1d", blue: "#60a5fa", blueD: "#1e3a5f",
  gold: "#fbbf24", muted: "#44446a", text: "#e0ddf0", textDim: "#7777aa",
};

const fmt = (n, d = 2) => Number(n).toFixed(d);
const sgn = (n) => (n >= 0 ? "+" : "");

export default function App() {
  const [tab, setTab] = useState("dash");
  const [sessions, setSessions] = useState([]);
  const [poker, setPoker] = useState(INIT_POKER);
  const [sports, setSports] = useState(INIT_SPORTS);
  const [habits, setHabits] = useState({ meditar: false, agua: false, omega: false, ejercicio: false });
  const [tilt, setTilt] = useState({});
  
  const [form, setForm] = useState({ type: "cash", result: "win", amount: "", note: "" });
  const [leakForm, setLeakForm] = useState({ position: "BTN", note: "" });
  
  const [rulesOpen, setRulesOpen] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [flash, setFlash] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [pushStatus, setPushStatus] = useState("Checking...");

  const active = sessions.filter(x => !x.archived);
  const todayStr = new Date().toLocaleDateString("es-MX", { day: "2-digit", month: "short" });

  // --- MOTOR DE NOTIFICACIONES ---
  const sendAlert = async (title, body) => {
    if ('serviceWorker' in navigator && Notification.permission === 'granted') {
      try {
        const reg = await navigator.serviceWorker.ready;
        reg.showNotification(title, {
          body: body,
          icon: '/icon.png',
          vibrate: [200, 100, 200]
        });
      } catch (e) {
        console.log("Error mostrando notificación iOS:", e);
      }
    }
  };

  const requestNotificationPermission = async () => {
    if (!('Notification' in window)) {
      alert("Tu navegador no soporta notificaciones.");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      setPushStatus("Activas");
      sendAlert("♠️ Diego's Edge", "Notificaciones configuradas a nivel sistema. Listo para grindear.");
    } else {
      setPushStatus("Denegado");
      alert("Permiso denegado por iOS.");
    }
  };

  // --- SISTEMA DE ALERTAS BASADAS EN TIEMPO ---
  useEffect(() => {
    if (!loaded) return;

    const checkTimeAlerts = () => {
      const now = new Date();
      const hours = now.getHours();
      const minutes = now.getMinutes();
      const today = now.toLocaleDateString("es-MX");

      // Objeto para llevar el registro de las notificaciones enviadas hoy
      let notifiedToday = {};
      try {
        notifiedToday = JSON.parse(localStorage.getItem(`bk_alerts_${today}`)) || {};
      } catch (e) {}

      // 10:00 AM - Check-in Matutino
      if (hours === 10 && minutes === 0 && !notifiedToday.morning) {
        sendAlert("🌅 ¡Buenos días!", "No olvides tu Omega-3 y tu primer litro de agua antes de la primera sesión.");
        notifiedToday.morning = true;
      }

      // 2:00 PM - Revisión de Estado Mental
      if (hours === 14 && minutes === 0 && !notifiedToday.afternoon) {
        sendAlert("🧠 Check-in", "¿Cómo va el tilt hoy? Si vas a jugar, asegúrate de estar calmado.");
        notifiedToday.afternoon = true;
      }

      // 8:00 PM - Recordatorio de Estudio
      if (hours === 20 && minutes === 0 && !notifiedToday.evening) {
        sendAlert("📖 Hora de estudio", "Revisa tus Spots y Leaks antes de cerrar el día.");
        notifiedToday.evening = true;
      }

      // 10:00 PM - Resumen del Día
      if (hours === 22 && minutes === 48 && !notifiedToday.night) {
        const todaySessions = active.filter(s => s.date === todayStr && s.type !== "leak");
        if (todaySessions.length > 0) {
            let pokerTotal = 0;
            let sportsTotal = 0;
            todaySessions.forEach(s => {
                if (s.type === 'sports') sportsTotal += s.amount;
                else pokerTotal += s.amount;
            });
            sendAlert("📊 Resumen del Día", `Poker: ${sgn(pokerTotal)}${fmt(pokerTotal)} USD | Deportivas: ${sgn(sportsTotal)}${fmt(sportsTotal, 0)} MXN. ¡A descansar!`);
        }
        notifiedToday.night = true;
      }

      localStorage.setItem(`bk_alerts_${today}`, JSON.stringify(notifiedToday));
    };

    // Checa la hora cada minuto
    const intervalId = setInterval(checkTimeAlerts, 60000);
    // Ejecuta una vez al inicio por si acaba de dar la hora
    checkTimeAlerts();

    return () => clearInterval(intervalId);
  }, [loaded, active, todayStr]);

  // --- NUBE: CARGAR DATOS Y RESET DIARIO ---
  const load = useCallback(async () => {
    try {
      if ('Notification' in window) {
        setPushStatus(Notification.permission === 'granted' ? 'Activas' : 'Permiso Denegado');
      }

      const today = new Date().toLocaleDateString("es-MX");
      const lastDate = localStorage.getItem("bk_last_date");
      
      if (lastDate && lastDate !== today) {
        await supabase.from('daily_habits').delete().neq('id', 'dummy');
      }
      localStorage.setItem("bk_last_date", today);

      const { data: sData } = await supabase.from('sessions').select('*').order('id', { ascending: false });
      const { data: hData } = await supabase.from('daily_habits').select('*');

      if (sData) {
        setSessions(sData);
        const activeData = sData.filter(x => !x.archived);
        const pokerSessionsData = activeData.filter(x => x.type !== "sports" && x.type !== "leak");
        const sportsSessionsData = activeData.filter(x => x.type === "sports");
        
        setPoker(pokerSessionsData.reduce((a, x) => a + x.amount, INIT_POKER));
        setSports(sportsSessionsData.reduce((a, x) => a + x.amount, INIT_SPORTS));
      }

      if (hData) {
        const loadedHabits = { meditar: false, agua: false, omega: false, ejercicio: false };
        const loadedTilt = {};
        hData.forEach(item => {
          if (item.id.startsWith('tilt_')) {
            loadedTilt[item.id.replace('tilt_', '')] = item.status;
          } else {
            loadedHabits[item.id] = item.status;
          }
        });
        setHabits(loadedHabits);
        setTilt(loadedTilt);
      }
    } catch (error) {
      console.error("Error cargando desde Supabase:", error);
    }
    setLoaded(true);
  }, []);

  useEffect(() => { load(); }, [load]);

  // --- NUBE: GUARDAR SESIÓN NORMAL ---
  const addSession = async () => {
    const amt = parseFloat(form.amount);
    if (!amt || amt <= 0) return;
    const value = form.result === "win" ? amt : -amt;
    
    const s = {
      id: Date.now(), 
      type: form.type, 
      amount: value, 
      note: form.note,
      date: new Date().toLocaleDateString("es-MX", { day: "2-digit", month: "short" }),
      archived: false,
    };

    const { error } = await supabase.from('sessions').insert([s]);

    if (!error) {
      setSessions([s, ...sessions]);
      if (form.type === "sports") setSports(p => parseFloat((p + value).toFixed(2)));
      else setPoker(p => parseFloat((p + value).toFixed(2)));
      
      setForm({ ...form, amount: "", note: "" });
      setFlash(value > 0 ? "win" : "loss");
      setTimeout(() => setFlash(null), 1000);
      setTab("dash");

      // ALGORITMO DE ALERTAS INTELIGENTES (TILT Y RECOMPENSA)
      if (form.type === "cash") {
        if (value <= -6) {
          sendAlert("⚠️ STOP LOSS ALCANZADO", "Has perdido 3 buy-ins. Cierra la mesa inmediatamente y respira.");
        } else if (value >= 10) {
          sendAlert("🏆 Buena Sesión", "Excelente win rate. Protege las ganancias y no forces la jugada.");
        }
      }
    } else {
      alert("Error al guardar en la nube.");
    }
  };

  // --- NUBE: GUARDAR LEAK ---
  const addLeak = async () => {
    if (!leakForm.note.trim()) return;
    
    const s = {
      id: Date.now(),
      type: "leak",
      amount: 0,
      note: leakForm.note,
      buyin: leakForm.position,
      date: new Date().toLocaleDateString("es-MX", { day: "2-digit", month: "short" }),
      archived: false,
    };

    const { error } = await supabase.from('sessions').insert([s]);

    if (!error) {
      setSessions([s, ...sessions]);
      setLeakForm({ ...leakForm, note: "" });
      setFlash("win");
      setTimeout(() => setFlash(null), 1000);
    } else {
      alert("Error al guardar el leak.");
    }
  };

  // --- NUBE: TOGGLE HÁBITOS ---
  const toggleHabit = async (k) => {
    const nextVal = !habits[k];
    setHabits({ ...habits, [k]: nextVal });
    await supabase.from('daily_habits').upsert({ id: k, status: nextVal });
  };

  // --- NUBE: TOGGLE TILT ---
  const toggleTilt = async (k) => {
    const nextVal = !tilt[k];
    setTilt({ ...tilt, [k]: nextVal });
    await supabase.from('daily_habits').upsert({ id: `tilt_${k}`, status: nextVal });
  };

  const tiltScore = TILT_QS.filter(q => tilt[q.id]).length;
  const tiltColor = tiltScore >= 4 ? C.green : tiltScore >= 2 ? C.gold : C.red;
  const tiltLabel = tiltScore >= 4 ? "✓ Óptimo" : tiltScore >= 2 ? "⚠ Cuidado" : "✗ No juegues";

  const archived = sessions.filter(x => x.archived);
  
  const pokerSessions = active.filter(x => x.type !== "sports" && x.type !== "leak");
  const sportsSessions = active.filter(x => x.type === "sports");
  const leakSessions = active.filter(x => x.type === "leak");
  
  const pokerWins = pokerSessions.filter(x => x.amount > 0).length;
  const pokerProfit = parseFloat((poker - INIT_POKER).toFixed(2));
  const sportsProfit = parseFloat((sports - INIT_SPORTS).toFixed(2));

  // --- GRÁFICA POKER ---
  const sparkPoints = (() => {
    const pts = [INIT_POKER];
    let cur = INIT_POKER;
    [...pokerSessions].reverse().forEach(s => { cur = parseFloat((cur + s.amount).toFixed(2)); pts.push(cur); });
    if (pts.length < 2) return null;
    const W = 120, H = 32;
    const mn = Math.min(...pts) - 1, mx = Math.max(...pts) + 1;
    const range = mx - mn || 1;
    return pts.map((v, i) => `${(i / (pts.length - 1)) * W},${H - ((v - mn) / range) * H}`).join(" ");
  })();

  // --- GRÁFICA DEPORTIVAS ---
  const sparkSports = (() => {
    const pts = [INIT_SPORTS];
    let cur = INIT_SPORTS;
    [...sportsSessions].reverse().forEach(s => { cur = parseFloat((cur + s.amount).toFixed(2)); pts.push(cur); });
    if (pts.length < 2) return null;
    const W = 120, H = 32;
    const mn = Math.min(...pts) - 1, mx = Math.max(...pts) + 1;
    const range = mx - mn || 1;
    return pts.map((v, i) => `${(i / (pts.length - 1)) * W},${H - ((v - mn) / range) * H}`).join(" ");
  })();

  const streak = (() => {
    let s = 0;
    for (const x of pokerSessions) { if (x.amount > 0) s++; else break; }
    return s;
  })();

  const danger = poker < 30;
  const warning = poker < 40 && poker >= 30;

  const pill = (on, color) => ({
    padding: "7px 13px", borderRadius: 20,
    border: `1px solid ${on ? color : C.border}`,
    background: on ? color + "20" : "transparent",
    color: on ? color : C.muted,
    fontSize: 11, cursor: "pointer", fontFamily: "Georgia, serif",
  });

  const typeBtn = (v) => ({
    flex: 1, padding: "9px 4px", borderRadius: 8, border: "none", cursor: "pointer",
    background: form.type === v ? C.blueD : C.surface,
    color: form.type === v ? C.blue : C.muted,
    fontFamily: "Georgia, serif", fontSize: 11,
  });

  const resBtn = (v) => ({
    flex: 1, padding: 12, borderRadius: 8, border: "none", cursor: "pointer",
    background: form.result === v ? (v === "win" ? C.greenD : C.redD) : C.surface,
    color: form.result === v ? (v === "win" ? C.green : C.red) : C.muted,
    fontFamily: "Georgia, serif", fontSize: 13,
  });

  if (!loaded) return (
    <div style={{ background: C.bg, height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, fontFamily: "monospace", letterSpacing: 3, fontSize: 11 }}>
      CONECTANDO A SUPABASE...
    </div>
  );

  return (
    <div style={{ fontFamily: "'Georgia', serif", background: C.bg, minHeight: "100vh", color: C.text, paddingBottom: 80 }}>
      {flash && (
        <div style={{ position: "fixed", inset: 0, background: flash === "win" ? "rgba(74,222,128,0.07)" : "rgba(248,113,113,0.07)", pointerEvents: "none", zIndex: 999 }} />
      )}

      {/* Header */}
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "18px 20px 12px" }}>
        <div style={{ fontSize: 10, letterSpacing: 4, color: C.muted, textTransform: "uppercase", marginBottom: 2 }}>Sistema de Gestión</div>
        <div style={{ fontSize: 22, fontWeight: "bold", color: C.text }}>Diego's Edge ♠</div>
      </div>

      {(danger || warning) && (
        <div style={{ background: danger ? "#120406" : "#121004", borderLeft: `3px solid ${danger ? C.red : C.gold}`, padding: "9px 20px", fontSize: 12, color: danger ? C.red : C.gold }}>
          {danger ? "⛔ Bankroll crítico — Pausa esta semana" : "⚠️ Bankroll bajo — Máximo 1 buyin por sesión"}
        </div>
      )}

      <div style={{ padding: "16px", maxWidth: 480, margin: "0 auto" }}>

        {/* ── DASHBOARD ── */}
        {tab === "dash" && <>

          {/* Bankroll cards */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
            <div style={{ background: C.card, border: `1px solid ${pokerProfit >= 0 ? C.greenD : C.redD}`, borderRadius: 14, padding: 14 }}>
              <div style={{ fontSize: 9, letterSpacing: 3, color: C.muted, textTransform: "uppercase", marginBottom: 6 }}>Poker USD</div>
              <div style={{ fontSize: 26, fontWeight: "bold", color: pokerProfit >= 0 ? C.green : C.red }}>${fmt(poker)}</div>
              <div style={{ fontSize: 11, color: pokerProfit >= 0 ? C.green : C.red, marginTop: 3 }}>
                {sgn(pokerProfit)}{fmt(pokerProfit)} · {sgn(pokerProfit)}{fmt(((pokerProfit / INIT_POKER) * 100), 1)}%
              </div>
              {sparkPoints && (
                <svg viewBox="0 0 120 32" style={{ width: "100%", height: 24, marginTop: 8, display: "block" }}>
                  <polyline fill="none" stroke={pokerProfit >= 0 ? C.green : C.red} strokeWidth="1.5" strokeLinejoin="round" points={sparkPoints} />
                </svg>
              )}
            </div>

            <div style={{ background: C.card, border: `1px solid ${sportsProfit >= 0 ? C.blueD : C.redD}`, borderRadius: 14, padding: 14 }}>
              <div style={{ fontSize: 9, letterSpacing: 3, color: C.muted, textTransform: "uppercase", marginBottom: 6 }}>Deportivas MXN</div>
              <div style={{ fontSize: 26, fontWeight: "bold", color: sportsProfit >= 0 ? C.blue : C.red }}>${fmt(sports, 0)}</div>
              <div style={{ fontSize: 11, color: sportsProfit >= 0 ? C.blue : C.red, marginTop: 3 }}>
                {sgn(sportsProfit)}{fmt(sportsProfit, 0)} · {sgn(sportsProfit)}{fmt(((sportsProfit / INIT_SPORTS) * 100), 1)}%
              </div>
              {sparkSports && (
                <svg viewBox="0 0 120 32" style={{ width: "100%", height: 24, marginTop: 8, display: "block" }}>
                  <polyline fill="none" stroke={sportsProfit >= 0 ? C.blue : C.red} strokeWidth="1.5" strokeLinejoin="round" points={sparkSports} />
                </svg>
              )}
            </div>
          </div>

          {/* Stats */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14, marginBottom: 12, display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 4 }}>
            {[
              { v: pokerSessions.length, l: "Sesiones" },
              { v: pokerWins, l: "Ganadas" },
              { v: pokerSessions.length ? `${((pokerWins / pokerSessions.length) * 100).toFixed(0)}%` : "—", l: "Win rate" },
              { v: streak > 0 ? `${streak}🔥` : "—", l: "Racha" },
            ].map(s => (
              <div key={s.l} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: "bold", color: C.text }}>{s.v}</div>
                <div style={{ fontSize: 9, color: C.muted, marginTop: 2, letterSpacing: 1, textTransform: "uppercase" }}>{s.l}</div>
              </div>
            ))}
          </div>

          {/* Tilt + Habits */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14, marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 9, letterSpacing: 3, color: C.muted, textTransform: "uppercase" }}>Hábitos de Hoy</div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
              {[{ k: "meditar", l: "Meditaste" }, { k: "agua", l: "Agua" }, { k: "omega", l: "Omega-3" }, { k: "ejercicio", l: "Ejercicio" }].map(h => (
                <button key={h.k} onClick={() => toggleHabit(h.k)} style={pill(habits[h.k], C.blue)}>
                  {habits[h.k] ? "✓ " : ""}{h.l}
                </button>
              ))}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
              <div style={{ fontSize: 9, letterSpacing: 3, color: C.muted, textTransform: "uppercase" }}>Estado Mental</div>
              <div style={{ fontSize: 11, color: tiltColor, fontWeight: "bold" }}>{tiltLabel}</div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {TILT_QS.map(q => (
                <button key={q.id} onClick={() => toggleTilt(q.id)} style={pill(tilt[q.id], tiltColor)}>
                  {tilt[q.id] ? "✓ " : ""}{q.label}
                </button>
              ))}
            </div>
          </div>

          {/* Poker ladder */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14, marginBottom: 12 }}>
            <div style={{ fontSize: 9, letterSpacing: 3, color: C.muted, textTransform: "uppercase", marginBottom: 10 }}>Escalera Poker</div>
            <div style={{ display: "flex", gap: 8 }}>
              {POKER_LADDER.map(r => {
                const done = poker >= r.at;
                return (
                  <div key={r.at} style={{ flex: 1, textAlign: "center", padding: "10px 4px", borderRadius: 10, border: `1px solid ${done ? C.green : C.border}`, background: done ? C.greenD + "55" : "transparent" }}>
                    <div style={{ fontSize: 13, fontWeight: "bold", color: done ? C.green : C.muted }}>{r.label}</div>
                    <div style={{ fontSize: 10, color: done ? C.green : C.muted, marginTop: 2 }}>${r.at}</div>
                    {done && <div style={{ fontSize: 12, marginTop: 4 }}>✓</div>}
                    {!done && <div style={{ fontSize: 9, color: C.muted, marginTop: 4 }}>Faltan ${fmt(r.at - poker)}</div>}
                  </div>
                );
              })}
            </div>
          </div>

        </>}

        {/* ── REGISTRAR ── */}
        {tab === "reg" && (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16 }}>
            <div style={{ fontSize: 9, letterSpacing: 3, color: C.muted, textTransform: "uppercase", marginBottom: 14 }}>Nueva Sesión</div>

            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              {[["cash", "Cash NL2"], ["tournament", "Torneo"], ["sports", "Deportiva"]].map(([v, l]) => (
                <button key={v} onClick={() => setForm({ ...form, type: v })} style={typeBtn(v)}>{l}</button>
              ))}
            </div>

            <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
              <button onClick={() => setForm({ ...form, result: "win" })} style={resBtn("win")}>▲ Ganancia</button>
              <button onClick={() => setForm({ ...form, result: "loss" })} style={resBtn("loss")}>▼ Pérdida</button>
            </div>

            <input type="number" min="0" step="0.01"
              placeholder={form.type === "sports" ? "Monto en MXN" : "Monto en USD"}
              value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })}
              style={{ width: "100%", padding: "13px 14px", borderRadius: 9, border: `1px solid ${C.border}`, background: C.surface, color: C.text, fontSize: 15, fontFamily: "Georgia, serif", boxSizing: "border-box", marginBottom: 10, outline: "none" }}
            />
            <input type="text" placeholder="Nota opcional — ej: 'AA vs KK'"
              value={form.note} onChange={e => setForm({ ...form, note: e.target.value })}
              style={{ width: "100%", padding: "13px 14px", borderRadius: 9, border: `1px solid ${C.border}`, background: C.surface, color: C.text, fontSize: 13, fontFamily: "Georgia, serif", boxSizing: "border-box", marginBottom: 14, outline: "none" }}
            />

            <button onClick={addSession} style={{ width: "100%", padding: 15, borderRadius: 10, border: "none", cursor: "pointer", background: form.result === "win" ? C.greenD : C.redD, color: form.result === "win" ? C.green : C.red, fontSize: 14, fontFamily: "Georgia, serif", fontWeight: "bold", letterSpacing: 1 }}>
              REGISTRAR
            </button>
          </div>
        )}

        {/* ── SPOTS & LEAKS ── */}
        {tab === "leaks" && (
          <div>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16, marginBottom: 14 }}>
              <div style={{ fontSize: 9, letterSpacing: 3, color: C.gold, textTransform: "uppercase", marginBottom: 14 }}>Registrar Error / Leak</div>
              
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>Posición en la mesa:</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                {POSITIONS.map(p => (
                  <button key={p} onClick={() => setLeakForm({ ...leakForm, position: p })} 
                    style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${leakForm.position === p ? C.gold : C.border}`, background: leakForm.position === p ? C.gold + "22" : C.surface, color: leakForm.position === p ? C.gold : C.muted, fontSize: 12, cursor: "pointer", fontFamily: "Georgia, serif" }}>
                    {p}
                  </button>
                ))}
              </div>

              <textarea 
                placeholder="Describe el error... ej: Pagué un 3bet fuera de posición con AJo y me dominaron."
                value={leakForm.note} onChange={e => setLeakForm({ ...leakForm, note: e.target.value })}
                style={{ width: "100%", padding: "13px 14px", borderRadius: 9, border: `1px solid ${C.border}`, background: C.surface, color: C.text, fontSize: 13, fontFamily: "Georgia, serif", boxSizing: "border-box", marginBottom: 14, outline: "none", minHeight: "80px", resize: "none" }}
              />

              <button onClick={addLeak} style={{ width: "100%", padding: 15, borderRadius: 10, border: "none", cursor: "pointer", background: C.gold + "33", color: C.gold, fontSize: 14, fontFamily: "Georgia, serif", fontWeight: "bold", letterSpacing: 1 }}>
                GUARDAR LEAK
              </button>
            </div>

            <div style={{ background: C.surface, borderRadius: 14, padding: "0 10px" }}>
              <div style={{ fontSize: 9, letterSpacing: 3, color: C.muted, textTransform: "uppercase", padding: "14px 6px" }}>Áreas de Mejora ({leakSessions.length})</div>
              {leakSessions.map(s => (
                <div key={s.id} style={{ display: "flex", gap: 12, padding: "12px 6px", borderBottom: `1px solid ${C.border}` }}>
                  <div style={{ background: C.card, border: `1px solid ${C.border}`, color: C.gold, padding: "4px 8px", borderRadius: 6, fontSize: 10, fontWeight: "bold", height: "fit-content" }}>
                    {s.buyin || "GNRL"}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, color: C.text, lineHeight: 1.4 }}>{s.note}</div>
                    <div style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>{s.date}</div>
                  </div>
                </div>
              ))}
              {leakSessions.length === 0 && <div style={{ textAlign: "center", color: C.muted, padding: "20px 0", fontSize: 12 }}>Sin leaks registrados. ¡Excelente!</div>}
            </div>
          </div>
        )}

        {/* ── HISTORIAL ── */}
        {tab === "hist" && (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontSize: 9, letterSpacing: 3, color: C.muted, textTransform: "uppercase" }}>{showArchived ? "Archivadas" : "Historial"}</div>
              <button onClick={() => setShowArchived(!showArchived)} style={{ fontSize: 10, background: "none", border: `1px solid ${C.border}`, color: C.muted, padding: "3px 10px", borderRadius: 6, cursor: "pointer" }}>
                {showArchived ? "Ver activas" : "Archivadas"}
              </button>
            </div>

            {(showArchived ? archived : active).filter(x => x.type !== "leak").length === 0 && (
              <div style={{ textAlign: "center", color: C.muted, padding: "30px 0", fontSize: 13 }}>Sin sesiones</div>
            )}

            {(showArchived ? archived : active).filter(x => x.type !== "leak").map(s => (
              <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 0", borderBottom: `1px solid ${C.border}` }}>
                <div>
                  <div style={{ fontSize: 12, color: C.text }}>
                    <span style={{ color: s.type === "sports" ? C.blue : C.green, fontSize: 9, letterSpacing: 2, textTransform: "uppercase" }}>{s.type}</span>
                    {s.note ? <span style={{ color: C.textDim }}> · {s.note}</span> : ""}
                  </div>
                  <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{s.date}</div>
                </div>
                <div style={{ fontSize: 16, fontWeight: "bold", color: s.amount > 0 ? C.green : C.red }}>
                  {s.amount > 0 ? "+" : ""}{fmt(s.amount)} {s.type === "sports" ? "MXN" : "USD"}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── REGLAS ── */}
        {tab === "rules" && (
          <div>
            {[
              { k: "cash", l: "Cash NL2", c: C.green },
              { k: "tournament", l: "Torneos", c: C.blue },
              { k: "sports", l: "Deportivas", c: C.gold },
              { k: "casino", l: "Casino — Prohibido", c: C.red },
            ].map(sec => (
              <div key={sec.k} style={{ marginBottom: 10 }}>
                <button onClick={() => setRulesOpen(rulesOpen === sec.k ? null : sec.k)}
                  style={{ width: "100%", textAlign: "left", padding: "13px 16px", borderRadius: 12, border: `1px solid ${rulesOpen === sec.k ? sec.c + "66" : C.border}`, background: C.card, color: sec.c, fontFamily: "Georgia, serif", fontSize: 13, cursor: "pointer", display: "flex", justifyContent: "space-between" }}>
                  {sec.l} <span style={{ color: C.muted }}>{rulesOpen === sec.k ? "▲" : "▼"}</span>
                </button>
                {rulesOpen === sec.k && (
                  <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderTop: "none", borderRadius: "0 0 12px 12px", padding: "8px 16px" }}>
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
              
              {/* BOTÓN DE PERMISOS MOVIDO AQUÍ */}
              {pushStatus !== "Activas" && (
                <button onClick={requestNotificationPermission} 
                  style={{ width: "100%", padding: "12px", marginBottom: "16px", borderRadius: 10, border: `1px solid ${C.blue}`, background: C.blueD + "33", color: C.blue, fontSize: "11px", cursor: "pointer", fontFamily: "Georgia", textTransform: "uppercase", fontWeight: "bold", letterSpacing: 1 }}>
                  🔔 Activar Alertas Nativas (Estado: {pushStatus})
                </button>
              )}

              <button onClick={async () => {
                if (!confirm("¿Archivar todos los datos en la nube y empezar desde cero?")) return;
                
                const activeIds = sessions.filter(s => !s.archived).map(s => s.id);
                if(activeIds.length > 0) {
                  await supabase.from('sessions').update({ archived: true }).in('id', activeIds);
                }
                await supabase.from('daily_habits').delete().neq('id', 'dummy');

                const next = sessions.map(s => ({ ...s, archived: true }));
                setSessions(next);
                setPoker(INIT_POKER);
                setSports(INIT_SPORTS);
                setHabits({ meditar: false, agua: false, omega: false, ejercicio: false });
                setTilt({});
                setTab("dash");
              }} style={{ width: "100%", padding: 12, borderRadius: 10, background: "transparent", border: `1px solid ${C.redD}`, color: "#aa3333", fontSize: 10, cursor: "pointer", fontFamily: "Georgia", letterSpacing: 2 }}>
                ARCHIVAR Y RESETEAR EN LA NUBE
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bottom nav */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: C.surface, borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "center", zIndex: 10 }}>
        <div style={{ display: "flex", width: "100%", maxWidth: 480 }}>
          {[
            { k: "dash", icon: "◈", l: "Inicio" },
            { k: "reg", icon: "+", l: "Sesión" },
            { k: "leaks", icon: "⚑", l: "Leaks" },
            { k: "hist", icon: "≡", l: "Historial" },
            { k: "rules", icon: "◉", l: "Reglas" },
          ].map(t => (
            <button key={t.k} onClick={() => setTab(t.k)} style={{ flex: 1, padding: "13px 4px 9px", border: "none", background: "transparent", cursor: "pointer", color: tab === t.k ? C.blue : C.muted, fontFamily: "Georgia, serif" }}>
              <div style={{ fontSize: 15 }}>{t.icon}</div>
              <div style={{ fontSize: 7, letterSpacing: 1, marginTop: 3, textTransform: "uppercase" }}>{t.l}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}