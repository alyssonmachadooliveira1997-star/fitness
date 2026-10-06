'use strict';
/* =====================================================================
   Jornada — acompanhamento de emagrecimento e evolução física
   JavaScript puro, sem backend. Dados salvos no localStorage.
   ===================================================================== */

const STORE_KEY = 'jornada-emagrecimento:v1';
const SCHEMA = 1;
const DAY = 86400000;
const KG_LB = 2.2046226218;

/* ---------- utilitários ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const sum = a => a.reduce((x, y) => x + y, 0);
const avg = a => (a.length ? sum(a) / a.length : null);
const round1 = n => Math.round(n * 10) / 10;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/* ---------- datas (sempre texto AAAA-MM-DD, no fuso local) ---------- */
const pad = n => String(n).padStart(2, '0');
const toISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayISO = () => toISO(new Date());
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return toISO(d); };
const dayNum = s => { const [y, m, d] = s.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / DAY); };
const diffDays = (a, b) => dayNum(b) - dayNum(a);
const weekStart = s => addDays(s, -((parseISO(s).getDay() + 6) % 7));
const fmtDate = s => { if (!s) return '—'; const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; };
const fmtShort = s => { const [, m, d] = s.split('-'); return `${d}/${m}`; };
const WD = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const WD_LONG = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const fmtLong = s => { const d = parseISO(s); return `${WD_LONG[d.getDay()]}, ${d.getDate()} de ${MONTHS[d.getMonth()]}`; };

/* ---------- números ---------- */
const fmtN = (n, dec = 1) => (n == null || Number.isNaN(n) ? '—' : Number(n).toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec }));
const parseNum = v => {
  if (v == null) return null;
  const t = String(v).trim().replace(/\s/g, '').replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/* ---------- estado ---------- */
const defaultState = () => ({
  schema: SCHEMA,
  profile: { onboarded: false, name: '', startWeight: null, startDate: null, startEntryId: null, finalWeight: null },
  settings: { unit: 'kg', kcalMin: 2000, kcalMax: 2100, protMin: 140, protMax: 160, currentGoalId: null },
  foods: [],      // alimentos cadastrados
  weights: [],    // { id, date, w }  (w sempre em kg)
  goals: [],      // objetivos
  logs: {},       // registros diários { [data]: { diet, note } }
  workouts: {}    // treinos { [data]: { done, day, variant, strengthMin, cardioMin, activity, dist, speed } }
});

let S = defaultState();
let storageOK = true;

function migrate(data) {
  const d = defaultState();
  if (!data || typeof data !== 'object') return d;
  return {
    schema: SCHEMA,
    profile: { ...d.profile, ...(data.profile || {}) },
    settings: { ...d.settings, ...(data.settings || {}) },
    foods: Array.isArray(data.foods) ? data.foods : [],
    weights: Array.isArray(data.weights) ? data.weights : [],
    goals: Array.isArray(data.goals) ? data.goals : [],
    logs: data.logs && typeof data.logs === 'object' ? data.logs : {},
    workouts: data.workouts && typeof data.workouts === 'object' ? data.workouts : {}
  };
}
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) S = migrate(JSON.parse(raw));
  } catch (e) {
    storageOK = false;
    console.warn('Armazenamento local indisponível ou corrompido.', e);
  }
}
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(S));
    storageOK = true;
  } catch (e) {
    storageOK = false;
    if (typeof toast === 'function') toast('Não foi possível salvar neste navegador. Exporte seus dados em Configurações.', 'error');
  }
}

/* ---------- unidade de peso (dados guardados em kg) ---------- */
const unitName = () => (S.settings.unit === 'lb' ? 'lb' : 'kg');
const toU = kg => (unitName() === 'lb' ? kg * KG_LB : kg);
const fromU = v => (unitName() === 'lb' ? v / KG_LB : v);
const fmtW = (kg, dec = 1) => (kg == null ? '—' : `${fmtN(toU(kg), dec)} ${unitName()}`);
const fmtWn = (kg, dec = 1) => (kg == null ? '—' : fmtN(toU(kg), dec));
const fmtDelta = (kg, dec = 1) => {
  if (kg == null) return '—';
  const v = toU(kg);
  const sg = v > 0.049 ? '+' : v < -0.049 ? '−' : '';
  return `${sg}${fmtN(Math.abs(v), dec)} ${unitName()}`;
};
const inputW = kg => (kg == null ? '' : String(round1(toU(kg))).replace('.', ','));

/* =====================================================================
   CÁLCULOS (todos dinâmicos)
   ===================================================================== */
const weightsSorted = () => S.weights.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

function maSeries(ws) {
  return ws.map(p => {
    const from = addDays(p.date, -6);
    return { date: p.date, w: avg(ws.filter(q => q.date >= from && q.date <= p.date).map(q => q.w)) };
  });
}
function windowAvg(ws, endISO, days = 7) {
  const from = addDays(endISO, -(days - 1));
  return avg(ws.filter(q => q.date >= from && q.date <= endISO).map(q => q.w));
}
const currentW = () => { const ws = weightsSorted(); return ws.length ? ws[ws.length - 1].w : null; };
function smoothedNow() {
  const ws = weightsSorted();
  return ws.length ? windowAvg(ws, ws[ws.length - 1].date) : null;
}
/* ritmo atual em kg/semana (negativo = perda), por regressão linear nos últimos 21 dias */
function weeklyRate() {
  const ws = weightsSorted();
  const t = todayISO();
  const from = addDays(t, -20);
  const pts = ws.filter(p => p.date >= from && p.date <= t).map(p => ({ x: dayNum(p.date), y: p.w }));
  if (pts.length < 3) return null;
  if (pts[pts.length - 1].x - pts[0].x < 6) return null;
  const mx = avg(pts.map(p => p.x)), my = avg(pts.map(p => p.y));
  let num = 0, den = 0;
  pts.forEach(p => { num += (p.x - mx) * (p.y - my); den += (p.x - mx) ** 2; });
  return den ? (num / den) * 7 : null;
}

/* ---------- objetivos ---------- */
const goalEnd = g => addDays(g.startDate, g.weeks * 7);
function goalCompletion(g) {
  if (g.completedDate) return g.completedDate;
  const hit = weightsSorted().find(p => p.date >= g.startDate && p.w <= g.targetWeight + 1e-9);
  return hit ? hit.date : null;
}
/* marca objetivos recém-concluídos; devolve o primeiro encontrado */
function checkGoals() {
  let first = null;
  S.goals.forEach(g => {
    if (g.completedDate) return;
    const d = goalCompletion(g);
    if (d) {
      const p = S.weights.find(x => x.date === d);
      g.completedDate = d;
      g.finalWeight = p ? p.w : g.targetWeight;
      if (!first) first = g;
    }
  });
  if (first) save();
  return first;
}
function currentGoal() {
  const open = S.goals.filter(g => !g.completedDate);
  return open.find(g => g.id === S.settings.currentGoalId) || open[open.length - 1] || null;
}
function goalMetrics(g) {
  const total = g.startWeight - g.targetWeight;
  const days = g.weeks * 7;
  const end = addDays(g.startDate, days);
  const t = todayISO();
  const cur = currentW();
  const ma = smoothedNow();
  const doneDate = goalCompletion(g);
  const done = !!doneDate;
  const curG = done ? (g.finalWeight ?? g.targetWeight) : (cur ?? g.startWeight);
  const lost = g.startWeight - curG;
  const pct = total > 0 ? clamp((lost / total) * 100, 0, 100) : 0;
  const remaining = Math.max(0, curG - g.targetWeight);
  const elapsed = clamp(diffDays(g.startDate, t), 0, days);
  const perWeek = total / g.weeks;
  const perDay = total / days;
  const expected = g.startWeight - perDay * elapsed;
  const refW = done ? curG : (ma ?? curG);
  const delta = refW - expected; // positivo = acima da trajetória
  const hasData = weightsSorted().some(p => p.date >= g.startDate);
  let status;
  if (done) status = 'done';
  else if (t > end) status = 'late';
  else if (!hasData || elapsed < 3) status = 'ok';
  else if (delta <= 0.3) status = 'ok';
  else if (delta <= 1.0) status = 'warn';
  else status = 'late';
  const rate = weeklyRate();
  let projection = null;
  if (!done && rate != null && rate < -0.05) projection = addDays(t, Math.ceil((remaining / -rate) * 7));
  let timing = 'Dentro do prazo';
  if (done) timing = doneDate <= end ? 'Concluído no prazo' : 'Concluído após o prazo';
  else if (status === 'late') timing = 'Atrasado';
  else if (hasData && delta < -0.3) timing = 'Adiantado';
  let pace;
  if (done) pace = '';
  else if (!hasData) pace = 'Registre seu peso para acompanhar o ritmo.';
  else if (delta < -0.3) pace = `Você está ${fmtN(toU(-delta))} ${unitName()} à frente da trajetória.`;
  else if (delta <= 0.3) pace = 'Você está dentro da trajetória planejada.';
  else pace = `Você está ${fmtN(toU(delta))} ${unitName()} acima da trajetória necessária.`;
  return {
    total, days, end, perWeek, perDay, curG, lost, pct, remaining, elapsed, expected, delta, status, timing, pace,
    done, doneDate, rate, projection, hasData, daysLeft: Math.max(0, diffDays(t, end)),
    doneInTime: done && doneDate <= end,
    used: done ? diffDays(g.startDate, doneDate) : elapsed
  };
}
const STATUS = {
  ok: { emoji: '🟢', label: 'No ritmo', cls: 'ok' },
  warn: { emoji: '🟡', label: 'Atenção', cls: 'warn' },
  late: { emoji: '🔴', label: 'Atrasado', cls: 'late' },
  done: { emoji: '🏆', label: 'Concluído', cls: 'done' }
};
function goalMilestones(g) {
  const perWeek = (g.startWeight - g.targetWeight) / g.weeks;
  const minSince = Math.min(...weightsSorted().filter(p => p.date >= g.startDate).map(p => p.w), Infinity);
  const list = [];
  for (let i = 0; i <= g.weeks; i++) {
    const w = i === g.weeks ? g.targetWeight : g.startWeight - perWeek * i;
    list.push({ week: i, date: addDays(g.startDate, i * 7), weight: w, reached: i === 0 ? true : minSince <= w + 1e-9 });
  }
  const firstOpen = list.findIndex(m => !m.reached);
  list.forEach((m, i) => { m.current = i === firstOpen; });
  return list;
}

/* ---------- jornada (etapas de 5 em 5) ---------- */
function journeyStages() {
  const start = S.profile.startWeight;
  if (start == null) return [];
  const map = new Map();
  const key = w => String(Math.round(w * 10));
  map.set(key(start), { weight: start, start: true });
  const first = Math.ceil(start / 5) * 5 - 5;
  const lowest = S.profile.finalWeight != null ? Math.min(S.profile.finalWeight, first) : first - 20;
  for (let w = first; w >= lowest - 1e-9; w -= 5) if (!map.has(key(w))) map.set(key(w), { weight: w });
  S.goals.forEach(g => { if (!map.has(key(g.targetWeight))) map.set(key(g.targetWeight), { weight: g.targetWeight }); });
  const stages = [...map.values()].sort((a, b) => b.weight - a.weight);
  const cg = currentGoal();
  let prevDone = true;
  stages.forEach(s => {
    if (s.start) { s.state = 'start'; return; }
    const goals = S.goals.filter(g => Math.abs(g.targetWeight - s.weight) < 0.05);
    const g = goals[goals.length - 1];
    if (g && g.completedDate) { s.state = 'done'; s.goal = g; }
    else if (g && cg && g.id === cg.id) { s.state = 'current'; s.goal = g; }
    else if (g) { s.state = 'planned'; s.goal = g; }
    else if (prevDone) s.state = 'unlocked';
    else s.state = 'locked';
    prevDone = s.state === 'done';
  });
  return stages;
}

/* ---------- treinos, dieta, registros ---------- */
function workoutsIn(from, to) {
  return Object.entries(S.workouts).filter(([d, w]) => w && w.done && d >= from && d <= to).map(([d, w]) => ({ date: d, ...w }));
}
function weekSummary(ws0) {
  const to = addDays(ws0, 6);
  const w = workoutsIn(ws0, to);
  const wt = weightsSorted().filter(p => p.date >= ws0 && p.date <= to).map(p => p.w);
  return {
    start: ws0, count: w.length,
    strength: sum(w.map(x => +x.strengthMin || 0)),
    cardio: sum(w.map(x => +x.cardioMin || 0)),
    avgWeight: avg(wt), weighIns: wt.length
  };
}
function dietStats(fromISO) {
  const rows = Object.entries(S.logs).filter(([d, l]) => l && l.diet && (!fromISO || d >= fromISO)).map(([, l]) => l.diet);
  const yes = rows.filter(r => r === 'yes').length, partial = rows.filter(r => r === 'partial').length, no = rows.filter(r => r === 'no').length;
  const total = rows.length;
  return { yes, partial, no, total, pct: total ? Math.round(((yes + 0.5 * partial) / total) * 100) : null };
}
function trainAdherence(days = 28) {
  const t = todayISO();
  const start0 = S.profile.startDate || t;
  let from = addDays(t, -(days - 1));
  if (from < start0) from = start0;
  let planned = 0;
  for (let d = from; d <= t; d = addDays(d, 1)) if (parseISO(d).getDay() !== 0) planned++;
  const done = workoutsIn(from, t).length;
  return { planned, done, pct: planned ? Math.round(clamp(done / planned, 0, 1) * 100) : null, from };
}
function recordedDates() {
  const set = new Set(Object.keys(S.logs));
  Object.keys(S.workouts).forEach(d => set.add(d));
  S.weights.forEach(w => set.add(w.date));
  return set;
}
function streak() {
  const set = recordedDates();
  let d = todayISO();
  if (!set.has(d)) d = addDays(d, -1);
  let n = 0;
  while (set.has(d)) { n++; d = addDays(d, -1); }
  return n;
}
function trackingDays() {
  const set = [...recordedDates()];
  const first = [S.profile.startDate, ...set].filter(Boolean).sort()[0];
  return first ? diffDays(first, todayISO()) + 1 : 0;
}
const isRestDay = dateISO => parseISO(dateISO).getDay() === 0;

/* ---------- alertas de segurança ---------- */
const WELLNESS_RE = /tontur|desmai|mal[- ]?estar|fraquez|muito fraco|enjoo|n[aá]usea|nausea|palpita|falta de ar|dor no peito|vertigem|tonto|passando mal/i;
function safetyAlerts() {
  const out = [];
  const ws = weightsSorted();
  if (ws.length >= 2) {
    const last = ws[ws.length - 1].date;
    if (diffDays(last, todayISO()) <= 7) {
      const a = windowAvg(ws, last, 7), b = windowAvg(ws, addDays(last, -7), 7);
      if (a != null && b != null && (b - a) / b > 0.01) {
        out.push('Seu peso médio caiu mais de 1% em uma semana. Perda muito rápida merece atenção: considere conversar com um profissional de saúde.');
      }
    }
  }
  const t = todayISO();
  const recent = Object.entries(S.logs).filter(([d, l]) => d >= addDays(t, -3) && l && l.note && WELLNESS_RE.test(l.note));
  if (recent.length) {
    out.push('Suas observações recentes mencionam sinais de mal-estar. Se isso persistir, procure avaliação profissional.');
  }
  return out;
}

/* ---------- insights automáticos ---------- */
function buildInsights() {
  const out = [];
  const t = todayISO();
  const ws = weightsSorted();
  const last7 = workoutsIn(addDays(t, -6), t).length;
  if (Object.keys(S.workouts).length) out.push(`Você treinou ${last7} ${last7 === 1 ? 'vez' : 'vezes'} nos últimos 7 dias.`);
  if (ws.length) {
    const a = windowAvg(ws, t, 7), b = windowAvg(ws, addDays(t, -7), 7);
    if (a != null && b != null) {
      const d = a - b;
      if (Math.abs(toU(d)) < 0.05) out.push('Seu peso médio ficou estável em relação à semana anterior.');
      else if (d < 0) out.push(`Seu peso médio caiu ${fmtN(toU(-d))} ${unitName()} nesta semana.`);
      else out.push(`Seu peso médio subiu ${fmtN(toU(d))} ${unitName()} nesta semana. Oscilações são normais; observe a tendência.`);
    }
  }
  const ds = dietStats(addDays(t, -29));
  if (ds.total >= 3) out.push(`Você manteve ${ds.pct}% de adesão à dieta nos últimos 30 dias.`);
  const g = currentGoal();
  if (g) {
    const m = goalMetrics(g);
    if (m.rate != null) {
      const need = -m.perWeek;
      const rtxt = `${fmtDelta(m.rate)}/semana`;
      const gap = Math.abs(m.rate - need);
      if (m.rate > -0.05) out.push(`Seu ritmo atual está parado (${rtxt}). A meta é ${fmtDelta(need)}/semana.`);
      else if (gap <= Math.max(0.25, Math.abs(need) * 0.25)) out.push(`Seu ritmo atual (${rtxt}) está próximo da meta de ${fmtDelta(need)}/semana.`);
      else if (m.rate < need) out.push(`Seu ritmo atual (${rtxt}) está mais rápido que a meta de ${fmtDelta(need)}/semana.`);
      else out.push(`Seu ritmo atual (${rtxt}) está abaixo da meta de ${fmtDelta(need)}/semana.`);
    }
    if (m.hasData && !m.done) {
      if (m.delta > 0.3) out.push(`Você está ${fmtN(toU(m.delta))} ${unitName()} acima da trajetória necessária para atingir seu objetivo no prazo.`);
      else if (m.delta < -0.3) out.push(`Você está ${fmtN(toU(-m.delta))} ${unitName()} à frente da trajetória do objetivo.`);
      else out.push('Você está exatamente na trajetória do seu objetivo.');
    }
    if (m.projection) out.push(`Mantendo o ritmo atual, a previsão para chegar a ${fmtW(g.targetWeight)} é ${fmtDate(m.projection)}.`);
  }
  const st = streak();
  if (st >= 2) out.push(`Você registrou ${st} dias seguidos.`);
  const wk = weekSummary(weekStart(t));
  if (wk.cardio > 0) out.push(`Nesta semana você somou ${wk.cardio} min de aeróbico e ${wk.strength} min de musculação.`);
  return out;
}

/* =====================================================================
   DADOS FIXOS: plano alimentar, treinos e alimentos de referência
   ===================================================================== */
const CATS = [
  { id: 'proteinas', label: 'Proteínas' },
  { id: 'carboidratos', label: 'Carboidratos' },
  { id: 'frutas', label: 'Frutas' },
  { id: 'vegetais', label: 'Verduras e legumes' },
  { id: 'laticinios', label: 'Laticínios' },
  { id: 'outros', label: 'Outros' }
];
const catLabel = id => (CATS.find(c => c.id === id) || CATS[5]).label;
const UNITS = ['g', 'kg', 'ml', 'l', 'unidade', 'fatia'];

const MEAL_PLAN = [
  {
    id: 'breakfast', name: 'Café da manhã', min: 400, max: 450,
    lines: ['2 ovos', '2 fatias de pão', '15 g de requeijão', '150–200 g de mamão', '10 g de aveia', 'Café', 'Opcional: 10–15 g de leite em pó']
  },
  {
    id: 'snack_am', name: 'Lanche da manhã', min: 120, max: 180,
    lines: ['Fruta + ovo', 'Banana + aveia', 'Laranja ou tangerina + ovo']
  },
  {
    id: 'lunch', name: 'Almoço', min: 550, max: 650,
    lines: ['150–180 g de proteína', '100–120 g de arroz', '80–100 g de feijão', '200–300 g de legumes e verduras', 'Troque proteína e carboidrato conforme os alimentos que você tem']
  },
  {
    id: 'snack_pm', name: 'Lanche da tarde', min: 180, max: 250,
    lines: ['Iogurte + fruta + aveia', 'Banana + ovos', 'Outras combinações com os seus alimentos']
  },
  {
    id: 'dinner', name: 'Jantar', min: 500, max: 600,
    lines: ['Estrutura parecida com a do almoço', 'Frango + batata + legumes', 'Patinho + batata + legumes', 'Tilápia + arroz + feijão + legumes', 'Refeições com abóbora, cenoura e outros vegetais']
  }
];

/* Semana de treino: índice = getDay() (0 = domingo) */
const WEEK_PLAN = {
  1: { group: 'Peito + Tríceps', A: ['Supino máquina', 'Supino inclinado', 'Crucifixo', 'Tríceps pulley'], B: ['Supino reto', 'Supino inclinado com halteres', 'Peck deck', 'Tríceps francês'], C: ['Chest press', 'Crossover', 'Crucifixo máquina', 'Tríceps corda'] },
  2: { group: 'Costas + Bíceps', A: ['Puxada frontal', 'Remada baixa', 'Remada articulada', 'Rosca direta'], B: ['Remada curvada', 'Puxada supinada', 'Pullover na polia', 'Rosca alternada'], C: ['Remada cavalinho', 'Puxada com triângulo', 'Remada máquina', 'Rosca martelo'] },
  3: { group: 'Pernas', A: ['Leg press 45°', 'Cadeira extensora', 'Mesa flexora', 'Panturrilha em pé'], B: ['Agachamento no smith', 'Afundo com halteres', 'Cadeira flexora', 'Panturrilha sentado'], C: ['Hack machine', 'Cadeira abdutora', 'Stiff', 'Panturrilha no leg press'] },
  4: { group: 'Ombros + Braços', A: ['Desenvolvimento máquina', 'Elevação lateral', 'Rosca direta', 'Tríceps corda'], B: ['Desenvolvimento com halteres', 'Elevação frontal', 'Rosca martelo', 'Tríceps testa'], C: ['Arnold press', 'Crucifixo inverso', 'Rosca scott', 'Tríceps francês'] },
  5: { group: 'Peito + Costas', A: ['Supino máquina', 'Puxada frontal', 'Crucifixo máquina', 'Remada baixa'], B: ['Supino reto', 'Remada curvada', 'Supino inclinado com halteres', 'Puxada supinada'], C: ['Chest press', 'Remada máquina', 'Crossover', 'Pulldown'] },
  6: { group: 'Pernas + Abdômen', A: ['Leg press 45°', 'Cadeira extensora', 'Mesa flexora', 'Abdominal na máquina', 'Prancha'], B: ['Agachamento no smith', 'Afundo com halteres', 'Stiff', 'Abdominal infra', 'Prancha'], C: ['Hack machine', 'Cadeira abdutora', 'Panturrilha sentado', 'Abdominal remador', 'Elevação de pernas'] },
  0: { group: 'Descanso', rest: true }
};
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // segunda a domingo

/* Valores aproximados por 100 g (referência para facilitar o cadastro; ajuste ao seu rótulo) */
const COMMON_FOODS = [
  { name: 'Ovo', cat: 'proteinas', kcal: 143, p: 13, c: 1.1, f: 9.5, unit: 'unidade', gPerUnit: 50 },
  { name: 'Peito de frango grelhado', cat: 'proteinas', kcal: 159, p: 32, c: 0, f: 2.5, unit: 'g' },
  { name: 'Patinho grelhado', cat: 'proteinas', kcal: 219, p: 35.9, c: 0, f: 7.3, unit: 'g' },
  { name: 'Tilápia grelhada', cat: 'proteinas', kcal: 128, p: 26, c: 0, f: 2.7, unit: 'g' },
  { name: 'Atum em lata ao natural', cat: 'proteinas', kcal: 116, p: 26, c: 0, f: 1, unit: 'g' },
  { name: 'Arroz branco cozido', cat: 'carboidratos', kcal: 128, p: 2.5, c: 28.1, f: 0.2, unit: 'g' },
  { name: 'Feijão carioca cozido', cat: 'carboidratos', kcal: 76, p: 4.8, c: 13.6, f: 0.5, unit: 'g' },
  { name: 'Pão de forma', cat: 'carboidratos', kcal: 253, p: 9, c: 49, f: 3, unit: 'fatia', gPerUnit: 25 },
  { name: 'Batata inglesa cozida', cat: 'carboidratos', kcal: 52, p: 1.2, c: 11.9, f: 0, unit: 'g' },
  { name: 'Batata-doce cozida', cat: 'carboidratos', kcal: 77, p: 0.6, c: 18.4, f: 0.1, unit: 'g' },
  { name: 'Mandioca cozida', cat: 'carboidratos', kcal: 125, p: 0.6, c: 30.1, f: 0.3, unit: 'g' },
  { name: 'Aveia em flocos', cat: 'carboidratos', kcal: 394, p: 13.9, c: 66.6, f: 8.5, unit: 'g' },
  { name: 'Banana prata', cat: 'frutas', kcal: 98, p: 1.3, c: 26, f: 0.1, unit: 'unidade', gPerUnit: 80 },
  { name: 'Mamão papaia', cat: 'frutas', kcal: 40, p: 0.5, c: 10.4, f: 0.1, unit: 'g' },
  { name: 'Laranja', cat: 'frutas', kcal: 46, p: 1, c: 11.5, f: 0.1, unit: 'unidade', gPerUnit: 150 },
  { name: 'Tangerina', cat: 'frutas', kcal: 38, p: 0.8, c: 9.6, f: 0.1, unit: 'unidade', gPerUnit: 120 },
  { name: 'Maçã', cat: 'frutas', kcal: 56, p: 0.3, c: 15.2, f: 0, unit: 'unidade', gPerUnit: 130 },
  { name: 'Abóbora cozida', cat: 'vegetais', kcal: 48, p: 1.4, c: 10.8, f: 0.7, unit: 'g' },
  { name: 'Cenoura cozida', cat: 'vegetais', kcal: 34, p: 0.8, c: 7.7, f: 0.2, unit: 'g' },
  { name: 'Brócolis cozido', cat: 'vegetais', kcal: 25, p: 2.1, c: 4.4, f: 0.5, unit: 'g' },
  { name: 'Tomate', cat: 'vegetais', kcal: 15, p: 1.1, c: 3.1, f: 0.2, unit: 'g' },
  { name: 'Alface', cat: 'vegetais', kcal: 14, p: 1.7, c: 2.4, f: 0.2, unit: 'g' },
  { name: 'Requeijão cremoso', cat: 'laticinios', kcal: 257, p: 9.6, c: 2.4, f: 23.4, unit: 'g' },
  { name: 'Iogurte natural', cat: 'laticinios', kcal: 51, p: 4.1, c: 1.9, f: 3, unit: 'g' },
  { name: 'Queijo minas frescal', cat: 'laticinios', kcal: 264, p: 17.4, c: 3.2, f: 20.2, unit: 'g' },
  { name: 'Leite em pó integral', cat: 'laticinios', kcal: 497, p: 25.4, c: 39.2, f: 26.9, unit: 'g' }
];

/* =====================================================================
   GERADOR DE CARDÁPIO
   Combina somente alimentos que costumam andar juntos em cada refeição.
   ===================================================================== */
const MEAL_IDS = ['breakfast', 'snack_am', 'lunch', 'snack_pm', 'dinner'];
const MEAL_BY_ID = Object.fromEntries(MEAL_PLAN.map(m => [m.id, m]));

function foodMeals(f) {
  const n = norm(f.name);
  switch (f.cat) {
    case 'proteinas':
      if (/ovo/.test(n)) return MEAL_IDS;
      if (/atum|sardinha/.test(n)) return ['snack_pm', 'lunch', 'dinner'];
      return ['lunch', 'dinner'];
    case 'carboidratos':
      if (/pao|tapioca|torrada|granola|cereal|biscoito|bolacha|cuscuz|aveia|wrap/.test(n)) return ['breakfast', 'snack_am', 'snack_pm'];
      return ['lunch', 'dinner'];
    case 'frutas': return ['breakfast', 'snack_am', 'snack_pm'];
    case 'vegetais': return ['lunch', 'dinner'];
    case 'laticinios': return ['breakfast', 'snack_am', 'snack_pm'];
    default: return [];
  }
}
const foodGPU = f => ((f.unit === 'unidade' || f.unit === 'fatia') ? (+f.gPerUnit > 0 ? +f.gPerUnit : 100) : null);
function foodAvailG(f) {
  if (f.qty == null || f.qty === '') return Infinity;
  const q = +f.qty;
  if (!(q >= 0)) return Infinity;
  switch (f.unit) {
    case 'g': case 'ml': return q;
    case 'kg': case 'l': return q * 1000;
    case 'unidade': case 'fatia': return q * foodGPU(f);
    default: return Infinity;
  }
}
function mkItem(f, g) {
  const gpu = foodGPU(f);
  if (gpu) { const n = Math.max(1, Math.round(g / gpu)); return { f, n, g: n * gpu }; }
  const gg = g >= 100 ? Math.round(g / 10) * 10 : Math.max(5, Math.round(g / 5) * 5);
  return { f, n: null, g: gg };
}
const itemMacro = (it, k) => (it.f[k] || 0) * it.g / 100;
const RX = {
  egg: /ovo/, bread: /pao|tapioca|torrada|cuscuz|wrap/, spread: /requeij|queijo|ricota|cottage|cream/,
  oats: /aveia|granola/, yog: /iogurte|kefir|leite/, rice: /arroz|macarr|mandioca|inhame|cuscuz|polenta|quinoa/,
  potato: /batata|mandioca|inhame/, bean: /feij|lentilha|grao.de.bico|ervilha/
};
const NOT_PROT = /ovo|feij|lentilha|grao|ervilha|whey/;
const sl = (cats, g, r, o = {}) => ({ cats, g, r, ...o });

const PATTERNS = {
  breakfast: [
    [sl(['proteinas'], 100, [100, 150], { re: RX.egg }), sl(['carboidratos'], 50, [25, 100], { re: RX.bread, flex: 1 }), sl(['laticinios'], 15, [10, 30], { re: RX.spread, opt: 1 }), sl(['frutas'], 175, [100, 250], { flex: 1 }), sl(['carboidratos'], 10, [10, 20], { re: RX.oats, opt: 1 })],
    [sl(['laticinios'], 170, [120, 250], { re: RX.yog, notRe: /po\b|em po/, flex: 1 }), sl(['carboidratos'], 30, [15, 50], { re: RX.oats, flex: 1 }), sl(['frutas'], 120, [80, 200], { flex: 1 }), sl(['proteinas'], 50, [50, 100], { re: RX.egg, opt: 1 })],
    [sl(['proteinas'], 100, [100, 150], { re: RX.egg }), sl(['carboidratos'], 60, [25, 100], { re: RX.bread, flex: 1 }), sl(['frutas'], 150, [100, 250], { flex: 1 })]
  ],
  snack_am: [
    [sl(['frutas'], 120, [80, 200], { flex: 1 }), sl(['proteinas'], 50, [50, 100], { re: RX.egg })],
    [sl(['frutas'], 100, [80, 160], { flex: 1 }), sl(['carboidratos'], 15, [10, 30], { re: RX.oats, flex: 1 })],
    [sl(['laticinios'], 120, [80, 170], { re: RX.yog, notRe: /po\b|em po/, flex: 1 }), sl(['frutas'], 80, [60, 150], { flex: 1 }), sl(['carboidratos'], 10, [10, 20], { re: RX.oats, opt: 1 })]
  ],
  snack_pm: [
    [sl(['laticinios'], 170, [120, 250], { re: RX.yog, notRe: /po\b|em po/, flex: 1 }), sl(['frutas'], 100, [80, 160], { flex: 1 }), sl(['carboidratos'], 15, [10, 30], { re: RX.oats, flex: 1 })],
    [sl(['frutas'], 100, [80, 160], { flex: 1 }), sl(['proteinas'], 100, [100, 150], { re: RX.egg })],
    [sl(['carboidratos'], 50, [25, 75], { re: RX.bread, flex: 1 }), sl(['laticinios'], 30, [20, 50], { re: RX.spread, flex: 1 })]
  ],
  lunch: [
    [sl(['proteinas'], 170, [150, 180], { notRe: NOT_PROT, flex: 1 }), sl(['carboidratos'], 110, [70, 140], { re: RX.rice, flex: 1 }), sl(['carboidratos', 'proteinas'], 90, [60, 110], { re: RX.bean, opt: 1 }), sl(['vegetais'], 250, [200, 300], { veg: 1 })],
    [sl(['proteinas'], 170, [150, 180], { notRe: NOT_PROT, flex: 1 }), sl(['carboidratos'], 200, [120, 280], { re: RX.potato, flex: 1 }), sl(['vegetais'], 250, [200, 300], { veg: 1 })]
  ],
  dinner: [
    [sl(['proteinas'], 160, [130, 180], { notRe: NOT_PROT, flex: 1 }), sl(['carboidratos'], 100, [60, 130], { re: RX.rice, flex: 1 }), sl(['carboidratos', 'proteinas'], 80, [50, 100], { re: RX.bean, opt: 1 }), sl(['vegetais'], 250, [200, 300], { veg: 1 })],
    [sl(['proteinas'], 160, [130, 180], { notRe: NOT_PROT, flex: 1 }), sl(['carboidratos'], 200, [100, 260], { re: RX.potato, flex: 1 }), sl(['vegetais'], 250, [200, 300], { veg: 1 })]
  ]
};

function slotFoods(slot, mealId) {
  return S.foods.filter(f => {
    if (!slot.cats.includes(f.cat)) return false;
    if (!foodMeals(f).includes(mealId)) return false;
    const n = norm(f.name);
    if (slot.re && !slot.re.test(n)) return false;
    if (slot.notRe && slot.notRe.test(n)) return false;
    if (!(+f.kcal >= 0)) return false;
    return foodAvailG(f) > 0;
  });
}
/* opções de cada espaço: lista de listas de { f, g } */
function slotOptions(slot, mealId) {
  const foods = slotFoods(slot, mealId).slice(0, slot.veg ? 6 : 5);
  let opts;
  if (slot.veg) {
    opts = foods.map(f => [{ f, g: slot.g }]);
    for (let i = 0; i < foods.length; i++) for (let j = i + 1; j < foods.length; j++) {
      if (opts.length > 14) break;
      opts.push([{ f: foods[i], g: slot.g / 2 }, { f: foods[j], g: slot.g / 2 }]);
    }
  } else {
    opts = foods.slice(0, slot.opt ? 3 : 5).map(f => [{ f, g: slot.g }]);
  }
  if (slot.opt) opts.unshift([]);
  return opts;
}
function* product(lists, i = 0, acc = []) {
  if (i === lists.length) { yield acc; return; }
  for (const o of lists[i]) yield* product(lists, i + 1, [...acc, { slot: i, items: o }]);
}
function buildCombos(mealId) {
  const meal = MEAL_BY_ID[mealId];
  const mid = (meal.min + meal.max) / 2;
  const results = [];
  const seen = new Set();
  let guard = 0;
  (PATTERNS[mealId] || []).forEach(pattern => {
    const lists = pattern.map(s => slotOptions(s, mealId));
    if (lists.some((l, i) => !l.length || (!pattern[i].opt && !l.some(o => o.length)))) return;
    for (const pick of product(lists)) {
      if (++guard > 6000) return;
      const raw = [];
      pick.forEach(p => p.items.forEach(it => raw.push({ ...it, slot: pattern[p.slot] })));
      if (!raw.length) continue;
      const ids = raw.map(r => r.f.id);
      if (new Set(ids).size !== ids.length) continue;
      const kc = r => (r.f.kcal || 0) * r.g / 100;
      const fixed = sum(raw.filter(r => !r.slot.flex).map(kc));
      const flex = sum(raw.filter(r => r.slot.flex).map(kc));
      const s = flex > 0 ? clamp((mid - fixed) / flex, 0.6, 1.5) : 1;
      const items = raw.map(r => {
        let g = r.g;
        if (r.slot.flex) g = clamp(g * s, r.slot.r[0], r.slot.r[1]);
        return mkItem(r.f, g);
      });
      if (items.some(it => it.g > foodAvailG(it.f) + 1e-9)) continue;
      const tot = { kcal: sum(items.map(i => itemMacro(i, 'kcal'))), p: sum(items.map(i => itemMacro(i, 'p'))), c: sum(items.map(i => itemMacro(i, 'c'))), f: sum(items.map(i => itemMacro(i, 'f'))) };
      const key = items.map(i => i.f.id + ':' + (i.n || i.g)).sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ items, ...tot, pattern: pattern[0].g, mealId });
    }
  });
  return { results, meal, mid };
}
function suggestMeals(mealId, mode = 'balanced', limit = 6) {
  const { results, meal, mid } = buildCombos(mealId);
  let list = results.filter(r => r.kcal >= meal.min * 0.9 && r.kcal <= meal.max * 1.1);
  let approx = false;
  if (!list.length) { list = results.filter(r => r.kcal >= meal.min * 0.75 && r.kcal <= meal.max * 1.25); approx = list.length > 0; }
  const score = r => Math.abs(r.kcal - mid) / mid;
  if (mode === 'protein') list.sort((a, b) => b.p - a.p || score(a) - score(b));
  else if (mode === 'lowcal') list.sort((a, b) => a.kcal - b.kcal || b.p - a.p);
  else list.sort((a, b) => score(a) - score(b) || b.p - a.p);
  const out = [];
  const used = {};
  for (const r of list) {
    const k = r.items[0].f.id;
    if ((used[k] || 0) >= 2) continue;
    used[k] = (used[k] || 0) + 1;
    out.push({ ...r, approx });
    if (out.length >= limit) break;
  }
  return out;
}
function buildDay(idx = 0) {
  const meals = MEAL_IDS.map(id => {
    const list = suggestMeals(id, 'balanced', 6);
    return { id, name: MEAL_BY_ID[id].name, combo: list.length ? list[idx % list.length] : null };
  });
  const got = meals.filter(m => m.combo);
  return {
    meals,
    kcal: sum(got.map(m => m.combo.kcal)), p: sum(got.map(m => m.combo.p)),
    c: sum(got.map(m => m.combo.c)), f: sum(got.map(m => m.combo.f)),
    complete: got.length === MEAL_IDS.length
  };
}
function itemText(it) {
  const name = it.f.name;
  if (it.n != null) {
    const u = it.f.unit === 'fatia' ? (it.n === 1 ? 'fatia' : 'fatias') : (it.n === 1 ? 'unidade' : 'unidades');
    return `${it.n} ${u} de ${name} (${Math.round(it.g)} g)`;
  }
  return `${Math.round(it.g)} ${it.f.unit === 'ml' || it.f.unit === 'l' ? 'ml' : 'g'} de ${name}`;
}

/* =====================================================================
   INTERFACE: ícones, toast, modais, gráficos
   ===================================================================== */
const ICONS = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  diet: '<path d="M6 3v7a2 2 0 0 0 2 2 2 2 0 0 0 2-2V3"/><path d="M8 3v18"/><path d="M17 3c-2 2-3 4.5-3 7 0 1.5 1 2.5 3 2.5V21"/>',
  dumbbell: '<path d="M6.5 6.5v11"/><path d="M17.5 6.5v11"/><path d="M3.5 9v6"/><path d="M20.5 9v6"/><path d="M6.5 12h11"/>',
  scale: '<rect x="3" y="3" width="18" height="18" rx="5"/><path d="M8 10a4 4 0 0 1 8 0"/><path d="M12 10l2-2.5"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
  chart: '<path d="M4 20V4"/><path d="M4 20h16"/><path d="M8 15l4-5 3 3 5-7"/>',
  sliders: '<path d="M4 7h10"/><path d="M18 7h2"/><circle cx="16" cy="7" r="2"/><path d="M4 17h2"/><path d="M10 17h10"/><circle cx="8" cy="17" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  flame: '<path d="M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0V4z"/><path d="M8 6H4v1a4 4 0 0 0 4 4"/><path d="M16 6h4v1a4 4 0 0 1-4 4"/><path d="M12 13v4"/><path d="M8 20h8"/><path d="M10 17h4"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>',
  download: '<path d="M12 4v11"/><path d="M7 11l5 5 5-5"/><path d="M5 20h14"/>',
  upload: '<path d="M12 16V5"/><path d="M7 9l5-5 5 5"/><path d="M5 20h14"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  alert: '<path d="M12 4l9 16H3L12 4z"/><path d="M12 10v4M12 17v.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  book: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
  down: '<path d="M12 5v14"/><path d="M6 13l6 6 6-6"/>',
  up: '<path d="M12 19V5"/><path d="M6 11l6-6 6 6"/>',
  circle: '<circle cx="12" cy="12" r="8"/>',
  leaf: '<path d="M5 19c0-8 5-14 14-14 0 9-6 14-14 14z"/><path d="M5 19c3-4 6-7 9-9"/>',
  shuffle: '<path d="M4 7h4l8 10h4"/><path d="M4 17h4l2-2.5"/><path d="M14 9.5L16 7h4"/><path d="M18 5l2 2-2 2"/><path d="M18 15l2 2-2 2"/>'
};
const icon = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[n] || ''}</svg>`;

/* ---------- toast ---------- */
let toastTimer;
function toast(msg, type = 'ok') {
  const el = $('#toast');
  if (!el) return;
  el.className = `toast show ${type}`;
  el.innerHTML = `${icon(type === 'error' ? 'alert' : 'check')}<span>${esc(msg)}</span>`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3200);
}

/* ---------- modais ---------- */
let modalState = null;
function openModal({ title, body, size = '', onSubmit, submitText = 'Salvar', hideFooter = false, cancelText = 'Cancelar', onOpen, danger = false }) {
  closeModal(true);
  const root = $('#modal-root');
  root.innerHTML = `
    <div class="overlay" data-action="modal-backdrop"></div>
    <div class="sheet ${size}" role="dialog" aria-modal="true" aria-labelledby="mtitle" tabindex="-1">
      <div class="sheet-head"><h2 id="mtitle">${esc(title)}</h2><button type="button" class="icon-btn" data-action="modal-close" aria-label="Fechar">${icon('x')}</button></div>
      <form id="mform" novalidate>
        <div class="sheet-body">${body}</div>
        ${hideFooter ? '' : `<div class="sheet-foot"><button type="button" class="btn ghost" data-action="modal-close">${esc(cancelText)}</button><button type="submit" class="btn ${danger ? 'danger' : 'primary'}">${esc(submitText)}</button></div>`}
      </form>
    </div>`;
  document.body.classList.add('modal-open');
  modalState = { onSubmit, lastFocus: document.activeElement };
  const form = $('#mform');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    clearErrors(form);
    const res = await (onSubmit ? onSubmit(new FormData(form), form) : true);
    if (res !== false) closeModal();
  });
  if (onOpen) onOpen(form);
  const first = $('input:not([type=hidden]):not([type=radio]):not([type=checkbox]), select, textarea', form);
  if (first && window.matchMedia('(pointer:fine)').matches) first.focus();
  else $('.sheet').focus?.();
}
function closeModal(silent) {
  const root = $('#modal-root');
  if (!root || !root.innerHTML) return;
  root.innerHTML = '';
  document.body.classList.remove('modal-open');
  const lf = modalState && modalState.lastFocus;
  modalState = null;
  if (!silent && lf && lf.focus && document.contains(lf)) lf.focus();
}
function clearErrors(form) {
  $$('.field.err', form).forEach(f => f.classList.remove('err'));
  $$('.err-msg', form).forEach(e => e.remove());
  const top = $('.form-error', form); if (top) top.remove();
}
function fieldError(form, name, msg) {
  const input = form.elements[name];
  const field = input && (input.closest ? input.closest('.field') : null);
  if (field) {
    field.classList.add('err');
    const m = document.createElement('div');
    m.className = 'err-msg'; m.setAttribute('role', 'alert'); m.textContent = msg;
    field.appendChild(m);
    if (input.focus) input.focus();
  } else {
    const div = document.createElement('div');
    div.className = 'form-error'; div.setAttribute('role', 'alert'); div.textContent = msg;
    $('.sheet-body', form).prepend(div);
  }
  return false;
}
/* confirmação (Promise) */
function confirmDialog({ title, text, okText = 'Confirmar', danger = false, typeWord = null }) {
  return new Promise(resolve => {
    const root = $('#confirm-root');
    root.innerHTML = `
      <div class="overlay" style="z-index:90"></div>
      <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="ctitle" style="z-index:91">
        <h3 id="ctitle">${esc(title)}</h3>
        <p>${esc(text)}</p>
        ${typeWord ? `<label class="field"><span class="lbl">Digite <strong>${esc(typeWord)}</strong> para confirmar</span><input id="cword" autocomplete="off" autocapitalize="characters"></label>` : ''}
        <div class="dialog-foot"><button type="button" class="btn ghost" data-c="no">Cancelar</button><button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-c="yes" ${typeWord ? 'disabled' : ''}>${esc(okText)}</button></div>
      </div>`;
    const done = v => { root.innerHTML = ''; resolve(v); };
    const yes = $('[data-c=yes]', root);
    const w = $('#cword', root);
    if (w) w.addEventListener('input', () => { yes.disabled = w.value.trim().toUpperCase() !== typeWord; });
    $('[data-c=no]', root).onclick = () => done(false);
    $('.overlay', root).onclick = () => done(false);
    yes.onclick = () => done(true);
    (w || $('[data-c=no]', root)).focus();
  });
}

/* ---------- campos de formulário ---------- */
const field = (label, input, hint = '') => `<label class="field"><span class="lbl">${esc(label)}</span>${input}${hint ? `<span class="hint">${esc(hint)}</span>` : ''}</label>`;
const textInput = (name, val = '', attrs = '') => `<input name="${name}" value="${esc(val)}" ${attrs}>`;
const numInput = (name, val = '', attrs = '') => `<input name="${name}" value="${esc(val)}" inputmode="decimal" autocomplete="off" ${attrs}>`;
const dateInput = (name, val, max = true) => `<input type="date" name="${name}" value="${esc(val || '')}" ${max ? `max="${todayISO()}"` : ''}>`;
const selectInput = (name, opts, val) => `<select name="${name}">${opts.map(o => `<option value="${esc(o.v)}" ${String(o.v) === String(val) ? 'selected' : ''}>${esc(o.t)}</option>`).join('')}</select>`;
const segmented = (name, opts, val) => `<div class="seg" role="radiogroup">${opts.map(o => `<label class="seg-opt"><input type="radio" name="${name}" value="${esc(o.v)}" ${String(o.v) === String(val) ? 'checked' : ''}><span>${o.t}</span></label>`).join('')}</div>`;

/* =====================================================================
   GRÁFICOS (SVG leve, sem bibliotecas)
   ===================================================================== */
const niceStep = raw => {
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
};
const dayLabel = n => { const d = new Date(n * DAY); return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}`; };
const dayISO = n => { const d = new Date(n * DAY); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };

const chartRegistry = {};
/* cfg: { series:[{name,color,width,dash,dots,points:[{x(dayNum),y}], interp}], dec } */
function lineChart(host, cfg) {
  const all = cfg.series.flatMap(s => s.points);
  if (!all.length) { host.innerHTML = '<div class="chart-empty">Sem dados para exibir ainda.</div>'; return; }
  const W = Math.max(260, host.clientWidth || 320), H = cfg.height || 230;
  const m = { l: 44, r: 14, t: 14, b: 28 };
  let x0 = Math.min(...all.map(p => p.x)), x1 = Math.max(...all.map(p => p.x));
  if (x0 === x1) { x0 -= 3; x1 += 3; }
  let y0 = Math.min(...all.map(p => p.y)), y1 = Math.max(...all.map(p => p.y));
  if (y0 === y1) { y0 -= 1; y1 += 1; }
  const padY = (y1 - y0) * 0.12;
  y0 -= padY; y1 += padY;
  const step = niceStep((y1 - y0) / 4);
  const yt0 = Math.floor(y0 / step) * step, yt1 = Math.ceil(y1 / step) * step;
  const sx = x => m.l + ((x - x0) / (x1 - x0)) * (W - m.l - m.r);
  const sy = y => H - m.b - ((y - yt0) / (yt1 - yt0)) * (H - m.t - m.b);
  const dec = cfg.dec ?? 1;
  let g = '';
  for (let v = yt0; v <= yt1 + 1e-9; v += step) {
    g += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${sy(v)}" y2="${sy(v)}"/><text class="axis" x="${m.l - 8}" y="${sy(v) + 4}" text-anchor="end">${fmtN(v, step < 1 ? 1 : 0)}</text>`;
  }
  const nx = W < 380 ? 3 : 5;
  for (let i = 0; i < nx; i++) {
    const xv = x0 + ((x1 - x0) * i) / (nx - 1);
    g += `<text class="axis" x="${sx(xv)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : i === nx - 1 ? 'end' : 'middle'}">${dayLabel(Math.round(xv))}</text>`;
  }
  let paths = '';
  cfg.series.forEach(s => {
    const pts = s.points.slice().sort((a, b) => a.x - b.x);
    if (!pts.length) return;
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
    if (pts.length > 1 && !s.noLine) paths += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''} stroke-linecap="round" stroke-linejoin="round"/>`;
    if (s.dots) paths += pts.map(p => `<circle cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="${s.dotR || 3.2}" fill="${s.dotFill || '#fff'}" stroke="${s.color}" stroke-width="1.6"/>`).join('');
  });
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(cfg.label || 'Gráfico')}">${g}${paths}<line class="cursor" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" style="display:none"/><rect class="hit" x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent"/></svg><div class="tip" style="display:none"></div>`;
  const svg = $('svg', host), tip = $('.tip', host), cur = $('.cursor', svg), hit = $('.hit', svg);
  const xs = [...new Set(all.filter(p => !cfg.series.find(s => s.points.includes(p) && s.interp)).map(p => p.x))].sort((a, b) => a - b);
  const valAt = (s, x) => {
    const exact = s.points.find(p => p.x === x);
    if (exact) return exact.y;
    if (!s.interp) return null;
    const pts = s.points.slice().sort((a, b) => a.x - b.x);
    if (x < pts[0].x || x > pts[pts.length - 1].x) return null;
    for (let i = 0; i < pts.length - 1; i++) if (x >= pts[i].x && x <= pts[i + 1].x) return pts[i].y + ((pts[i + 1].y - pts[i].y) * (x - pts[i].x)) / (pts[i + 1].x - pts[i].x || 1);
    return null;
  };
  const move = e => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const xv = x0 + ((px - m.l) / (W - m.l - m.r)) * (x1 - x0);
    const near = xs.reduce((a, b) => (Math.abs(b - xv) < Math.abs(a - xv) ? b : a), xs[0]);
    cur.setAttribute('x1', sx(near)); cur.setAttribute('x2', sx(near)); cur.style.display = '';
    const rows = cfg.series.map(s => { const v = valAt(s, near); return v == null ? '' : `<div><i style="background:${s.color}"></i>${esc(s.name)}: <b>${fmtN(v, dec)}${cfg.unit ? ' ' + cfg.unit : ''}</b></div>`; }).join('');
    tip.innerHTML = `<strong>${fmtDate(dayISO(near))}</strong>${rows}`;
    tip.style.display = '';
    const left = clamp((sx(near) / W) * r.width - tip.offsetWidth / 2, 0, r.width - tip.offsetWidth);
    tip.style.left = left + 'px';
  };
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerdown', move);
  hit.addEventListener('pointerleave', () => { tip.style.display = 'none'; cur.style.display = 'none'; });
}
/* cfg: { labels:[], values:[], color, dec, unit } */
function barChart(host, cfg) {
  const n = cfg.values.length;
  if (!n || cfg.values.every(v => v == null)) { host.innerHTML = '<div class="chart-empty">Sem dados para exibir ainda.</div>'; return; }
  const W = Math.max(260, host.clientWidth || 320), H = cfg.height || 170;
  const m = { l: 10, r: 10, t: 22, b: 26 };
  const vals = cfg.values.map(v => v ?? 0);
  const vmax = Math.max(0, ...vals), vmin = Math.min(0, ...vals);
  const span = (vmax - vmin) || 1;
  const sy = v => m.t + ((vmax - v) / span) * (H - m.t - m.b);
  const bw = (W - m.l - m.r) / n;
  const z = sy(0);
  let out = `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${z}" y2="${z}"/>`;
  cfg.values.forEach((v, i) => {
    const x = m.l + i * bw + bw * 0.2, w = bw * 0.6;
    if (v != null) {
      const y = sy(Math.max(v, 0)), h = Math.max(2, Math.abs(sy(v) - z));
      const neg = v < 0;
      out += `<rect x="${x.toFixed(1)}" y="${(neg ? z : y).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="5" fill="${neg ? (cfg.negColor || '#c9b6ea') : cfg.color}"/>`;
      out += `<text class="val" x="${(x + w / 2).toFixed(1)}" y="${(neg ? z + h + 12 : y - 6).toFixed(1)}" text-anchor="middle">${fmtN(v, cfg.dec ?? 0)}</text>`;
    }
    out += `<text class="axis" x="${(x + w / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(cfg.labels[i])}</text>`;
  });
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(cfg.label || 'Gráfico de barras')}">${out}</svg>`;
}
function drawCharts() {
  $$('[data-chart]').forEach(el => {
    const cfg = chartRegistry[el.dataset.chart];
    if (!cfg) return;
    if (cfg.type === 'bar') barChart(el, cfg); else lineChart(el, cfg);
  });
}
let chartSeq = 0;
function chartHost(cfg, extraClass = '') {
  const id = 'c' + (++chartSeq);
  chartRegistry[id] = cfg;
  return `<div class="chart ${extraClass}" data-chart="${id}"></div>`;
}

/* ---------- componentes ---------- */
function ring(pct, size = 132, label = '') {
  const r = 52, c = 2 * Math.PI * r, off = c * (1 - clamp(pct, 0, 100) / 100);
  return `<div class="ring" style="width:${size}px;height:${size}px" role="img" aria-label="${Math.round(pct)}% concluído">
    <svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="${r}" class="ring-bg"/><circle cx="60" cy="60" r="${r}" class="ring-fg" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" style="--from:${c.toFixed(1)}" transform="rotate(-90 60 60)"/></svg>
    <div class="ring-text"><strong>${Math.round(pct)}%</strong><span>${esc(label || 'do objetivo')}</span></div></div>`;
}
const progressBar = (pct, label) => `<div class="pbar" role="progressbar" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100" aria-label="${esc(label || 'Progresso')}"><i style="width:${clamp(pct, 0, 100)}%"></i></div>`;
const statusBadge = st => `<span class="badge ${STATUS[st].cls}"><span aria-hidden="true">${STATUS[st].emoji}</span>${STATUS[st].label}</span>`;
const emptyState = (title, text, btn = '') => `<div class="empty"><div class="empty-ic">${icon('leaf')}</div><h3>${esc(title)}</h3><p>${esc(text)}</p>${btn}</div>`;

/* =====================================================================
   TELAS
   ===================================================================== */
const ui = {
  tab: 'home', dietTab: 'plan', mealFilter: 'breakfast', sortMode: 'balanced', dayIdx: 0, showDay: false,
  foodQ: '', foodCat: 'all', exDay: new Date().getDay(), wRange: 'all', aRange: 90
};
const TABS = [
  { id: 'home', label: 'Início', ic: 'home' },
  { id: 'diet', label: 'Dieta', ic: 'diet' },
  { id: 'exercise', label: 'Exercícios', ic: 'dumbbell' },
  { id: 'weight', label: 'Peso', ic: 'scale' },
  { id: 'goals', label: 'Objetivos', ic: 'target' },
  { id: 'analytics', label: 'Análises', ic: 'chart' }
];
const DIET_LABEL = { yes: '🟢 Sim, completamente', partial: '🟡 Parcialmente', no: '🔴 Não' };
const DIET_SHORT = { yes: 'Seguiu a dieta', partial: 'Seguiu em parte', no: 'Não seguiu' };
const chip = (label, active, action, data = '') => `<button type="button" class="chip ${active ? 'on' : ''}" data-action="${action}" ${data} aria-pressed="${!!active}">${esc(label)}</button>`;
const sectionHead = (title, right = '') => `<div class="sec-head"><h2>${esc(title)}</h2>${right}</div>`;

const MOTTOS = ['Consistência vence intensidade.', 'Seu progresso está sendo construído.', 'Você está no caminho.', 'Um registro por vez.', 'Pequenos dias, grande resultado.'];

/* ---------------- INÍCIO ---------------- */
function viewHome() {
  const t = todayISO();
  const cur = currentW(), g = currentGoal(), m = g ? goalMetrics(g) : null, startW = S.profile.startWeight;
  const evo = cur != null && startW != null ? cur - startW : null;
  const ws = weightsSorted();
  const a7 = windowAvg(ws, t, 7) ?? (ws.length ? windowAvg(ws, ws[ws.length - 1].date, 7) : null);
  const low = ws.length ? Math.min(...ws.map(p => p.w)) : null;
  const wk = weekSummary(weekStart(t));
  const ds = dietStats(addDays(t, -29));
  const lg = S.logs[t] || {}, wo = S.workouts[t], rest = isRestDay(t);
  const weighedToday = S.weights.some(w => w.date === t);
  const trainedToday = !!(wo && wo.done);
  const cardioToday = trainedToday && +wo.cardioMin > 0;
  const goalDay = !!lg.diet && lg.diet !== 'no' && (rest || trainedToday);
  const checks = [
    { ok: !!lg.diet, label: 'Dieta registrada', hint: lg.diet ? DIET_SHORT[lg.diet] : 'Conte como foi a alimentação de hoje', act: 'log-open' },
    { ok: rest || trainedToday, label: rest && !trainedToday ? 'Dia de descanso' : 'Treino realizado', hint: trainedToday ? `${+wo.strengthMin || 0} min de musculação` : rest ? 'Recuperar também faz parte' : 'Registre seu treino de musculação', act: 'log-open' },
    { ok: rest || cardioToday, label: rest && !cardioToday ? 'Aeróbico opcional hoje' : 'Aeróbico realizado', hint: cardioToday ? `${+wo.cardioMin} min` : rest ? 'Uma caminhada leve ajuda' : 'Meta: 30 minutos na esteira', act: 'log-open' },
    { ok: weighedToday, label: 'Peso registrado', hint: weighedToday ? fmtW(S.weights.find(w => w.date === t).w) : 'Opcional, mas ajuda nas análises', act: 'weight-add' },
    { ok: goalDay, label: 'Meta do dia cumprida', hint: goalDay ? 'Dieta e treino do dia em dia' : 'Dieta seguida e treino do dia (ou descanso)', act: null }
  ];
  const doneCount = checks.filter(c => c.ok).length;
  const motto = doneCount === checks.length ? 'Mais um dia concluído.' : MOTTOS[(parseISO(t).getDate() + doneCount) % MOTTOS.length];
  const insights = buildInsights().slice(0, 5);
  const alerts = safetyAlerts().map(a => `<div class="alert" role="alert">${icon('alert')}<p>${esc(a)}</p></div>`).join('');

  const hero = `
  <section class="hero">
    <div class="hero-top">
      <div>
        <p class="muted">${S.profile.name ? `Olá, ${esc(S.profile.name)}. ` : ''}Peso atual</p>
        <div class="big-num">${cur != null ? fmtWn(cur) : '—'}<small>${unitName()}</small></div>
        ${evo != null ? `<p class="evo ${evo < -0.049 ? 'good' : ''}">${icon(evo < -0.049 ? 'down' : evo > 0.049 ? 'up' : 'check')}<span>${Math.abs(toU(evo)) < 0.05 ? 'Ponto de partida' : fmtDelta(evo) + ' desde o início'}</span></p>` : ''}
      </div>
      ${m ? ring(m.pct, 118, 'do objetivo') : ''}
    </div>
    ${m ? `<div class="hero-bar">${progressBar(m.pct, 'Progresso até o próximo objetivo')}<p class="muted sm">${fmtN(m.pct, 0)}% do caminho até ${fmtW(g.targetWeight)}</p></div>` : ''}
    <dl class="facts">
      <div><dt>Peso inicial</dt><dd>${fmtW(startW)}</dd></div>
      <div><dt>Próximo objetivo</dt><dd>${g ? fmtW(g.targetWeight) : '<button class="link" data-action="goal-new">Definir</button>'}</dd></div>
      <div><dt>Peso restante</dt><dd>${m ? fmtW(m.remaining) : '—'}</dd></div>
    </dl>
  </section>`;

  const stat = (label, val, sub = '') => `<div class="stat"><span class="stat-l">${esc(label)}</span><strong>${val}</strong>${sub ? `<span class="stat-s">${esc(sub)}</span>` : ''}</div>`;
  const stats = `
  <section class="stats" aria-label="Indicadores">
    ${stat('Dias de acompanhamento', trackingDays())}
    ${stat('Treinos na semana', `${wk.count}<small>/6</small>`)}
    ${stat('Musculação', `${wk.strength}<small> min</small>`, 'nesta semana')}
    ${stat('Aeróbico', `${wk.cardio}<small> min</small>`, 'nesta semana')}
    ${stat('Adesão à dieta', ds.pct != null ? `${ds.pct}<small>%</small>` : '—', ds.total ? `${ds.total} dias, últimos 30` : 'sem registros')}
    ${stat('Sequência', `${streak()}<small> ${streak() === 1 ? 'dia' : 'dias'}</small>`, 'dias registrados')}
    ${stat('Média de 7 dias', a7 != null ? fmtW(a7) : '—')}
    ${stat('Menor peso', low != null ? fmtW(low) : '—')}
  </section>`;

  const today = `
  <section class="today">
    ${sectionHead('Resumo de hoje', `<span class="muted sm">${fmtLong(t)}</span>`)}
    <ul class="checks">
      ${checks.map(c => `<li class="${c.ok ? 'ok' : ''}"><span class="mark" aria-hidden="true">${c.ok ? icon('check') : ''}</span>
        <div class="grow"><strong>${esc(c.label)}</strong><span>${esc(c.hint)}</span></div>
        <span class="sr-only">${c.ok ? 'Concluído' : 'Pendente'}</span>
        ${!c.ok && c.act ? `<button class="mini" data-action="${c.act}">Registrar</button>` : ''}</li>`).join('')}
    </ul>
    <div class="today-foot"><p class="motto">${esc(motto)}</p><button class="btn primary" data-action="log-open">${icon('book')}Registrar meu dia</button></div>
  </section>`;

  const ins = `
  <section>
    ${sectionHead('O que seus dados mostram')}
    ${insights.length ? `<ul class="insights">${insights.map(i => `<li>${icon('leaf')}<span>${esc(i)}</span></li>`).join('')}</ul>` : `<p class="muted">Registre seu peso, seus treinos e sua dieta para ver análises automáticas aqui.</p>`}
  </section>`;

  const jr = `<section class="jr-link"><div><strong>Minha jornada</strong><span class="muted">${g ? `Objetivo atual: ${esc(g.name)}` : 'Veja as etapas do seu caminho'}</span></div><button class="btn soft" data-action="go" data-tab="goals">Ver jornada</button></section>`;
  return `<div class="page">${alerts}${hero}${today}${stats}${ins}${jr}</div>`;
}

/* ---------------- DIETA ---------------- */
function viewDiet() {
  const s = S.settings;
  const goals = `
  <section class="targets">
    <div><span class="muted sm">Calorias por dia</span><strong>${fmtN(s.kcalMin, 0)}–${fmtN(s.kcalMax, 0)}<small> kcal</small></strong></div>
    <div><span class="muted sm">Proteína por dia</span><strong>${fmtN(s.protMin, 0)}–${fmtN(s.protMax, 0)}<small> g</small></strong></div>
    <p class="muted sm grow-full">${icon('info')}Metas de referência. Ajuste quando precisar em <button class="link" data-action="go-settings">Configurações</button>.</p>
  </section>`;
  const seg = `<div class="tabs3" role="tablist">${[['plan', 'Plano'], ['menu', 'Cardápio'], ['foods', 'Meus alimentos']].map(([id, l]) => `<button role="tab" aria-selected="${ui.dietTab === id}" class="${ui.dietTab === id ? 'on' : ''}" data-action="diet-tab" data-v="${id}">${l}</button>`).join('')}</div>`;
  let body = '';
  if (ui.dietTab === 'plan') body = dietPlanHtml();
  else if (ui.dietTab === 'menu') body = dietMenuHtml();
  else body = dietFoodsHtml();
  return `<div class="page">${goals}${seg}<div id="diet-body">${body}</div></div>
  <button class="fab" data-action="food-add">${icon('plus')}<span>Cadastrar alimento</span></button>`;
}
function dietPlanHtml() {
  return `<div class="stack">${MEAL_PLAN.map(m => `
    <details class="meal" ${m.id === 'breakfast' ? 'open' : ''}>
      <summary><span class="meal-name">${esc(m.name)}</span><span class="pill">${m.min}–${m.max} kcal</span>${icon('chevron', 'chev')}</summary>
      <ul class="plain">${m.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
      <button class="btn soft sm" data-action="meal-suggest" data-v="${m.id}">Ver combinações com meus alimentos</button>
    </details>`).join('')}</div>`;
}
function mealGroupOf(id) { return id.startsWith('snack') ? 'snack' : id; }
function dietMenuHtml() {
  const filters = [['breakfast', 'Café da manhã'], ['snack', 'Lanche'], ['lunch', 'Almoço'], ['dinner', 'Jantar']];
  const sorts = [['balanced', 'Equilibradas'], ['protein', 'Maior proteína'], ['lowcal', 'Menor caloria']];
  const f = `<div class="chips" role="group" aria-label="Refeição">${filters.map(([id, l]) => chip(l, ui.mealFilter === id, 'meal-filter', `data-v="${id}"`)).join('')}</div>
    <div class="chips" role="group" aria-label="Ordenar">${sorts.map(([id, l]) => chip(l, ui.sortMode === id, 'sort-mode', `data-v="${id}"`)).join('')}</div>`;
  if (!S.foods.length) {
    return `${f}${emptyState('Cadastre seus alimentos', 'As sugestões usam o que você tem em casa. Comece pelos mais comuns.', `<div class="row-btns"><button class="btn primary" data-action="foods-common">Adicionar alimentos comuns</button><button class="btn ghost" data-action="food-add">Cadastrar um alimento</button></div>`)}`;
  }
  const ids = ui.mealFilter === 'snack' ? ['snack_am', 'snack_pm'] : [ui.mealFilter];
  const groups = ids.map(id => {
    const meal = MEAL_BY_ID[id];
    const list = suggestMeals(id, ui.sortMode, 6);
    return `<section class="menu-group"><div class="sec-head"><h3>${esc(meal.name)}</h3><span class="pill">${meal.min}–${meal.max} kcal</span></div>
      ${list.length ? `<div class="stack">${list.map(c => comboCard(c)).join('')}</div>` : `<p class="muted note-box">${icon('info')}<span>${esc(missingHint(id))}</span></p>`}</section>`;
  }).join('');
  const day = ui.showDay ? dayBuilderHtml() : '';
  return `${f}${groups}
    <section class="day-box">
      <div class="sec-head"><h3>Dia completo</h3><div class="row-btns tight">${ui.showDay ? `<button class="btn soft sm" data-action="day-next">${icon('shuffle')}Outro dia</button>` : `<button class="btn soft sm" data-action="day-show">Montar um dia</button>`}</div></div>
      ${day || '<p class="muted sm">Veja uma sugestão de cinco refeições e quanto elas somam em relação às suas metas.</p>'}
    </section>`;
}
function comboCard(c) {
  return `<article class="combo">
    <ul class="plain">${c.items.map(it => `<li>${esc(itemText(it))}</li>`).join('')}</ul>
    <div class="macros"><span><b>${Math.round(c.kcal)}</b> kcal</span><span><b>${fmtN(c.p, 0)}</b> g proteína</span><span><b>${fmtN(c.c, 0)}</b> g carboidrato</span><span><b>${fmtN(c.f, 0)}</b> g gordura</span></div>
    ${c.approx ? '<p class="muted sm">Aproximada: fica um pouco fora da faixa da refeição.</p>' : ''}
  </article>`;
}
function missingHint(id) {
  const need = {
    breakfast: 'ovo ou iogurte, pão ou aveia e uma fruta',
    snack_am: 'uma fruta e ovo, aveia ou iogurte',
    snack_pm: 'iogurte, fruta e aveia (ou pão com queijo)',
    lunch: 'uma proteína, arroz ou batata e legumes',
    dinner: 'uma proteína, arroz ou batata e legumes'
  }[id];
  return `Ainda não encontrei combinações realistas. Cadastre ${need}, cada um na categoria certa, e confira a quantidade disponível.`;
}
function dayBuilderHtml() {
  const d = buildDay(ui.dayIdx);
  const s = S.settings;
  const kOk = d.kcal >= s.kcalMin * 0.95 && d.kcal <= s.kcalMax * 1.05;
  const pOk = d.p >= s.protMin;
  return `<div class="stack">${d.meals.map(m => `<div class="day-row"><strong>${esc(m.name)}</strong>${m.combo ? `<span>${esc(m.combo.items.map(itemText).join(', '))}</span><em>${Math.round(m.combo.kcal)} kcal, ${fmtN(m.combo.p, 0)} g de proteína</em>` : '<span class="muted">Sem combinação com os alimentos atuais.</span>'}</div>`).join('')}
    <div class="day-total"><div><span class="muted sm">Total estimado</span><strong>${Math.round(d.kcal)} kcal</strong><span class="sm">${kOk ? 'dentro da meta' : d.kcal < s.kcalMin ? 'abaixo da meta' : 'acima da meta'} (${fmtN(s.kcalMin, 0)}–${fmtN(s.kcalMax, 0)})</span></div>
    <div><span class="muted sm">Proteína</span><strong>${fmtN(d.p, 0)} g</strong><span class="sm">${pOk ? 'dentro da meta' : 'abaixo da meta'} (${fmtN(s.protMin, 0)}–${fmtN(s.protMax, 0)})</span></div></div>
    ${d.complete ? '' : '<p class="muted sm">Faltam alimentos para completar todas as refeições.</p>'}
    <p class="muted sm">Estimativas com base nos valores que você cadastrou. Ajuste porções ao seu apetite e à orientação do seu profissional.</p></div>`;
}
function filteredFoods() {
  const q = norm(ui.foodQ.trim());
  return S.foods.filter(f => (ui.foodCat === 'all' || f.cat === ui.foodCat) && (!q || norm(f.name).includes(q) || norm(f.note || '').includes(q)))
    .sort((a, b) => norm(a.name).localeCompare(norm(b.name)));
}
function foodListHtml() {
  const list = filteredFoods();
  if (!S.foods.length) return emptyState('Nenhum alimento cadastrado', 'Cadastre o que você tem em casa para gerar sugestões de cardápio.', `<div class="row-btns"><button class="btn primary" data-action="foods-common">Adicionar alimentos comuns</button><button class="btn ghost" data-action="food-add">Cadastrar um alimento</button></div>`);
  if (!list.length) return `<p class="muted center">Nenhum alimento encontrado para esse filtro.</p>`;
  return `<ul class="foods">${list.map(f => {
    const avail = f.qty != null && f.qty !== '' ? `${fmtN(+f.qty, +f.qty % 1 ? 1 : 0)} ${f.unit}` : 'quantidade livre';
    return `<li class="food"><div class="grow"><strong>${esc(f.name)}</strong>
      <span class="muted sm">${esc(catLabel(f.cat))}, ${esc(avail)}</span>
      <span class="food-m">${fmtN(f.kcal, 0)} kcal, P ${fmtN(f.p, 1)}, C ${fmtN(f.c, 1)}, G ${fmtN(f.f, 1)} <em>por 100 g</em></span>
      ${f.note ? `<span class="muted sm">${esc(f.note)}</span>` : ''}</div>
      <div class="row-act"><button class="icon-btn" data-action="food-edit" data-id="${f.id}" aria-label="Editar ${esc(f.name)}">${icon('edit')}</button><button class="icon-btn" data-action="food-del" data-id="${f.id}" aria-label="Excluir ${esc(f.name)}">${icon('trash')}</button></div></li>`;
  }).join('')}</ul>`;
}
function dietFoodsHtml() {
  return `<div class="searchbar">${icon('search')}<input id="food-q" type="search" placeholder="Buscar alimento" value="${esc(ui.foodQ)}" aria-label="Buscar alimento"></div>
    <div class="chips" role="group" aria-label="Categoria">${chip('Todos', ui.foodCat === 'all', 'food-cat', 'data-v="all"')}${CATS.map(c => chip(c.label, ui.foodCat === c.id, 'food-cat', `data-v="${c.id}"`)).join('')}</div>
    <div id="food-list">${foodListHtml()}</div>
    ${S.foods.length ? `<button class="link" data-action="foods-common">Adicionar mais alimentos comuns</button>` : ''}`;
}

/* ---------------- EXERCÍCIOS ---------------- */
function dateOfWeekday(dow) { return addDays(weekStart(todayISO()), (dow + 6) % 7); }
function viewExercise() {
  const t = todayISO();
  const wk = weekSummary(weekStart(t));
  const dow = ui.exDay;
  const plan = WEEK_PLAN[dow];
  const date = dateOfWeekday(dow);
  const wo = S.workouts[date];
  const strip = `<div class="week-strip" role="tablist" aria-label="Dias da semana">${DAY_ORDER.map(d => {
    const dt = dateOfWeekday(d), done = S.workouts[dt] && S.workouts[dt].done;
    return `<button role="tab" aria-selected="${d === dow}" class="wd ${d === dow ? 'on' : ''} ${dt === t ? 'today' : ''} ${done ? 'done' : ''}" data-action="ex-day" data-v="${d}"><span>${WD[d]}</span><b>${parseISO(dt).getDate()}</b><i aria-hidden="true">${done ? icon('check') : ''}</i><span class="sr-only">${done ? 'treino feito' : ''}</span></button>`;
  }).join('')}</div>`;
  let content = '';
  if (plan.rest) {
    content = `<section class="rest-card">${icon('leaf')}<div><h3>Dia de descanso</h3><p>Recuperar faz parte do processo. Se quiser, uma caminhada leve é bem-vinda.</p></div></section>
      <button class="btn soft" data-action="log-open" data-date="${date}">Registrar o dia</button>`;
  } else {
    content = `<section class="day-head"><div><h3>${esc(plan.group)}</h3><p class="muted">30 min de aeróbico + cerca de 30 min de musculação</p></div></section>
      <section class="cardio">${icon('clock')}<div><strong>Aeróbico na esteira</strong><span class="muted sm">Velocidade de referência: 6,5–6,7 km/h. Registre duração, distância e velocidade.</span></div></section>
      <div class="stack">${['A', 'B', 'C'].map(v => {
        const did = wo && wo.done && wo.day === dow && wo.variant === v;
        const future = date > t;
        return `<article class="wk ${did ? 'did' : ''}"><div class="wk-head"><h4>Treino ${v}</h4>${did ? `<span class="badge ok">${icon('check')}Realizado</span>` : ''}</div>
          <ul class="plain">${plan[v].map(e => `<li>${esc(e)}</li>`).join('')}</ul>
          <button class="btn ${did ? 'ghost' : 'soft'} sm" data-action="log-open" data-date="${date}" data-day="${dow}" data-variant="${v}" ${future ? 'disabled' : ''}>${did ? 'Editar registro' : future ? 'Disponível no dia' : `Fiz o treino ${v}`}</button></article>`;
      }).join('')}</div>
      <p class="muted sm">Os três treinos trabalham os mesmos grupos musculares com exercícios diferentes. Escolha o que combina com o seu dia.</p>`;
  }
  const summary = `<section class="week-sum">${sectionHead('Esta semana')}
    <div class="stats three"><div class="stat"><span class="stat-l">Treinos</span><strong>${wk.count}<small>/6</small></strong></div><div class="stat"><span class="stat-l">Musculação</span><strong>${wk.strength}<small> min</small></strong></div><div class="stat"><span class="stat-l">Aeróbico</span><strong>${wk.cardio}<small> min</small></strong></div></div></section>`;
  return `<div class="page">${strip}${content}${summary}</div>`;
}

/* ---------------- PESO ---------------- */
function rangedWeights(range) {
  const ws = weightsSorted();
  if (range === 'all') return ws;
  const from = addDays(todayISO(), -(range - 1));
  return ws.filter(p => p.date >= from);
}
function viewWeight() {
  const ws = weightsSorted();
  if (!ws.length) {
    return `<div class="page"><section class="first-weight"><h2>Qual é seu peso inicial?</h2><p class="muted">Esse é o ponto de partida da sua jornada. Você pode registrar novos pesos quando quiser.</p>
      <form class="inline-form" data-form="first-weight" novalidate>
        <div class="row2">${field('Peso (' + unitName() + ')', numInput('w', '', 'placeholder="Ex.: 115,0" required'))}${field('Data', dateInput('date', todayISO()))}</div>
        <button class="btn primary" type="submit">Salvar peso inicial</button></form></section></div>`;
  }
  const t = todayISO();
  const startW = S.profile.startWeight ?? ws[0].w, cur = ws[ws.length - 1].w;
  const lowW = Math.min(...ws.map(p => p.w)), highW = Math.max(...ws.map(p => p.w));
  const a7 = windowAvg(ws, ws[ws.length - 1].date, 7);
  const stats = `<section class="stats three">
    ${[['Peso inicial', fmtW(startW)], ['Peso atual', fmtW(cur)], ['Menor peso', fmtW(lowW)], ['Maior peso', fmtW(highW)], ['Diferença total', fmtDelta(cur - startW)], ['Média de 7 dias', fmtW(a7)]].map(([l, v]) => `<div class="stat"><span class="stat-l">${l}</span><strong class="sm-num">${v}</strong></div>`).join('')}</section>`;
  const ma = maSeries(ws);
  const range = ui.wRange;
  const from = range === 'all' ? '0000-00-00' : addDays(t, -(range - 1));
  const real = ws.filter(p => p.date >= from).map(p => ({ x: dayNum(p.date), y: toU(p.w) }));
  const mas = ma.filter(p => p.date >= from).map(p => ({ x: dayNum(p.date), y: toU(p.w) }));
  const series = [
    { name: 'Peso registrado', color: '#7c5cc4', width: 1.4, dots: true, points: real },
    { name: 'Média móvel de 7 dias', color: '#1f9d8b', width: 3, points: mas }
  ];
  const g = currentGoal();
  if (g && real.length) {
    const x0 = Math.min(...real.map(p => p.x)), x1 = Math.max(...real.map(p => p.x), x0 + 1);
    series.push({ name: 'Objetivo', color: '#8a97a3', width: 1.6, dash: '5 5', interp: true, points: [{ x: x0, y: toU(g.targetWeight) }, { x: x1, y: toU(g.targetWeight) }] });
  }
  const chart = `<section>${sectionHead('Evolução', `<div class="chips tight">${[[30, '30 dias'], [90, '90 dias'], ['all', 'Tudo']].map(([v, l]) => chip(l, range === v, 'w-range', `data-v="${v}"`)).join('')}</div>`)}
    ${chartHost({ type: 'line', series, unit: unitName(), dec: 1, label: 'Evolução do peso' })}
    <ul class="legend"><li><i class="dot"></i>Pontos: peso registrado</li><li><i class="ln"></i>Linha cheia: média móvel de 7 dias</li>${g ? '<li><i class="ln dash"></i>Tracejada: peso do objetivo</li>' : ''}</ul>
    <p class="muted sm">A média móvel suaviza as oscilações naturais do peso, como retenção de líquidos. Acompanhe a tendência, não só o último número.</p></section>`;
  const add = `<form class="inline-form add-w" data-form="quick-weight" novalidate>${field('Peso (' + unitName() + ')', numInput('w', '', 'placeholder="Ex.: 114,2"'))}${field('Data', dateInput('date', t))}<button class="btn primary" type="submit">${icon('plus')}Registrar</button></form>`;
  const hist = [...ws].reverse();
  const hlist = `<section>${sectionHead('Histórico', `<span class="muted sm">${ws.length} ${ws.length === 1 ? 'registro' : 'registros'}</span>`)}
    <ul class="hist">${hist.map((p, i) => {
      const prev = hist[i + 1];
      const d = prev ? p.w - prev.w : null;
      return `<li><div class="grow"><strong>${fmtW(p.w)}</strong><span class="muted sm">${fmtDate(p.date)}, ${WD_LONG[parseISO(p.date).getDay()].toLowerCase()}</span></div>
        <span class="delta ${d == null ? '' : d < -0.049 ? 'good' : d > 0.049 ? 'bad' : ''}">${d == null ? 'início' : fmtDelta(d)}</span>
        <div class="row-act"><button class="icon-btn" data-action="weight-edit" data-id="${p.id}" aria-label="Editar registro de ${fmtDate(p.date)}">${icon('edit')}</button><button class="icon-btn" data-action="weight-del" data-id="${p.id}" aria-label="Excluir registro de ${fmtDate(p.date)}">${icon('trash')}</button></div></li>`;
    }).join('')}</ul></section>`;
  return `<div class="page">${add}${stats}${chart}${hlist}</div>`;
}

/* ---------------- OBJETIVOS ---------------- */
function goalCard(g, isCurrent) {
  const m = goalMetrics(g);
  const st = STATUS[m.status];
  const ms = goalMilestones(g);
  const tl = `<ol class="timeline ${ms.length > 9 ? 'scroll' : ''}">${ms.map((x, i) => `<li class="${x.reached ? 'reached' : ''} ${x.current ? 'now' : ''}"><span class="tl-dot" aria-hidden="true">${x.reached ? icon('check') : ''}</span><div><strong>${i === 0 ? 'Início' : i === ms.length - 1 ? 'Objetivo' : `Semana ${x.week}`}</strong><span class="muted sm">${fmtW(x.weight)}, ${fmtDate(x.date)}${x.reached && i > 0 ? ', atingida' : x.current ? ', próxima meta' : ''}</span></div></li>`).join('')}</ol>`;
  const rows = [
    ['Peso inicial', fmtW(g.startWeight)], ['Peso objetivo', fmtW(g.targetWeight)], ['Previsão de conclusão', fmtDate(m.end)],
    ['A perder no total', fmtW(m.total)], ['Perda necessária por semana', fmtW(m.perWeek, 2)], ['Perda necessária por dia', fmtW(m.perDay, 2)],
    ['Já perdido', fmtW(Math.max(0, m.lost))], ['Ritmo atual', m.rate != null ? `${fmtDelta(m.rate)}/sem` : 'sem dados suficientes'],
    ['Previsão com ritmo atual', m.projection ? fmtDate(m.projection) : '—'], ['Dias restantes', m.done ? '—' : m.daysLeft]
  ];
  return `<article class="goal ${m.status}">
    <div class="goal-head"><div><h3>${esc(g.name)}</h3><span class="muted sm">${fmtDate(g.startDate)} até ${fmtDate(m.end)}, ${g.weeks} ${g.weeks === 1 ? 'semana' : 'semanas'}</span></div>${statusBadge(m.status)}</div>
    <div class="goal-main"><strong>${m.done ? 'Objetivo concluído' : `${fmtW(m.remaining)} restantes`}</strong><span>${fmtN(m.pct, 0)}% concluído</span></div>
    ${progressBar(m.pct, 'Progresso do objetivo')}
    <p class="pace"><b>${esc(m.timing)}.</b> ${esc(m.pace)}</p>
    ${isCurrent ? '<span class="tag">Objetivo atual</span>' : ''}
    <dl class="kv">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
    <details class="tl-wrap" ${isCurrent ? 'open' : ''}><summary>Linha do tempo e metas semanais${icon('chevron', 'chev')}</summary>${tl}</details>
    <div class="row-btns">${m.done ? `<button class="btn soft sm" data-action="goal-celebrate" data-id="${g.id}">${icon('trophy')}Ver conquista</button>` : (!isCurrent ? `<button class="btn soft sm" data-action="goal-current" data-id="${g.id}">Definir como atual</button>` : '')}
    <button class="btn ghost sm" data-action="goal-edit" data-id="${g.id}">${icon('edit')}Editar</button><button class="btn ghost sm" data-action="goal-del" data-id="${g.id}">${icon('trash')}Excluir</button></div>
  </article>`;
}
function journeyHtml() {
  const stages = journeyStages();
  if (!stages.length) return '';
  const cur = currentW();
  return `<ol class="journey">${stages.map(s => {
    let ic = 'lock', txt = 'Bloqueada', extra = '';
    if (s.state === 'start') { ic = 'flag'; txt = 'Ponto de partida'; }
    else if (s.state === 'done') { ic = 'check'; txt = 'Conquistada'; }
    else if (s.state === 'current') { ic = 'target'; txt = 'Objetivo atual'; const m = goalMetrics(s.goal); extra = `<span class="muted sm">${fmtW(m.remaining)} restantes</span>`; }
    else if (s.state === 'planned') { ic = 'flag'; txt = 'Objetivo cadastrado'; }
    else if (s.state === 'unlocked') { ic = 'plus'; txt = 'Desbloqueada'; extra = `<button class="mini" data-action="goal-new" data-target="${s.weight}">Criar objetivo</button>`; }
    return `<li class="st ${s.state}"><span class="st-dot" aria-hidden="true">${icon(ic)}</span><div class="st-body"><strong>${fmtW(s.weight, Number.isInteger(toU(s.weight)) ? 0 : 1)}</strong><span class="muted sm">${txt}${s.state === 'start' && cur != null ? `, hoje ${fmtW(cur)}` : ''}</span>${extra}</div></li>`;
  }).join('')}</ol>`;
}
function viewGoals() {
  const cg = currentGoal();
  const open = S.goals.filter(g => !g.completedDate && g !== cg);
  const done = S.goals.filter(g => g.completedDate);
  return `<div class="page">
    <div class="sec-head big"><h2>Seus objetivos</h2><button class="btn primary" data-action="goal-new">${icon('plus')}Novo objetivo</button></div>
    ${cg ? goalCard(cg, true) : (S.goals.length ? '' : emptyState('Defina seu primeiro objetivo', 'Escolha o peso que quer alcançar e o prazo. Calculamos o ritmo e as metas semanais.', `<button class="btn primary" data-action="goal-new">Criar objetivo</button>`))}
    <section>${sectionHead('Minha jornada')}${journeyHtml()}<p class="muted sm">As próximas etapas ficam bloqueadas até você concluir a anterior.</p></section>
    ${open.length ? `<section>${sectionHead('Outros objetivos')}<div class="stack">${open.map(g => goalCard(g, false)).join('')}</div></section>` : ''}
    ${done.length ? `<section>${sectionHead('Conquistados')}<div class="stack">${done.map(g => goalCard(g, false)).join('')}</div></section>` : ''}
  </div>`;
}

/* ---------------- ANÁLISES ---------------- */
function viewAnalytics() {
  const t = todayISO();
  const ws = weightsSorted(), ma = maSeries(ws);
  const range = ui.aRange;
  const from = range === 'all' ? '0000-00-00' : addDays(t, -(range - 1));
  const real = ws.filter(p => p.date >= from).map(p => ({ x: dayNum(p.date), y: toU(p.w) }));
  const mas = ma.filter(p => p.date >= from).map(p => ({ x: dayNum(p.date), y: toU(p.w) }));
  const series = [
    { name: 'Peso real', color: '#7c5cc4', width: 1.4, dots: true, points: real },
    { name: 'Média móvel de 7 dias', color: '#1f9d8b', width: 3, points: mas }
  ];
  const g = currentGoal();
  if (g && real.length) {
    const dmin = Math.min(...real.map(p => p.x)), dmax = Math.max(...real.map(p => p.x));
    const gs = dayNum(g.startDate), ge = dayNum(goalEnd(g));
    const f = x => toU(g.startWeight) + ((toU(g.targetWeight) - toU(g.startWeight)) * (x - gs)) / (ge - gs);
    const a = Math.max(gs, dmin), b = Math.min(ge, dmax);
    if (a < b) series.push({ name: 'Meta (trajetória)', color: '#8a97a3', width: 1.8, dash: '6 5', interp: true, points: [{ x: a, y: f(a) }, { x: b, y: f(b) }] });
  }
  const wChart = `<section>${sectionHead('Evolução do peso', `<div class="chips tight">${[[30, '30 dias'], [90, '90 dias'], ['all', 'Tudo']].map(([v, l]) => chip(l, range === v, 'a-range', `data-v="${v}"`)).join('')}</div>`)}
    ${chartHost({ type: 'line', series, unit: unitName(), dec: 1, label: 'Peso real, média móvel e meta' })}
    <ul class="legend"><li><i class="dot"></i>Pontos: peso real</li><li><i class="ln"></i>Linha cheia: média móvel de 7 dias</li>${g ? '<li><i class="ln dash"></i>Tracejada: trajetória da meta</li>' : ''}</ul></section>`;

  const weeks = [];
  for (let i = 7; i >= 0; i--) weeks.push(weekSummary(addDays(weekStart(t), -7 * i)));
  const loss = weeks.map((w, i) => (i > 0 && w.avgWeight != null && weeks[i - 1].avgWeight != null ? toU(weeks[i - 1].avgWeight - w.avgWeight) : null));
  const labels = weeks.map(w => fmtShort(w.start));
  const weekly = `<section>${sectionHead('Evolução semanal')}
    <p class="muted sm">Perda por semana (diferença entre as médias semanais, em ${unitName()}). Valores positivos indicam perda.</p>
    ${chartHost({ type: 'bar', labels, values: loss.map(v => (v == null ? null : round1(v))), color: '#7fcfc2', dec: 1, label: 'Perda por semana' })}
    <div class="wk-table" role="table" aria-label="Resumo semanal"><div class="wk-row head" role="row"><span>Semana</span><span>Peso médio</span><span>Treinos</span><span>Musc.</span><span>Aerób.</span></div>
    ${[...weeks].reverse().map(w => `<div class="wk-row" role="row"><span>${fmtShort(w.start)}</span><span>${w.avgWeight != null ? fmtWn(w.avgWeight) : '—'}</span><span>${w.count}</span><span>${w.strength} min</span><span>${w.cardio} min</span></div>`).join('')}</div></section>`;

  const ds = dietStats(range === 'all' ? null : from), ta = trainAdherence(28);
  const adh = `<section class="two">
    <div class="adh">${sectionHead('Adesão à dieta')}${ds.total ? `${ring(ds.pct, 104, 'adesão')}<ul class="plain sm"><li>🟢 Completa: ${ds.yes}</li><li>🟡 Parcial: ${ds.partial}</li><li>🔴 Fora do plano: ${ds.no}</li></ul><p class="muted sm">${ds.total} dias registrados. Parcial vale meio ponto.</p>` : '<p class="muted sm">Registre como foi sua alimentação para ver a adesão.</p>'}</div>
    <div class="adh">${sectionHead('Adesão ao treino')}${ta.planned ? `${ring(ta.pct, 104, 'treinos')}<p class="sm"><b>${Math.min(ta.done, ta.planned)}</b> de <b>${ta.planned}</b> treinos planejados nos últimos 28 dias.</p>` : '<p class="muted sm">Sem dias planejados ainda.</p>'}</div></section>`;

  const cardio = `<section>${sectionHead('Aeróbico por semana')}${chartHost({ type: 'bar', labels, values: weeks.map(w => w.cardio), color: '#9ad4cb', dec: 0, label: 'Minutos de aeróbico por semana' })}<p class="muted sm">Minutos totais por semana.</p></section>`;
  const strength = `<section>${sectionHead('Musculação por semana')}${chartHost({ type: 'bar', labels, values: weeks.map(w => w.strength), color: '#c9b6ea', dec: 0, label: 'Minutos de musculação por semana' })}<p class="muted sm">Minutos totais por semana.</p></section>`;

  const ins = buildInsights();
  const insHtml = `<section>${sectionHead('Insights')}${ins.length ? `<ul class="insights">${ins.map(i => `<li>${icon('leaf')}<span>${esc(i)}</span></li>`).join('')}</ul>` : '<p class="muted">Os insights aparecem conforme você registra seus dados.</p>'}</section>`;

  const dates = [...new Set([...Object.keys(S.logs), ...Object.keys(S.workouts)])].sort().reverse().slice(0, 15);
  const diary = `<section>${sectionHead('Diário recente')}${dates.length ? `<ul class="hist diary">${dates.map(d => {
    const l = S.logs[d] || {}, w = S.workouts[d];
    const bits = [];
    if (w && w.done) bits.push(`Treino${w.variant ? ' ' + w.variant : ''}: ${+w.strengthMin || 0} min musc., ${+w.cardioMin || 0} min aeróbico`);
    else if (w) bits.push('Sem treino');
    if (l.diet) bits.push(DIET_LABEL[l.diet]);
    return `<li><div class="grow"><strong>${fmtDate(d)}, ${WD[parseISO(d).getDay()]}</strong><span class="sm">${esc(bits.join(' | ') || 'Registro')}</span>${l.note ? `<span class="muted sm note">“${esc(l.note)}”</span>` : ''}</div>
      <div class="row-act"><button class="icon-btn" data-action="log-open" data-date="${d}" aria-label="Editar registro de ${fmtDate(d)}">${icon('edit')}</button><button class="icon-btn" data-action="log-del" data-date="${d}" aria-label="Excluir registro de ${fmtDate(d)}">${icon('trash')}</button></div></li>`;
  }).join('')}</ul>` : '<p class="muted">Nenhum registro diário ainda. Use “Registrar meu dia” na tela inicial.</p>'}</section>`;
  return `<div class="page">${wChart}${weekly}${adh}${cardio}${strength}${insHtml}${diary}</div>`;
}

/* ---------------- CONFIGURAÇÕES ---------------- */
function viewSettings() {
  const s = S.settings, open = S.goals.filter(g => !g.completedDate), cg = currentGoal();
  return `<div class="page narrow">
    <div class="sec-head big"><h2>Configurações</h2><button class="btn ghost sm" data-action="go" data-tab="home">${icon('x')}Fechar</button></div>
    <form id="settings-form" class="stack" novalidate>
      <section class="panel"><h3>Perfil</h3>
        ${field('Nome (opcional)', textInput('name', S.profile.name || '', 'autocomplete="given-name" maxlength="30"'))}
        ${field('Peso inicial (' + unitName() + ')', numInput('startWeight', inputW(S.profile.startWeight)))}
        ${field('Unidade de peso', segmented('unit', [{ v: 'kg', t: 'Quilos (kg)' }, { v: 'lb', t: 'Libras (lb)' }], s.unit))}
        ${field('Meta de longo prazo (' + unitName() + ', opcional)', numInput('finalWeight', inputW(S.profile.finalWeight)), 'Define até onde vai o desenho da sua jornada.')}
      </section>
      <section class="panel"><h3>Metas da dieta</h3>
        <div class="row2">${field('Calorias, mínimo', numInput('kcalMin', s.kcalMin))}${field('Calorias, máximo', numInput('kcalMax', s.kcalMax))}</div>
        <div class="row2">${field('Proteína, mínimo (g)', numInput('protMin', s.protMin))}${field('Proteína, máximo (g)', numInput('protMax', s.protMax))}</div>
        <p class="muted sm">São valores de referência para acompanhamento, não uma prescrição.</p>
      </section>
      <section class="panel"><h3>Objetivo atual</h3>
        ${open.length ? field('Objetivo em foco', selectInput('currentGoalId', open.map(g => ({ v: g.id, t: `${g.name} (${fmtW(g.targetWeight)})` })), cg ? cg.id : '')) : '<p class="muted sm">Nenhum objetivo em andamento. Crie um na aba Objetivos.</p>'}
        <div class="row-btns"><button type="button" class="btn soft sm" data-action="goal-new">Novo objetivo</button>${cg ? `<button type="button" class="btn ghost sm" data-action="goal-edit" data-id="${cg.id}">Editar objetivo atual</button>` : ''}</div>
      </section>
      <button class="btn primary block" type="submit">Salvar configurações</button>
    </form>
    <section class="panel"><h3>Seus dados</h3>
      <ul class="plain sm"><li>${S.weights.length} registros de peso</li><li>${S.foods.length} alimentos cadastrados</li><li>${S.goals.length} objetivos</li><li>${Object.keys(S.logs).length} dias de diário e ${Object.values(S.workouts).filter(w => w.done).length} treinos</li></ul>
      <p class="muted sm">Os dados ficam apenas neste navegador. Exporte uma cópia de vez em quando para não perder nada.</p>
      <div class="row-btns"><button class="btn soft" data-action="export">${icon('download')}Exportar dados (JSON)</button><label class="btn soft file-btn">${icon('upload')}Importar dados<input type="file" id="import-file" accept="application/json,.json" hidden></label></div>
      <div class="row-btns"><button class="btn ghost sm" data-action="go" data-tab="diet" data-diet="foods">Gerenciar alimentos</button><button class="btn ghost sm" data-action="go" data-tab="weight">Gerenciar pesos</button></div>
    </section>
    <section class="panel danger-zone"><h3>Zona de cuidado</h3><p class="muted sm">Apaga perfil, pesos, objetivos, alimentos e registros deste navegador. Não dá para desfazer.</p>
      <button class="btn danger" data-action="wipe">${icon('trash')}Limpar todos os dados</button></section>
  </div>`;
}

/* =====================================================================
   FORMULÁRIOS E AÇÕES
   ===================================================================== */
function upsertWeight(date, kg) {
  const ex = S.weights.find(w => w.date === date);
  if (ex) { ex.w = kg; return ex; }
  const e = { id: uid(), date, w: kg };
  S.weights.push(e);
  return e;
}
function afterDataChange(msg) {
  const g = checkGoals();
  save();
  render();
  if (msg) toast(msg);
  if (g) setTimeout(() => showCelebration(g), 400);
}
const guessGPU = name => {
  const n = norm(name);
  if (/ovo/.test(n)) return 50;
  if (/pao|torrada/.test(n)) return 25;
  if (/banana/.test(n)) return 80;
  if (/laranja/.test(n)) return 150;
  if (/maca/.test(n)) return 130;
  if (/tangerina|mexerica/.test(n)) return 120;
  return 100;
};

/* ---------- registro do dia ---------- */
function openLog(date, preset = {}) {
  date = date || todayISO();
  const lg = S.logs[date] || {}, wo = S.workouts[date] || null, we = S.weights.find(w => w.date === date);
  const dow = parseISO(date).getDay();
  const trained = preset.variant ? 'yes' : wo ? (wo.done ? 'yes' : 'no') : '';
  const day = preset.day != null ? +preset.day : (wo && wo.day != null ? wo.day : (dow === 0 ? '' : dow));
  const variant = preset.variant || (wo && wo.variant) || '';
  const dayOpts = [{ v: '', t: 'Treino livre' }, ...[1, 2, 3, 4, 5, 6].map(d => ({ v: d, t: `${WD_LONG[d]}: ${WEEK_PLAN[d].group}` }))];
  const isNew = !(wo && wo.done);
  const body = `
    ${field('Data', dateInput('date', date))}
    <fieldset class="qa"><legend>Hoje você treinou?</legend>${segmented('trained', [{ v: 'yes', t: 'Sim' }, { v: 'no', t: 'Não' }], trained)}</fieldset>
    <div id="train-box" class="${trained === 'yes' ? '' : 'hidden'}">
      <div class="row2">${field('Minutos de musculação', numInput('strengthMin', wo && wo.done ? wo.strengthMin : (isNew ? 30 : ''), 'inputmode="numeric"'))}${field('Minutos de aeróbico', numInput('cardioMin', wo && wo.done ? wo.cardioMin : (isNew ? 30 : ''), 'inputmode="numeric"'))}</div>
      ${field('Qual exercício ou cardio?', textInput('activity', wo && wo.activity ? wo.activity : 'Esteira', 'maxlength="60"'))}
      <div class="row2">${field('Distância (km)', numInput('dist', wo && wo.dist != null ? String(wo.dist).replace('.', ',') : '', 'placeholder="Opcional"'))}${field('Velocidade (km/h)', numInput('speed', wo && wo.speed != null ? String(wo.speed).replace('.', ',') : '', 'placeholder="Ref.: 6,5–6,7"'))}</div>
      ${field('Dia do plano', selectInput('day', dayOpts, day))}
      <fieldset class="qa"><legend>Qual treino você fez?</legend>${segmented('variant', [{ v: '', t: 'Livre' }, { v: 'A', t: 'A' }, { v: 'B', t: 'B' }, { v: 'C', t: 'C' }], variant)}</fieldset>
    </div>
    <fieldset class="qa"><legend>Você seguiu sua alimentação planejada?</legend>${segmented('diet', [{ v: 'yes', t: '🟢 Sim, completamente' }, { v: 'partial', t: '🟡 Parcialmente' }, { v: 'no', t: '🔴 Não' }], lg.diet || '').replace('class="seg"', 'class="seg col"')}</fieldset>
    ${field(`Peso do dia (${unitName()}, opcional)`, numInput('w', we ? inputW(we.w) : '', 'placeholder="Ex.: 114,2"'))}
    ${field('Como foi meu dia?', `<textarea name="note" rows="3" maxlength="400" placeholder="Observações livres">${esc(lg.note || '')}</textarea>`)}`;
  openModal({
    title: date === todayISO() ? 'Registro de hoje' : `Registro de ${fmtDate(date)}`, body, submitText: 'Salvar registro',
    onOpen: form => {
      const box = $('#train-box', form);
      $$('input[name=trained]', form).forEach(r => r.addEventListener('change', () => box.classList.toggle('hidden', form.elements.trained.value !== 'yes')));
      form.elements.date.addEventListener('change', e => { if (e.target.value && e.target.value <= todayISO()) openLog(e.target.value); });
    },
    onSubmit: (fd, form) => {
      const f = Object.fromEntries(fd.entries());
      const dt = f.date;
      if (!dt) return fieldError(form, 'date', 'Escolha a data do registro.');
      if (dt > todayISO()) return fieldError(form, 'date', 'A data não pode ser no futuro.');
      const tr = f.trained || '';
      let strength = 0, cardio = 0, dist = null, speed = null;
      if (tr === 'yes') {
        const s = f.strengthMin === '' ? 0 : parseNum(f.strengthMin), c = f.cardioMin === '' ? 0 : parseNum(f.cardioMin);
        if (s == null || s < 0 || s > 600) return fieldError(form, 'strengthMin', 'Informe os minutos de musculação (0 a 600).');
        if (c == null || c < 0 || c > 600) return fieldError(form, 'cardioMin', 'Informe os minutos de aeróbico (0 a 600).');
        if (s + c <= 0) return fieldError(form, 'strengthMin', 'Informe os minutos treinados ou marque “Não”.');
        strength = Math.round(s); cardio = Math.round(c);
        if (f.dist !== '') { dist = parseNum(f.dist); if (dist == null || dist < 0 || dist > 200) return fieldError(form, 'dist', 'Distância inválida. Use km, por exemplo 3,3.'); }
        if (f.speed !== '') { speed = parseNum(f.speed); if (speed == null || speed <= 0 || speed > 40) return fieldError(form, 'speed', 'Velocidade inválida. Use km/h, por exemplo 6,5.'); }
      }
      let kg = null;
      if ((f.w || '').trim() !== '') {
        const n = parseNum(f.w);
        kg = n == null ? null : fromU(n);
        if (kg == null || kg < 20 || kg > 500) return fieldError(form, 'w', 'Peso inválido. Confira o valor, por exemplo 114,2.');
      }
      if (tr === 'yes') S.workouts[dt] = { done: true, day: f.day === '' ? null : +f.day, variant: f.variant || '', strengthMin: strength, cardioMin: cardio, activity: (f.activity || '').trim(), dist, speed };
      else if (tr === 'no') S.workouts[dt] = { done: false };
      const note = (f.note || '').trim();
      if (f.diet || note) S.logs[dt] = { diet: f.diet || '', note }; else delete S.logs[dt];
      if (kg != null) upsertWeight(dt, kg);
      afterDataChange('Dia salvo. Mais um dia concluído.');
    }
  });
}
async function deleteLog(date) {
  const ok = await confirmDialog({ title: 'Excluir registro do dia?', text: `O diário e o treino de ${fmtDate(date)} serão removidos. O peso desse dia continua no histórico de peso.`, okText: 'Excluir', danger: true });
  if (!ok) return;
  delete S.logs[date]; delete S.workouts[date];
  save(); render(); toast('Registro excluído.');
}

/* ---------- peso ---------- */
function openWeight(id) {
  const e = id ? S.weights.find(w => w.id === id) : null;
  openModal({
    title: e ? 'Editar peso' : 'Registrar peso',
    body: `${field(`Peso (${unitName()})`, numInput('w', e ? inputW(e.w) : '', 'placeholder="Ex.: 114,2" required'))}${field('Data', dateInput('date', e ? e.date : todayISO()))}`,
    submitText: e ? 'Salvar alterações' : 'Registrar',
    onSubmit: (fd, form) => {
      const n = parseNum(fd.get('w'));
      if (n == null) return fieldError(form, 'w', 'Informe o peso, por exemplo 114,2.');
      const kg = fromU(n);
      if (kg < 20 || kg > 500) return fieldError(form, 'w', 'Esse valor parece fora do esperado. Confira o peso informado.');
      const date = fd.get('date');
      if (!date) return fieldError(form, 'date', 'Escolha a data.');
      if (date > todayISO()) return fieldError(form, 'date', 'A data não pode ser no futuro.');
      if (e) {
        if (S.weights.some(w => w.date === date && w.id !== e.id)) return fieldError(form, 'date', 'Já existe um peso nessa data. Edite aquele registro.');
        e.date = date; e.w = kg;
        if (e.id === S.profile.startEntryId) { S.profile.startWeight = kg; S.profile.startDate = date; }
        afterDataChange('Registro atualizado.');
      } else {
        const existed = S.weights.some(w => w.date === date);
        upsertWeight(date, kg);
        afterDataChange(existed ? 'Peso desse dia atualizado.' : 'Peso registrado.');
      }
    }
  });
}
async function deleteWeight(id) {
  const e = S.weights.find(w => w.id === id);
  if (!e) return;
  const ok = await confirmDialog({ title: 'Excluir este peso?', text: `O registro de ${fmtW(e.w)} em ${fmtDate(e.date)} será removido do histórico e dos gráficos.`, okText: 'Excluir', danger: true });
  if (!ok) return;
  S.weights = S.weights.filter(w => w.id !== id);
  save(); render(); toast('Registro excluído.');
}
function submitInlineWeight(form, first) {
  const fd = new FormData(form);
  clearErrors(form);
  const n = parseNum(fd.get('w'));
  if (n == null) return fieldError(form, 'w', 'Informe o peso, por exemplo 114,2.');
  const kg = fromU(n);
  if (kg < 20 || kg > 500) return fieldError(form, 'w', 'Esse valor parece fora do esperado. Confira o peso informado.');
  const date = fd.get('date');
  if (!date) return fieldError(form, 'date', 'Escolha a data.');
  if (date > todayISO()) return fieldError(form, 'date', 'A data não pode ser no futuro.');
  const e = upsertWeight(date, kg);
  if (first) {
    S.profile.startWeight = kg; S.profile.startDate = date; S.profile.startEntryId = e.id;
    afterDataChange('Peso inicial salvo. Sua jornada começou.');
  } else afterDataChange('Peso registrado.');
}

/* ---------- objetivos ---------- */
function goalPreviewText(form) {
  const u = unitName();
  const sw = parseNum(form.elements.startWeight.value), tw = parseNum(form.elements.target.value), wk = parseNum(form.elements.weeks.value), sd = form.elements.startDate.value;
  if (sw == null || tw == null || wk == null || !sd || wk < 1) return 'Preencha o peso inicial, o peso desejado e o prazo para ver o plano.';
  if (tw >= sw) return 'O peso desejado precisa ser menor que o peso inicial.';
  const tot = sw - tw, perW = tot / wk, perD = tot / (wk * 7);
  const pctW = (perW / sw) * 100;
  let t = `<ul class="plain"><li>A perder: <b>${fmtN(tot)} ${u}</b></li><li>Por semana: <b>${fmtN(perW, 2)} ${u}</b></li><li>Por dia: <b>${fmtN(perD, 2)} ${u}</b></li><li>Conclusão prevista: <b>${fmtDate(addDays(sd, Math.round(wk) * 7))}</b></li></ul>`;
  if (pctW > 1) t += `<p class="warn-text">${icon('alert')}Esse ritmo passa de 1% do peso por semana, acima do que costuma ser considerado confortável. Pense em um prazo maior ou converse com um profissional de saúde.</p>`;
  return t;
}
function openGoal(id, preset = {}) {
  const g = id ? S.goals.find(x => x.id === id) : null;
  const cur = currentW() ?? S.profile.startWeight;
  const startKg = g ? g.startWeight : (preset.start ?? cur);
  const targetKg = g ? g.targetWeight : (preset.target ?? (cur != null ? Math.ceil(cur / 5) * 5 - 5 : null));
  const u = unitName();
  const body = `
    ${field('Nome do objetivo', textInput('name', g ? g.name : '', 'maxlength="60" placeholder="Ex.: Chegar aos 110 kg"'), 'Se deixar em branco, usamos o peso desejado.')}
    <div class="row2">${field(`Peso inicial (${u})`, numInput('startWeight', inputW(startKg)))}${field(`Peso desejado (${u})`, numInput('target', inputW(targetKg)))}</div>
    <div class="row2">${field('Prazo (semanas)', textInput('weeks', g ? g.weeks : 5, 'inputmode="numeric"'))}${field('Data de início', dateInput('startDate', g ? g.startDate : todayISO(), false))}</div>
    <div id="goal-preview" class="note-box block" aria-live="polite"></div>`;
  openModal({
    title: g ? 'Editar objetivo' : 'Novo objetivo', body, submitText: g ? 'Salvar alterações' : 'Criar objetivo',
    onOpen: form => {
      const upd = () => { $('#goal-preview', form).innerHTML = goalPreviewText(form); };
      ['startWeight', 'target', 'weeks', 'startDate'].forEach(n => form.elements[n].addEventListener('input', upd));
      upd();
    },
    onSubmit: (fd, form) => {
      const swD = parseNum(fd.get('startWeight')), twD = parseNum(fd.get('target')), wk = parseNum(fd.get('weeks')), sd = fd.get('startDate');
      if (swD == null || swD <= 0) return fieldError(form, 'startWeight', 'Informe o peso inicial.');
      if (twD == null || twD <= 0) return fieldError(form, 'target', 'Informe o peso desejado.');
      const sw = fromU(swD), tw = fromU(twD);
      if (sw < 20 || sw > 500 || tw < 20 || tw > 500) return fieldError(form, 'target', 'Esses pesos parecem fora do esperado. Confira os valores.');
      if (tw >= sw) return fieldError(form, 'target', 'O peso desejado precisa ser menor que o peso inicial.');
      if (wk == null || !Number.isInteger(wk) || wk < 1 || wk > 156) return fieldError(form, 'weeks', 'Informe o prazo em semanas inteiras (de 1 a 156).');
      if (!sd) return fieldError(form, 'startDate', 'Escolha a data de início.');
      const name = (fd.get('name') || '').trim() || `Chegar aos ${fmtN(twD, Number.isInteger(twD) ? 0 : 1)} ${unitName()}`;
      if (g) {
        const was = !!g.completedDate;
        Object.assign(g, { name, startWeight: sw, targetWeight: tw, weeks: wk, startDate: sd });
        delete g.completedDate; delete g.finalWeight;
        const found = checkGoals();
        save(); render(); toast('Objetivo atualizado.');
        if (found && !was) setTimeout(() => showCelebration(found), 400);
      } else {
        const ng = { id: uid(), name, startWeight: sw, targetWeight: tw, weeks: wk, startDate: sd };
        S.goals.push(ng);
        S.settings.currentGoalId = ng.id;
        const found = checkGoals();
        save(); render(); toast('Objetivo criado. Bora acompanhar.');
        if (found === ng) setTimeout(() => showCelebration(ng), 400);
      }
    }
  });
}
async function deleteGoal(id) {
  const g = S.goals.find(x => x.id === id);
  if (!g) return;
  const ok = await confirmDialog({ title: 'Excluir objetivo?', text: `“${g.name}” será removido. Seus registros de peso não são afetados.`, okText: 'Excluir', danger: true });
  if (!ok) return;
  S.goals = S.goals.filter(x => x.id !== id);
  if (S.settings.currentGoalId === id) S.settings.currentGoalId = null;
  save(); render(); toast('Objetivo excluído.');
}
function showCelebration(g) {
  const m = goalMetrics(g);
  const weeksUsed = m.used / 7;
  const late = m.doneDate > m.end ? diffDays(m.end, m.doneDate) : 0;
  const early = m.doneDate <= m.end ? diffDays(m.doneDate, m.end) : 0;
  const prazo = late ? `${late} ${late === 1 ? 'dia' : 'dias'} após o prazo` : early ? `${early} ${early === 1 ? 'dia' : 'dias'} antes do prazo` : 'No dia do prazo';
  const pctMeta = Math.round(((g.startWeight - m.curG) / (g.startWeight - g.targetWeight)) * 100);
  openModal({
    title: 'Conquista', size: 'celebrate', hideFooter: true,
    body: `<div class="celebrate"><div class="trophy" aria-hidden="true">${icon('trophy')}</div>
      <h2>OBJETIVO CONCLUÍDO!</h2><p class="muted">${esc(g.name)}</p>
      <dl class="kv big"><div><dt>Peso inicial</dt><dd>${fmtW(g.startWeight)}</dd></div><div><dt>Peso final</dt><dd>${fmtW(m.curG)}</dd></div>
      <div><dt>Total perdido</dt><dd>${fmtW(g.startWeight - m.curG)}</dd></div><div><dt>Tempo utilizado</dt><dd>${m.used} ${m.used === 1 ? 'dia' : 'dias'} (${fmtN(weeksUsed, 1)} sem.)</dd></div>
      <div><dt>Meta atingida</dt><dd>${pctMeta}%</dd></div><div><dt>Prazo</dt><dd>${esc(prazo)}</dd></div></dl>
      <p class="motto">Seu progresso foi construído dia após dia.</p>
      <div class="row-btns center"><button type="button" class="btn primary" data-action="celebrate-next" data-id="${g.id}">Definir próximo objetivo</button><button type="button" class="btn ghost" data-action="modal-close">Fechar</button></div></div>`
  });
}

/* ---------- alimentos ---------- */
const numStr = v => (v == null || v === '' ? '' : String(v).replace('.', ','));
function openFood(id) {
  const f = id ? S.foods.find(x => x.id === id) : null;
  const body = `
    ${field('Nome', textInput('name', f ? f.name : '', 'maxlength="60" required placeholder="Ex.: Peito de frango"'))}
    ${field('Categoria', selectInput('cat', CATS.map(c => ({ v: c.id, t: c.label })), f ? f.cat : 'proteinas'))}
    <div class="row2">${field('Quantidade disponível', numInput('qty', numStr(f && f.qty), 'placeholder="Opcional"'))}${field('Unidade', selectInput('unit', UNITS.map(u => ({ v: u, t: u })), f ? f.unit : 'g'))}</div>
    <div id="gpu-box" class="hidden">${field('Peso de cada unidade (g)', numInput('gPerUnit', numStr(f && f.gPerUnit)), 'Usado para calcular porções. Ex.: 1 ovo tem cerca de 50 g.')}</div>
    ${field('Calorias por 100 g (kcal)', numInput('kcal', numStr(f && f.kcal), 'required'))}
    <div class="row3">${field('Proteínas (g)', numInput('p', numStr(f && f.p)))}${field('Carboidratos (g)', numInput('c', numStr(f && f.c)))}${field('Gorduras (g)', numInput('f', numStr(f && f.f)))}</div>
    <p class="muted sm">Valores por 100 g, como no rótulo. Campos de macros em branco contam como zero.</p>
    ${field('Observação (opcional)', textInput('note', f ? f.note || '' : '', 'maxlength="120"'))}`;
  openModal({
    title: f ? 'Editar alimento' : 'Cadastrar alimento', body, submitText: f ? 'Salvar alterações' : 'Cadastrar',
    onOpen: form => {
      const sync = () => $('#gpu-box', form).classList.toggle('hidden', !['unidade', 'fatia'].includes(form.elements.unit.value));
      form.elements.unit.addEventListener('change', () => { sync(); if (!form.elements.gPerUnit.value) form.elements.gPerUnit.value = guessGPU(form.elements.name.value); });
      sync();
    },
    onSubmit: (fd, form) => {
      const name = (fd.get('name') || '').trim();
      if (!name) return fieldError(form, 'name', 'Informe o nome do alimento.');
      const kcal = parseNum(fd.get('kcal'));
      if (kcal == null || kcal < 0 || kcal > 950) return fieldError(form, 'kcal', 'Informe as calorias por 100 g (0 a 950).');
      const get = k => { const raw = (fd.get(k) || '').trim(); if (raw === '') return 0; const n = parseNum(raw); return n; };
      const p = get('p'), c = get('c'), fa = get('f');
      if (p == null || p < 0 || p > 100) return fieldError(form, 'p', 'Proteína por 100 g deve estar entre 0 e 100.');
      if (c == null || c < 0 || c > 100) return fieldError(form, 'c', 'Carboidratos por 100 g devem estar entre 0 e 100.');
      if (fa == null || fa < 0 || fa > 100) return fieldError(form, 'f', 'Gorduras por 100 g devem estar entre 0 e 100.');
      const qRaw = (fd.get('qty') || '').trim();
      const qty = qRaw === '' ? null : parseNum(qRaw);
      if (qRaw !== '' && (qty == null || qty < 0)) return fieldError(form, 'qty', 'Quantidade inválida.');
      const unit = fd.get('unit');
      let gpu = null;
      if (['unidade', 'fatia'].includes(unit)) {
        gpu = parseNum(fd.get('gPerUnit')) || guessGPU(name);
        if (gpu <= 0 || gpu > 2000) return fieldError(form, 'gPerUnit', 'Informe o peso de cada unidade em gramas.');
      }
      const rec = { name, cat: fd.get('cat'), qty, unit, kcal, p, c, f: fa, gPerUnit: gpu, note: (fd.get('note') || '').trim() };
      if (f) { Object.assign(f, rec); toast('Alimento atualizado.'); }
      else { S.foods.push({ id: uid(), ...rec }); toast('Alimento cadastrado.'); }
      save(); render();
    }
  });
}
async function deleteFood(id) {
  const f = S.foods.find(x => x.id === id);
  if (!f) return;
  const ok = await confirmDialog({ title: 'Excluir alimento?', text: `“${f.name}” sai da sua lista e deixa de aparecer nas sugestões.`, okText: 'Excluir', danger: true });
  if (!ok) return;
  S.foods = S.foods.filter(x => x.id !== id);
  save(); render(); toast('Alimento excluído.');
}
function commonFoodsPicker(existingNorms) {
  return CATS.filter(c => COMMON_FOODS.some(f => f.cat === c.id)).map(c => {
    const items = COMMON_FOODS.filter(f => f.cat === c.id && !existingNorms.has(norm(f.name)));
    if (!items.length) return '';
    return `<fieldset class="pick"><legend>${esc(c.label)}</legend>${items.map(f => `<label class="check"><input type="checkbox" name="cf" value="${esc(f.name)}"><span>${esc(f.name)}</span></label>`).join('')}</fieldset>`;
  }).join('');
}
function foodFromCommon(cf) { return { id: uid(), name: cf.name, cat: cf.cat, qty: null, unit: cf.unit, kcal: cf.kcal, p: cf.p, c: cf.c, f: cf.f, gPerUnit: cf.gPerUnit || null, note: 'Valores aproximados de referência. Confira no rótulo.' }; }
function openCommonFoods() {
  const have = new Set(S.foods.map(f => norm(f.name)));
  const html = commonFoodsPicker(have);
  if (!html) { toast('Você já cadastrou todos os alimentos comuns.'); return; }
  openModal({
    title: 'Alimentos comuns', submitText: 'Adicionar selecionados',
    body: `<p class="muted sm">Marque o que você tem em casa. Os valores por 100 g são aproximados e podem ser editados depois.</p><button type="button" class="link" id="pick-all">Marcar todos</button>${html}`,
    onOpen: form => { $('#pick-all', form).addEventListener('click', () => $$('input[name=cf]', form).forEach(i => { i.checked = true; })); },
    onSubmit: fd => {
      const names = fd.getAll('cf');
      if (!names.length) { toast('Marque ao menos um alimento.', 'error'); return false; }
      names.forEach(n => { const cf = COMMON_FOODS.find(f => f.name === n); if (cf) S.foods.push(foodFromCommon(cf)); });
      save(); render(); toast(`${names.length} ${names.length === 1 ? 'alimento adicionado' : 'alimentos adicionados'}.`);
    }
  });
}

/* ---------- dados: exportar, importar, limpar ---------- */
function exportData() {
  const payload = { app: 'jornada-emagrecimento', schema: SCHEMA, exportedAt: new Date().toISOString(), data: S };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `jornada-backup-${todayISO()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Backup exportado.');
}
async function importData(file) {
  if (!file) return;
  try {
    const raw = JSON.parse(await file.text());
    const data = raw && raw.data ? raw.data : raw;
    if (!data || typeof data !== 'object' || !Array.isArray(data.weights) || !data.profile) throw new Error('formato');
    const ok = await confirmDialog({ title: 'Importar dados?', text: 'Os dados atuais deste navegador serão substituídos pelos do arquivo.', okText: 'Importar e substituir', danger: true });
    if (!ok) return;
    S = migrate(data);
    if (!S.profile.onboarded && S.weights.length) S.profile.onboarded = true;
    checkGoals();
    save(); ui.tab = 'home';
    $('#onboard').innerHTML = ''; document.body.classList.remove('ob-open');
    render(); toast('Dados importados com sucesso.');
  } catch (e) {
    toast('Não consegui ler esse arquivo. Use um backup exportado pelo próprio app.', 'error');
  }
}
async function wipeAll() {
  const a = await confirmDialog({ title: 'Limpar todos os dados?', text: 'Isso apaga perfil, pesos, objetivos, alimentos e registros deste navegador.', okText: 'Continuar', danger: true });
  if (!a) return;
  const b = await confirmDialog({ title: 'Última confirmação', text: 'Essa ação não pode ser desfeita. Se quiser uma cópia, exporte antes.', okText: 'Apagar tudo', danger: true, typeWord: 'APAGAR' });
  if (!b) return;
  try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignora */ }
  S = defaultState();
  ui.tab = 'home';
  render();
  startOnboarding();
  toast('Dados apagados.');
}

/* ---------- configurações ---------- */
function submitSettings(form) {
  clearErrors(form);
  const fd = new FormData(form);
  const name = (fd.get('name') || '').trim();
  const swRaw = (fd.get('startWeight') || '').trim();
  let sw = null;
  if (swRaw !== '') {
    const n = parseNum(swRaw);
    sw = n == null ? null : fromU(n);
    if (sw == null || sw < 20 || sw > 500) return fieldError(form, 'startWeight', 'Peso inicial inválido.');
  }
  const fwRaw = (fd.get('finalWeight') || '').trim();
  let fw = null;
  if (fwRaw !== '') {
    const n = parseNum(fwRaw);
    fw = n == null ? null : fromU(n);
    if (fw == null || fw < 20 || fw > 500) return fieldError(form, 'finalWeight', 'Meta de longo prazo inválida.');
  }
  const kMin = parseNum(fd.get('kcalMin')), kMax = parseNum(fd.get('kcalMax')), pMin = parseNum(fd.get('protMin')), pMax = parseNum(fd.get('protMax'));
  if (kMin == null || kMin < 800 || kMin > 6000) return fieldError(form, 'kcalMin', 'Informe a meta mínima de calorias (800 a 6.000).');
  if (kMax == null || kMax < kMin || kMax > 6000) return fieldError(form, 'kcalMax', 'A meta máxima não pode ser menor que a mínima.');
  if (pMin == null || pMin < 20 || pMin > 500) return fieldError(form, 'protMin', 'Informe a proteína mínima em gramas.');
  if (pMax == null || pMax < pMin || pMax > 500) return fieldError(form, 'protMax', 'A proteína máxima não pode ser menor que a mínima.');
  S.profile.name = name;
  if (sw != null && Math.abs(sw - (S.profile.startWeight ?? -1)) > 1e-6) {
    S.profile.startWeight = sw;
    const se = S.weights.find(w => w.id === S.profile.startEntryId);
    if (se) se.w = sw;
  }
  S.profile.finalWeight = fw;
  Object.assign(S.settings, { kcalMin: kMin, kcalMax: kMax, protMin: pMin, protMax: pMax, unit: fd.get('unit') === 'lb' ? 'lb' : 'kg' });
  const gid = fd.get('currentGoalId');
  if (gid) S.settings.currentGoalId = gid;
  checkGoals();
  save(); render(); toast('Configurações salvas.');
}

/* =====================================================================
   ONBOARDING (primeiro acesso)
   ===================================================================== */
const ob = { step: 1, d: {} };
function startOnboarding() {
  ob.step = 1;
  ob.d = { unit: 'kg', name: '', weight: null, date: todayISO(), target: null, finalWeight: null, weeks: null, sdate: todayISO(), kcalMin: 2000, kcalMax: 2100, protMin: 140, protMax: 160, foods: [] };
  document.body.classList.add('ob-open');
  renderOnboarding();
}
const OB_STEPS = 5;
function renderOnboarding() {
  const d = ob.d, u = d.unit;
  let title = '', lead = '', body = '';
  if (ob.step === 1) {
    title = 'Qual é seu peso inicial?'; lead = 'Esse é o ponto de partida da sua jornada. Tudo o que você registrar a partir daqui vira indicadores e gráficos.';
    body = `${field('Como podemos te chamar? (opcional)', textInput('name', d.name, 'maxlength="30" autocomplete="given-name"'))}
      ${field('Unidade de peso', segmented('unit', [{ v: 'kg', t: 'Quilos (kg)' }, { v: 'lb', t: 'Libras (lb)' }], u))}
      <div class="row2">${field(`Peso (${u})`, numInput('weight', d.weight == null ? '' : String(d.weight).replace('.', ','), 'placeholder="Ex.: 115,0"'))}${field('Data', dateInput('date', d.date))}</div>`;
  } else if (ob.step === 2) {
    title = 'Qual é o seu primeiro objetivo?'; lead = 'Escolha um passo que pareça alcançável. Dá para criar novos objetivos depois.';
    body = `${field(`Peso desejado (${u})`, numInput('target', d.target == null ? '' : String(d.target).replace('.', ','), 'placeholder="Ex.: 110"'), 'Metas menores e frequentes costumam ser mais fáceis de manter.')}
      ${field(`Meta de longo prazo (${u}, opcional)`, numInput('finalWeight', d.finalWeight == null ? '' : String(d.finalWeight).replace('.', ',')), 'Se quiser, defina até onde sua jornada pode chegar.')}`;
  } else if (ob.step === 3) {
    const tot = d.weight != null && d.target != null ? d.weight - d.target : null;
    const sugg = tot ? Math.max(1, Math.ceil(unitToKg(tot, u))) : 5;
    if (d.weeks == null) d.weeks = sugg;
    title = 'Em quantas semanas?'; lead = 'O prazo define o ritmo. Calculamos as metas semanais para você acompanhar.';
    body = `<div class="row2">${field('Prazo (semanas)', textInput('weeks', d.weeks, 'inputmode="numeric"'))}${field('Data de início', dateInput('sdate', d.sdate, false))}</div><div id="ob-prev" class="note-box block" aria-live="polite"></div>`;
  } else if (ob.step === 4) {
    title = 'Suas metas de dieta'; lead = 'Valores de referência para acompanhar. Você pode ajustar quando quiser em Configurações.';
    body = `<div class="row2">${field('Calorias, mínimo', numInput('kcalMin', d.kcalMin))}${field('Calorias, máximo', numInput('kcalMax', d.kcalMax))}</div><div class="row2">${field('Proteína, mínimo (g)', numInput('protMin', d.protMin))}${field('Proteína, máximo (g)', numInput('protMax', d.protMax))}</div>`;
  } else {
    title = 'O que você tem em casa?'; lead = 'Marque os alimentos que costuma ter. Eles alimentam as sugestões de cardápio. Valores aproximados, editáveis depois.';
    const have = new Set();
    body = `<button type="button" class="link" id="pick-all">Marcar todos</button>${commonFoodsPicker(have).replace(/name="cf"/g, 'name="cf"')}`;
  }
  const dots = Array.from({ length: OB_STEPS }, (_, i) => `<i class="${i + 1 === ob.step ? 'on' : i + 1 < ob.step ? 'past' : ''}"></i>`).join('');
  $('#onboard').innerHTML = `<div class="ob-wrap"><div class="ob-card">
    <div class="ob-top"><span class="brand-mini">${icon('leaf')}Jornada</span><span class="muted sm">Passo ${ob.step} de ${OB_STEPS}</span></div>
    <div class="ob-dots" aria-hidden="true">${dots}</div>
    <h1>${esc(title)}</h1><p class="muted">${esc(lead)}</p>
    <form id="ob-form" novalidate>${body}
      <div class="ob-foot">${ob.step > 1 ? '<button type="button" class="btn ghost" id="ob-back">Voltar</button>' : '<span></span>'}<button type="submit" class="btn primary">${ob.step === OB_STEPS ? 'Começar minha jornada' : 'Continuar'}</button></div></form>
  </div></div>`;
  const form = $('#ob-form');
  const unitRadios = $$('input[name=unit]', form);
  unitRadios.forEach(r => r.addEventListener('change', () => { d.unit = form.elements.unit.value; readStep(form, true); renderOnboarding(); }));
  $('#ob-back', form) && $('#ob-back', form).addEventListener('click', () => { readStep(form, true); ob.step--; renderOnboarding(); });
  const pa = $('#pick-all', form);
  if (pa) pa.addEventListener('click', () => $$('input[name=cf]', form).forEach(i => { i.checked = true; }));
  if (ob.step === 3) {
    const upd = () => {
      const tot = d.weight - d.target, wk = parseNum(form.elements.weeks.value);
      $('#ob-prev', form).innerHTML = wk && wk >= 1 ? `<ul class="plain"><li>A perder: <b>${fmtN(tot)} ${u}</b></li><li>Por semana: <b>${fmtN(tot / wk, 2)} ${u}</b></li><li>Conclusão prevista: <b>${fmtDate(addDays(form.elements.sdate.value || todayISO(), Math.round(wk) * 7))}</b></li></ul>${unitToKg(tot / wk, u) / unitToKg(d.weight, u) > 0.01 ? `<p class="warn-text">${icon('alert')}Esse ritmo passa de 1% do peso por semana. Considere um prazo maior.</p>` : ''}` : 'Informe o prazo em semanas.';
    };
    ['weeks', 'sdate'].forEach(n => form.elements[n].addEventListener('input', upd));
    upd();
  }
  form.addEventListener('submit', e => { e.preventDefault(); if (readStep(form, false)) { if (ob.step === OB_STEPS) obFinish(); else { ob.step++; renderOnboarding(); window.scrollTo(0, 0); } } });
}
const unitToKg = (v, u) => (u === 'lb' ? v / KG_LB : v);
/* lê os campos da etapa; strict=false valida */
function readStep(form, soft) {
  const d = ob.d, fd = new FormData(form);
  clearErrors(form);
  const bad = (n, m) => (soft ? true : fieldError(form, n, m) && false);
  if (ob.step === 1) {
    d.name = (fd.get('name') || '').trim(); d.unit = fd.get('unit') || d.unit; d.date = fd.get('date') || d.date;
    const w = parseNum(fd.get('weight'));
    if (!soft) {
      if (w == null) return bad('weight', 'Informe seu peso, por exemplo 115,0.') && false;
      const kg = unitToKg(w, d.unit);
      if (kg < 20 || kg > 500) return bad('weight', 'Esse valor parece fora do esperado. Confira o peso.') && false;
      if (!d.date || d.date > todayISO()) return bad('date', 'Escolha uma data até hoje.') && false;
    }
    d.weight = w;
  } else if (ob.step === 2) {
    const t = parseNum(fd.get('target')), fw = parseNum(fd.get('finalWeight'));
    if (!soft) {
      if (t == null || t <= 0) return bad('target', 'Informe o peso que deseja alcançar.') && false;
      if (t >= d.weight) return bad('target', 'O peso desejado precisa ser menor que o peso inicial.') && false;
      if (unitToKg(t, d.unit) < 20) return bad('target', 'Esse valor parece fora do esperado.') && false;
      if (fw != null && fw >= t) return bad('finalWeight', 'A meta de longo prazo deve ser menor que o primeiro objetivo.') && false;
    }
    d.target = t; d.finalWeight = fw;
  } else if (ob.step === 3) {
    const wk = parseNum(fd.get('weeks'));
    d.sdate = fd.get('sdate') || d.sdate;
    if (!soft) {
      if (wk == null || !Number.isInteger(wk) || wk < 1 || wk > 156) return bad('weeks', 'Informe semanas inteiras, de 1 a 156.') && false;
      if (!d.sdate) return bad('sdate', 'Escolha a data de início.') && false;
    }
    d.weeks = wk;
  } else if (ob.step === 4) {
    const kMin = parseNum(fd.get('kcalMin')), kMax = parseNum(fd.get('kcalMax')), pMin = parseNum(fd.get('protMin')), pMax = parseNum(fd.get('protMax'));
    if (!soft) {
      if (kMin == null || kMin < 800 || kMin > 6000) return bad('kcalMin', 'Informe a meta mínima de calorias.') && false;
      if (kMax == null || kMax < kMin || kMax > 6000) return bad('kcalMax', 'O máximo não pode ser menor que o mínimo.') && false;
      if (pMin == null || pMin < 20 || pMin > 500) return bad('protMin', 'Informe a proteína mínima em gramas.') && false;
      if (pMax == null || pMax < pMin || pMax > 500) return bad('protMax', 'O máximo não pode ser menor que o mínimo.') && false;
    }
    Object.assign(d, { kcalMin: kMin ?? d.kcalMin, kcalMax: kMax ?? d.kcalMax, protMin: pMin ?? d.protMin, protMax: pMax ?? d.protMax });
  } else {
    d.foods = fd.getAll('cf');
  }
  return true;
}
function obFinish() {
  const d = ob.d, f = v => unitToKg(v, d.unit);
  const old = S;
  S = defaultState();
  S.settings.unit = d.unit;
  Object.assign(S.settings, { kcalMin: d.kcalMin, kcalMax: d.kcalMax, protMin: d.protMin, protMax: d.protMax });
  const eid = uid(), start = f(d.weight);
  S.profile = { onboarded: true, name: d.name, startWeight: start, startDate: d.date, startEntryId: eid, finalWeight: d.finalWeight != null ? f(d.finalWeight) : null };
  S.weights = [{ id: eid, date: d.date, w: start }];
  const goal = { id: uid(), name: `Chegar aos ${fmtN(d.target, Number.isInteger(d.target) ? 0 : 1)} ${d.unit}`, startWeight: start, targetWeight: f(d.target), weeks: d.weeks, startDate: d.sdate };
  S.goals = [goal];
  S.settings.currentGoalId = goal.id;
  d.foods.forEach(n => { const cf = COMMON_FOODS.find(x => x.name === n); if (cf) S.foods.push(foodFromCommon(cf)); });
  void old;
  save();
  $('#onboard').innerHTML = '';
  document.body.classList.remove('ob-open');
  ui.tab = 'home'; ui.dietTab = 'plan';
  render(); window.scrollTo(0, 0);
  toast('Tudo pronto. Sua jornada começa agora.');
}

/* =====================================================================
   RENDER, NAVEGAÇÃO E EVENTOS
   ===================================================================== */
const VIEWS = { home: viewHome, diet: viewDiet, exercise: viewExercise, weight: viewWeight, goals: viewGoals, analytics: viewAnalytics, settings: viewSettings };
function renderNav() {
  const items = TABS.map(t => `<button class="nav-btn ${ui.tab === t.id ? 'on' : ''}" data-action="go" data-tab="${t.id}" ${ui.tab === t.id ? 'aria-current="page"' : ''}>${icon(t.ic)}<span>${t.label}</span></button>`).join('');
  $('#bottomnav').innerHTML = items;
  $('#sidenav').innerHTML = `<div class="brand">${icon('leaf')}<span>Jornada</span></div>${items}<button class="nav-btn side-set ${ui.tab === 'settings' ? 'on' : ''}" data-action="go-settings">${icon('sliders')}<span>Configurações</span></button>`;
  const sb = $('#top-set'); if (sb) { sb.classList.toggle('on', ui.tab === 'settings'); sb.innerHTML = icon('sliders'); }
  const tb = $('#top-brand'); if (tb) tb.innerHTML = icon('leaf') + '<span>Jornada</span>';
}
function render(keepScroll = true) {
  const y = window.scrollY;
  Object.keys(chartRegistry).forEach(k => delete chartRegistry[k]);
  chartSeq = 0;
  const view = VIEWS[ui.tab] || viewHome;
  $('#main').innerHTML = (storageOK ? '' : '<div class="alert" role="alert">' + icon('alert') + '<p>O armazenamento deste navegador não está disponível. Seus dados não serão mantidos ao fechar a página. Use Configurações para exportar.</p></div>') + view();
  renderNav();
  drawCharts();
  document.body.dataset.tab = ui.tab;
  if (keepScroll) window.scrollTo(0, y);
}
function goTab(tab) { ui.tab = tab; render(false); window.scrollTo(0, 0); }

const actions = {
  go: el => { if (el.dataset.diet) ui.dietTab = el.dataset.diet; goTab(el.dataset.tab); },
  'go-settings': () => goTab('settings'),
  'diet-tab': el => { ui.dietTab = el.dataset.v; render(false); },
  'meal-filter': el => { ui.mealFilter = el.dataset.v; render(); },
  'sort-mode': el => { ui.sortMode = el.dataset.v; render(); },
  'meal-suggest': el => { ui.dietTab = 'menu'; ui.mealFilter = mealGroupOf(el.dataset.v); render(false); window.scrollTo(0, 0); },
  'day-show': () => { ui.showDay = true; render(); },
  'day-next': () => { ui.dayIdx++; render(); },
  'food-cat': el => { ui.foodCat = el.dataset.v; render(); },
  'ex-day': el => { ui.exDay = +el.dataset.v; render(); },
  'w-range': el => { ui.wRange = el.dataset.v === 'all' ? 'all' : +el.dataset.v; render(); },
  'a-range': el => { ui.aRange = el.dataset.v === 'all' ? 'all' : +el.dataset.v; render(); },
  'log-open': el => openLog(el.dataset.date, { day: el.dataset.day, variant: el.dataset.variant }),
  'log-del': el => deleteLog(el.dataset.date),
  'weight-add': () => openWeight(),
  'weight-edit': el => openWeight(el.dataset.id),
  'weight-del': el => deleteWeight(el.dataset.id),
  'goal-new': el => openGoal(null, el.dataset.target ? { target: parseFloat(el.dataset.target) } : {}),
  'goal-edit': el => openGoal(el.dataset.id),
  'goal-del': el => deleteGoal(el.dataset.id),
  'goal-current': el => { S.settings.currentGoalId = el.dataset.id; save(); render(); toast('Objetivo atual atualizado.'); },
  'goal-celebrate': el => { const g = S.goals.find(x => x.id === el.dataset.id); if (g) showCelebration(g); },
  'celebrate-next': el => {
    const g = S.goals.find(x => x.id === el.dataset.id); closeModal(true);
    if (g) openGoal(null, { start: goalMetrics(g).curG, target: g.targetWeight - 5 });
  },
  'food-add': () => openFood(),
  'food-edit': el => openFood(el.dataset.id),
  'food-del': el => deleteFood(el.dataset.id),
  'foods-common': () => openCommonFoods(),
  export: () => exportData(),
  wipe: () => wipeAll(),
  'modal-close': () => closeModal(),
  'modal-backdrop': () => closeModal()
};

function bindEvents() {
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const fn = actions[el.dataset.action];
    if (fn) { e.preventDefault(); fn(el, e); }
  });
  document.addEventListener('input', e => {
    if (e.target.id === 'food-q') {
      ui.foodQ = e.target.value;
      const l = $('#food-list'); if (l) l.innerHTML = foodListHtml();
    }
  });
  document.addEventListener('submit', e => {
    const form = e.target.closest('form[data-form]');
    if (form) { e.preventDefault(); submitInlineWeight(form, form.dataset.form === 'first-weight'); return; }
    if (e.target.id === 'settings-form') { e.preventDefault(); submitSettings(e.target); }
  });
  document.addEventListener('change', e => {
    if (e.target.id === 'import-file') { importData(e.target.files[0]); e.target.value = ''; }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#modal-root').innerHTML && !$('#confirm-root').innerHTML) closeModal(); });
  let rt;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(drawCharts, 150); });
}

function init() {
  load();
  bindEvents();
  if (!S.profile.onboarded && !S.weights.length) startOnboarding();
  else if (!S.profile.onboarded) { S.profile.onboarded = true; save(); }
  checkGoals();
  render(false);
}
if (typeof document !== 'undefined' && document.getElementById('main')) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
}
