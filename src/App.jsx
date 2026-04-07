import { useState, useEffect } from "react";
import { supabase } from "./supabase";

const RULES = {
  cash: [
    "Stop-loss por sesión: máximo 3 buyins ($6 USD)",
    "Si el bankroll baja a $30, paras la semana",
    "Si el bankroll baja a $25, dejas de jugar hasta recargar",
    "Máximo 2 horas por sesión en un solo bloque",
    "No jugar con menos de 6 horas de sueño",
    "Stop-loss emocional: si sientes tilt, cierras inmediatamente",
  ],
  tournament: [
    "Máximo 5% del bankroll por torneo ($2.50 con bankroll de $50)",
    "Máximo 3 torneos al día",
    "No re-entry si ya perdiste 2 torneos en el día",
    "Registra resultado de cada torneo antes de abrir otro",
    "Si pierdes 5 torneos seguidos, pausa 24h",
  ],
  sports: [
    "Máximo 5% del bankroll por apuesta ($25 MXN)",
    "Solo mercados donde tengas criterio real",
    "No apuestas en vivo si llevas sesión perdedora",
    "Máximo 2 apuestas activas simultáneas",
    "No apostar para recuperar pérdidas del día",
  ],
  casino: [
    "❌ BLACKJACK — PROHIBIDO",
    "❌ BACCARAT — PROHIBIDO",
    "❌ RULETA — PROHIBIDO",
    "❌ SLOTS — PROHIBIDO",
    "Regla absoluta. Sin excepciones. Sin ‘solo una sesión’.",
  ],
};

const UPGRADE_RULES = [
  { bankroll: 100, action: "Puedes subir a NL5 ($0.02/$0.05)" },
  { bankroll: 250, action: "Puedes subir a NL10" },
  { bankroll: 75, action: "Puedes jugar torneos hasta $5 buyin" },
];

const INITIAL = {
  poker: 50,
  sports: 500,
};

export default function BankrollManager() {
  const [tab, setTab] = useState("dashboard");
  const [poker, setPoker] = useState(INITIAL.poker);
  const [sports, setSports] = useState(INITIAL.sports);
  const [sessions, setSessions] = useState([]);
  const [archivedSessions, setArchivedSessions] = useState([]);
  const [showArchived, setShowArchived] = useState(false);
  const [habits, setHabits] = useState({ meditar: false, agua: false, omega: false });
  const [loading, setLoading] = useState(true);
  
  const [form, setForm] = useState({
    type: "cash",
    amount: "",
    result: "win",
    note: "",
    buyin: "2",
  });
  const [showRules, setShowRules] = useState(null);

  // --- NUBE: CARGAR DATOS AL INICIAR ---
  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('sessions')
      .select('*')
      .order('id', { ascending: false });
    
    if (data) {
      // Separar activas de archivadas
      const active = data.filter(s => !s.archived);
      const archived = data.filter(s => s.archived);
      
      setSessions(active);
      setArchivedSessions(archived);
      
      // Recalcular bankrolls SOLO basados en el historial activo
      const pk = active.filter(s => s.type !== 'sports').reduce((acc, s) => acc + s.amount, INITIAL.poker);
      const sp = active.filter(s => s.type === 'sports').reduce((acc, s) => acc + s.amount, INITIAL.sports);
      setPoker(pk);
      setSports(sp);
    }
    setLoading(false);
  };

  // --- NUBE: GUARDAR SESIÓN ---
  const addSession = async () => {
    const amt = parseFloat(form.amount);
    if (!amt) return;
    const value = form.result === "win" ? amt : -amt;
    
    const newSession = {
      id: Date.now(),
      type: form.type,
      amount: value,
      note: form.note,
      buyin: form.buyin,
      date: new Date().toLocaleDateString("es-MX", { day: "2-digit", month: "short" }),
      archived: false // Por defecto, es una sesión activa
    };

    const { error } = await supabase.from('sessions').insert([newSession]);

    if (!error) {
      setSessions([newSession, ...sessions]);
      if (form.type === "sports") setSports((s) => +(s + value).toFixed(2));
      else setPoker((p) => +(p + value).toFixed(2));
      setForm({ ...form, amount: "", note: "" });
      setTab("dashboard");
    } else {
      alert("Error al sincronizar con la nube.");
    }
  };

  // --- FUNCIÓN: ARCHIVAR DATOS (SOFT DELETE) ---
  const archiveSystem = async () => {
    const confirmReset = window.confirm("⚠️ ¿Archivar todos los datos? Empezarás tu bankroll desde cero, pero podrás ver el historial en la papelera.");
    
    if (confirmReset) {
      // Tomamos los IDs de las sesiones activas
      const idsToArchive = sessions.map(s => s.id);
      if (idsToArchive.length === 0) return;

      // Actualizamos esas sesiones en la nube para que archived = true
      const { error } = await supabase.from('sessions').update({ archived: true }).in('id', idsToArchive);
      
      if (!error) {
        // Recargamos los datos desde la nube para actualizar las listas
        fetchData();
        setHabits({ meditar: false, agua: false, omega: false });
        alert("Datos archivados con éxito.");
        setTab("dashboard");
      } else {
        alert("Error al archivar: " + error.message);
      }
    }
  };

  const toggleHabit = (h) => setHabits({ ...habits, [h]: !habits[h] });

  const getGraphData = () => {
    let current = INITIAL.poker;
    const points = [INITIAL.poker, ...[...sessions].filter(s => s.type !== 'sports').reverse().map(s => current += s.amount)];
    if (points.length < 2) return null;
    const max = Math.max(...points, INITIAL.poker + 10);
    const min = Math.min(...points, INITIAL.poker - 10);
    return points.map((p, i) => `${(i / (points.length - 1)) * 100},${100 - ((p - min) / (max - min)) * 100}`).join(" ");
  };

  const pokerROI = (((poker - INITIAL.poker) / INITIAL.poker) * 100).toFixed(1);
  const sportsROI = (((sports - INITIAL.sports) / INITIAL.sports) * 100).toFixed(1);

  const pokerTotal = sessions.filter((s) => s.type !== "sports").length;
  const pokerWins = sessions.filter((s) => s.type !== "sports" && s.amount > 0).length;

  const danger = poker < 30;
  const warning = poker < 40 && poker >= 30;

  if (loading) return <div style={{ background: "#0a0a0f", height: "100vh", color: "#4a4a6a", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Georgia" }}>Sincronizando con la nube...</div>;

  return (
    <div style={{ fontFamily: "'Georgia', serif", background: "#0a0a0f", minHeight: "100vh", color: "#e8e0d0", maxWidth: 480, margin: "0 auto", padding: "0 0 80px" }}>
      {/* Header (Nuevos Títulos) */}
      <div style={{ background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)", padding: "24px 20px 16px", borderBottom: "1px solid #2a2a4a" }}>
        <div style={{ fontSize: 11, letterSpacing: 4, color: "#7a7a9a", textTransform: "uppercase", marginBottom: 4 }}>Gestión</div>
        <div style={{ fontSize: 28, fontWeight: "bold", color: "#e8e0d0", letterSpacing: -0.5 }}>Diego's Bankroll</div>
      </div>

      {/* Status bar */}
      {danger && (
        <div style={{ background: "#3a0a0a", borderLeft: "3px solid #cc3333", padding: "10px 20px", fontSize: 13, color: "#ff6666" }}>
          ⚠️ Bankroll crítico — Pausa esta semana. No más sesiones.
        </div>
      )}
      {warning && !danger && (
        <div style={{ background: "#2a1a0a", borderLeft: "3px solid #cc7733", padding: "10px 20px", fontSize: 13, color: "#ffaa66" }}>
          ⚠️ Bankroll bajo — Reduce a 1 buyin por sesión.
        </div>
      )}

      {/* Content */}
      <div style={{ padding: "20px" }}>

        {tab === "dashboard" && (
          <div>
            {/* Cards */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
              <div style={{ background: "linear-gradient(135deg, #1e2a1e, #162316)", border: "1px solid #2a4a2a", borderRadius: 12, padding: 16 }}>
                <div style={{ fontSize: 10, letterSpacing: 3, color: "#4a8a4a", textTransform: "uppercase", marginBottom: 8 }}>Poker (USD)</div>
                <div style={{ fontSize: 28, fontWeight: "bold", color: poker >= INITIAL.poker ? "#6adb6a" : "#db6a6a" }}>${poker.toFixed(2)}</div>
                
                {getGraphData() && (
                  <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: "100%", height: "30px", marginTop: "10px" }}>
                    <polyline fill="none" stroke="#6adb6a" strokeWidth="3" points={getGraphData()} />
                  </svg>
                )}
                
                <div style={{ fontSize: 12, color: parseFloat(pokerROI) >= 0 ? "#6adb6a" : "#db6a6a", marginTop: 8 }}>
                  {parseFloat(pokerROI) >= 0 ? "▲" : "▼"} {Math.abs(pokerROI)}% ROI
                </div>
              </div>

              <div style={{ background: "linear-gradient(135deg, #1e1e2a, #161623", border: "1px solid #2a2a5a", borderRadius: 12, padding: 16 }}>
                <div style={{ fontSize: 10, letterSpacing: 3, color: "#4a4aaa", textTransform: "uppercase", marginBottom: 8 }}>Deportivas (MXN)</div>
                <div style={{ fontSize: 28, fontWeight: "bold", color: sports >= INITIAL.sports ? "#6a8adb" : "#db6a6a" }}>${sports.toFixed(0)}</div>
                <div style={{ fontSize: 12, color: parseFloat(sportsROI) >= 0 ? "#6a8adb" : "#db6a6a", marginTop: 8 }}>
                  {parseFloat(sportsROI) >= 0 ? "▲" : "▼"} {Math.abs(sportsROI)}% ROI
                </div>
              </div>
            </div>

            {/* HÁBITOS */}
            <div style={{ background: "#111120", border: "1px solid #2a2a3a", borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 10, letterSpacing: 3, color: "#7a7a9a", textTransform: "uppercase", marginBottom: 12 }}>Check-in de Rendimiento</div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                {[
                  { id: 'meditar', label: '🧘 Meditar' },
                  { id: 'agua', label: '💧 Agua' },
                  { id: 'omega', label: '💊 Omega 3' }
                ].map(h => (
                  <button key={h.id} onClick={() => toggleHabit(h.id)} style={{
                    background: habits[h.id] ? "#1a3a1a" : "#0a0a0f",
                    border: `1px solid ${habits[h.id] ? "#4a8a4a" : "#2a2a3a"}`,
                    color: habits[h.id] ? "#6adb6a" : "#4a4a6a",
                    padding: "8px 12px", borderRadius: "8px", fontSize: "11px", cursor: "pointer", fontFamily: "Georgia"
                  }}>{h.label}</button>
                ))}
              </div>
            </div>

            {/* Stats */}
            <div style={{ background: "#111120", border: "1px solid #2a2a3a", borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 10, letterSpacing: 3, color: "#7a7a9a", textTransform: "uppercase", marginBottom: 12 }}>Estadísticas Poker</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                {[
                  { label: "Sesiones", val: pokerTotal },
                  { label: "Ganadas", val: pokerWins },
                  { label: "Win rate", val: pokerTotal ? `${((pokerWins / pokerTotal) * 100).toFixed(0)}%` : "—" },
                ].map((s) => (
                  <div key={s.label} style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 20, fontWeight: "bold", color: "#e8e0d0" }}>{s.val}</div>
                    <div style={{ fontSize: 10, color: "#5a5a7a", marginTop: 2 }}>{s.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Upgrade path */}
            <div style={{ background: "#111120", border: "1px solid #2a2a3a", borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 10, letterSpacing: 3, color: "#7a7a9a", textTransform: "uppercase", marginBottom: 12 }}>Escalera de Stakes</div>
              {UPGRADE_RULES.map((r, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11,
                    background: poker >= r.bankroll ? "#1a3a1a" : "#1a1a2a",
                    border: `1px solid ${poker >= r.bankroll ? "#4a8a4a" : "#3a3a5a"}`,
                    color: poker >= r.bankroll ? "#6adb6a" : "#5a5a7a",
                  }}>{poker >= r.bankroll ? "✓" : `$${r.bankroll}`}</div>
                  <div style={{ fontSize: 12, color: poker >= r.bankroll ? "#6adb6a" : "#5a5a7a" }}>{r.action}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "registrar" && (
          <div style={{ background: "#111120", border: "1px solid #2a2a3a", borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 10, letterSpacing: 3, color: "#7a7a9a", textTransform: "uppercase", marginBottom: 16 }}>Nueva Sesión</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              {["cash", "tournament", "sports"].map((t) => (
                <button key={t} onClick={() => setForm({ ...form, type: t })}
                  style={{ flex: 1, padding: "10px 4px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 11, background: form.type === t ? "#2a3a5a" : "#1a1a2a", color: form.type === t ? "#8ab4f8" : "#5a5a7a", fontFamily: "Georgia, serif" }}>
                  {t === "cash" ? "Cash NL2" : t === "tournament" ? "Torneo" : "Deportiva"}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              {["win", "loss"].map((r) => (
                <button key={r} onClick={() => setForm({ ...form, result: r })}
                  style={{ flex: 1, padding: "12px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, background: form.result === r ? (r === "win" ? "#1a3a1a" : "#3a1a1a") : "#1a1a2a", color: form.result === r ? (r === "win" ? "#6adb6a" : "#db6a6a") : "#5a5a7a", fontFamily: "Georgia, serif" }}>
                  {r === "win" ? "▲ Ganancia" : "▼ Pérdida"}
                </button>
              ))}
            </div>
            <input type="number" placeholder={form.type === "sports" ? "Monto en MXN" : "Monto en USD"}
              value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}
              style={{ width: "100%", padding: "14px", borderRadius: 8, border: "1px solid #2a2a4a", background: "#0a0a0f", color: "#e8e0d0", fontSize: 16, fontFamily: "Georgia, serif", boxSizing: "border-box", marginBottom: 12 }}
            />
            <input type="text" placeholder="Nota (opcional)"
              value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
              style={{ width: "100%", padding: "14px", borderRadius: 8, border: "1px solid #2a2a4a", background: "#0a0a0f", color: "#e8e0d0", fontSize: 14, fontFamily: "Georgia, serif", boxSizing: "border-box", marginBottom: 16 }}
            />
            <button onClick={addSession} style={{ width: "100%", padding: "16px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 15, background: "#2a4a8a", color: "#e8e0d0", fontFamily: "Georgia, serif", fontWeight: "bold" }}>Registrar Sesión</button>
          </div>
        )}

        {tab === "historial" && (
          <div style={{ background: "#111120", border: "1px solid #2a2a3a", borderRadius: 12, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 10, letterSpacing: 3, color: "#7a7a9a", textTransform: "uppercase" }}>
                {showArchived ? "Papelera" : "Historial Activo"}
              </div>
              <button onClick={() => setShowArchived(!showArchived)} style={{ fontSize: 10, background: "none", border: "1px solid #3a3a5a", color: "#8ab4f8", borderRadius: 4, padding: "4px 8px", cursor: "pointer" }}>
                Ver {showArchived ? "Activos" : "Eliminados"}
              </button>
            </div>
            
            {(showArchived ? archivedSessions : sessions).length === 0 && (
              <div style={{ textAlign: "center", color: "#5a5a7a", fontSize: 12, padding: "20px 0" }}>No hay registros aquí.</div>
            )}

            {(showArchived ? archivedSessions : sessions).map((s) => (
              <div key={s.id} style={{ background: "#0a0a0f", border: `1px solid ${s.amount > 0 ? "#2a4a2a" : "#4a2a2a"}`, borderRadius: 10, padding: 14, marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center", opacity: showArchived ? 0.6 : 1 }}>
                <div>
                  <div style={{ fontSize: 13, color: "#c0b8a8" }}>{s.type.toUpperCase()} · {s.note}</div>
                  <div style={{ fontSize: 11, color: "#5a5a7a" }}>{s.date}</div>
                </div>
                <div style={{ fontSize: 18, fontWeight: "bold", color: s.amount > 0 ? "#6adb6a" : "#db6a6a" }}>{s.amount > 0 ? "+" : ""}{s.amount}</div>
              </div>
            ))}
          </div>
        )}

        {tab === "reglas" && (
          <div style={{ background: "#111120", border: "1px solid #2a2a3a", borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 10, letterSpacing: 3, color: "#7a7a9a", textTransform: "uppercase", marginBottom: 16 }}>Reglas y Sistema</div>
            {Object.keys(RULES).map(key => (
              <div key={key} style={{ marginBottom: 12 }}>
                <button onClick={() => setShowRules(showRules === key ? null : key)} style={{ width: "100%", textAlign: "left", padding: "14px", borderRadius: 10, border: "1px solid #2a2a3a", background: "#0a0a0f", color: "#e8e0d0", fontFamily: "Georgia", cursor: "pointer" }}>
                  {key.toUpperCase()} {showRules === key ? "▲" : "▼"}
                </button>
                {showRules === key && (
                  <div style={{ padding: "12px", fontSize: "12px", color: "#7a7a9a" }}>
                    {RULES[key].map((r, i) => <div key={i} style={{ marginBottom: 4 }}>• {r}</div>)}
                  </div>
                )}
              </div>
            ))}
            
            {/* BOTÓN DE BORRADO LÓGICO */}
            <div style={{ marginTop: "40px", borderTop: "1px solid #2a2a3a", paddingTop: "20px" }}>
              <button onClick={archiveSystem} style={{ width: "100%", padding: "12px", borderRadius: 10, background: "transparent", border: "1px solid #4a1a1a", color: "#cc3333", fontSize: "11px", cursor: "pointer", fontFamily: "Georgia" }}>
                BORRAR DATOS (ARCHIVAR)
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bottom nav */}
      <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 480, background: "#0d0d1a", borderTop: "1px solid #2a2a3a", display: "flex" }}>
        {["dashboard", "registrar", "historial", "reglas"].map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: "15px 0", border: "none", background: "transparent", cursor: "pointer", color: tab === t ? "#8ab4f8" : "#4a4a6a", fontSize: "10px", textTransform: "uppercase" }}>
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}