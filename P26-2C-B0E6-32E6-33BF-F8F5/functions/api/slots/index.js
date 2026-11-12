import { json } from "../../../lib/session.js";
import { secured } from "../../../lib/api.js";

const STEP = 30 * 60_000;         // cada slot = 30 min
const MAX_WINDOW = 8 * 3600_000;  // janela máxima = 8 h
const DAY = 86_400_000;

// GET /api/slots?from=<ms>&to=<ms>  -> grade da semana
export const onRequestGet = secured(async ({ request, env }, user) => {
  const q = new URL(request.url).searchParams;
  const from = Number(q.get("from")), to = Number(q.get("to"));
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 8 * DAY)
    return json({ error: "Intervalo inválido." }, 400);

  const { results } = await env.DB.prepare(
    `SELECT s.id, s.start_ts, s.end_ts, s.monitor_id, m.username AS monitor_name, m.avatar AS monitor_avatar,
            b.id AS booking_id, b.student_id, b.topic, st.username AS student_name
       FROM slots s
       JOIN discord_users m ON m.user_id = s.monitor_id
       LEFT JOIN bookings b ON b.slot_id = s.id
       LEFT JOIN discord_users st ON st.user_id = b.student_id
      WHERE s.start_ts >= ? AND s.start_ts < ?
      ORDER BY s.start_ts`
  ).bind(from, to).all();

  return json({
    slots: results.map((r) => {
      const involved = r.student_id === user.id || r.monitor_id === user.id; // tema só para os envolvidos
      return {
        id: r.id, start: r.start_ts, end: r.end_ts,
        monitor: { id: r.monitor_id, name: r.monitor_name, avatar: r.monitor_avatar },
        booked: r.booking_id !== null,
        mine: r.student_id === user.id,
        booking_id: involved ? r.booking_id : null,
        topic: involved ? r.topic : null,
        student: r.monitor_id === user.id ? r.student_name : null,
      };
    }),
  });
});

// POST /api/slots {start,end} -> monitor abre uma janela, dividida em slots de 30 min
export const onRequestPost = secured(async ({ env }, user, { start, end }) => {
  if (![start, end].every(Number.isInteger)) return json({ error: "Datas inválidas." }, 400);
  if (start % STEP || end % STEP) return json({ error: "Use horários em múltiplos de 30 minutos." }, 400);
  if (end <= start || end - start > MAX_WINDOW) return json({ error: "A janela deve ter entre 30 min e 8 h." }, 400);
  if (start <= Date.now()) return json({ error: "A janela precisa estar no futuro." }, 400);

  const stmt = env.DB.prepare("INSERT OR IGNORE INTO slots (monitor_id, start_ts, end_ts) VALUES (?, ?, ?)");
  const batch = [];
  for (let t = start; t < end; t += STEP) batch.push(stmt.bind(user.id, t, t + STEP));
  const res = await env.DB.batch(batch); // atômico
  return json({ created: res.reduce((n, r) => n + r.meta.changes, 0) }, 201);
}, { body: true });
