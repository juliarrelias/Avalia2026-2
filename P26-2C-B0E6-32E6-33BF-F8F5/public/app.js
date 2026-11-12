"use strict";
const $ = (s) => document.querySelector(s);
const DAY = 864e5, H0 = 7, H1 = 22; // grade de 07h às 22h
const fmtT = (ms) => new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const fmtD = (ms) => new Date(ms).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
const state = { me: null, mode: "aluno", week: mondayOf(new Date()), slots: [] };

function mondayOf(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
function el(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  kids.flat().forEach((k) => e.append(k));
  return e;
}
function toast(msg, err) {
  const t = $("#toast");
  t.textContent = msg; t.className = "show" + (err ? " err" : "");
  clearTimeout(toast.id); toast.id = setTimeout(() => (t.className = ""), 3500);
}
async function api(path, method = "GET", body) {
  const res = await fetch("/api" + path, {
    method, headers: body ? { "Content-Type": "application/json" } : {},
    body: body && JSON.stringify(body),
  });
  const data = res.status === 204 ? null : await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Erro inesperado.");
  return data;
}
async function act(fn, okMsg) {
  try { await fn(); if (okMsg) toast(okMsg); }
  catch (e) { toast(e.message, true); } // o 409 chega aqui com a mensagem de conflito
  if ($("#dlg").open) $("#dlg").close();
  await refresh().catch(() => {});
}

/* ---------- modal ---------- */
function modal(title, body, ...buttons) {
  const d = $("#dlg");
  d.replaceChildren(
    el("h3", { textContent: title }), ...[].concat(body),
    el("div", { className: "actions" }, el("button", { textContent: "Fechar", onclick: () => d.close() }), ...buttons)
  );
  d.showModal();
}
function bookDialog(s) {
  const ta = el("textarea", { maxLength: 300, placeholder: "Ex.: dúvida sobre recursão na lista 3" });
  modal(`Reservar ${fmtD(s.start)}, ${fmtT(s.start)}–${fmtT(s.end)}`,
    [el("p", { textContent: `Monitor: ${s.monitor.name}` }), el("label", {}, "Tema da dúvida", ta)],
    el("button", { className: "primary", textContent: "Confirmar reserva",
      onclick: () => act(() => api("/bookings", "POST", { slot_id: s.id, topic: ta.value }), "Horário reservado.") }));
}
function manageDialog(s) {
  const own = s.monitor.id === state.me.id;
  const body = [];
  if (s.student) body.push(el("p", { textContent: `Aluno: ${s.student}` }));
  body.push(el("p", { textContent: s.booked ? `Tema: ${s.topic}` : "Este horário está livre." }));
  const btns = [];
  if (s.booked) btns.push(el("button", { className: "danger", textContent: "Cancelar agendamento",
    onclick: () => act(() => api("/bookings/" + s.booking_id, "DELETE"), "Agendamento cancelado.") }));
  if (own) btns.push(el("button", { className: "danger", textContent: "Remover horário",
    onclick: () => act(() => api("/slots/" + s.id, "DELETE"), "Horário removido.") }));
  modal(`${fmtD(s.start)}, ${fmtT(s.start)}–${fmtT(s.end)}`, body, ...btns);
}

/* ---------- grade ---------- */
function chip(s) {
  const own = s.monitor.id === state.me.id;
  const cls = s.mine ? "mine" : s.booked ? "taken" : "free";
  let label;
  if (state.mode === "monitor") label = s.booked ? `Reservado · ${s.student}` : "Livre";
  else label = own ? "Seu horário" : s.mine ? `Você · ${s.monitor.name}` : s.monitor.name;

  const b = el("button", { className: "slot " + cls }, `${fmtT(s.start)}–${fmtT(s.end)}`, el("small", { textContent: label }));
  if (s.start <= Date.now()) { b.disabled = true; b.style.opacity = 0.5; return b; }

  if (state.mode === "monitor" && own) b.onclick = () => manageDialog(s);
  else if (state.mode === "aluno" && s.mine) b.onclick = () => manageDialog(s);
  else if (state.mode === "aluno" && !s.booked && !own) b.onclick = () => bookDialog(s);
  else b.disabled = true;
  return b;
}
function render() {
  const g = $("#grid");
  const days = [...Array(7)].map((_, i) => new Date(state.week.getTime() + i * DAY));
  const opt = { day: "2-digit", month: "short" };
  $("#range").textContent = `${days[0].toLocaleDateString("pt-BR", opt)} – ${days[6].toLocaleDateString("pt-BR", { ...opt, year: "numeric" })}`;
  const visible = state.slots.filter((s) => state.mode === "aluno" || s.monitor.id === state.me.id);
  const today = new Date().toDateString();

  g.replaceChildren(el("div", { className: "h" }),
    ...days.map((d) => el("div", { className: "h" + (d.toDateString() === today ? " today" : ""), textContent: fmtD(d.getTime()) })));
  for (let h = H0; h < H1; h++) {
    g.append(el("div", { className: "t", textContent: String(h).padStart(2, "0") + "h" }));
    days.forEach((d) => {
      const from = new Date(d).setHours(h, 0, 0, 0), to = from + 36e5;
      const cell = el("div");
      visible.filter((s) => s.start >= from && s.start < to).forEach((s) => cell.append(chip(s)));
      g.append(cell);
    });
  }
  if (!visible.length) g.append(el("p", { className: "empty", textContent: state.mode === "monitor"
    ? "Nenhum horário aberto nesta semana. Use o formulário acima."
    : "Nenhum horário disponível nesta semana." }));
}

async function refresh() {
  const from = state.week.getTime();
  const [{ slots }, { bookings }] = await Promise.all([api(`/slots?from=${from}&to=${from + 7 * DAY}`), api("/bookings")]);
  state.slots = slots;
  render();
  $("#mine").hidden = state.mode !== "aluno";
  $("#mineList").replaceChildren(...(bookings.length
    ? bookings.map((b) => el("li", {},
        el("span", { textContent: `${fmtD(b.start_ts)}, ${fmtT(b.start_ts)} · ${b.monitor_name} · ${b.topic}` }),
        el("button", { className: "danger", textContent: "Cancelar",
          onclick: () => act(() => api("/bookings/" + b.id, "DELETE"), "Agendamento cancelado.") })))
    : [el("li", { textContent: "Você ainda não tem reservas futuras." })]));
}

/* ---------- eventos ---------- */
function setMode(m) {
  state.mode = m;
  $("#tab-aluno").setAttribute("aria-selected", m === "aluno");
  $("#tab-monitor").setAttribute("aria-selected", m === "monitor");
  $("#windowForm").hidden = m !== "monitor";
  refresh().catch((e) => toast(e.message, true));
}
function shiftWeek(n) {
  const d = new Date(state.week); d.setDate(d.getDate() + 7 * n);
  state.week = d; refresh().catch((e) => toast(e.message, true));
}
$("#tab-aluno").onclick = () => setMode("aluno");
$("#tab-monitor").onclick = () => setMode("monitor");
$("#prev").onclick = () => shiftWeek(-1);
$("#next").onclick = () => shiftWeek(1);
$("#today").onclick = () => { state.week = mondayOf(new Date()); refresh().catch(() => {}); };
$("#windowForm").onsubmit = (e) => {
  e.preventDefault();
  const at = (t) => new Date(`${$("#wDate").value}T${t}`).getTime();
  act(() => api("/slots", "POST", { start: at($("#wStart").value), end: at($("#wEnd").value) }), "Horários disponibilizados.");
};

/* ---------- início ---------- */
(async function init() {
  const err = new URLSearchParams(location.search).get("auth_error");
  const { user } = await api("/me").catch(() => ({ user: null }));
  if (!user) {
    $("#login").hidden = false;
    if (err) { const p = $("#authError"); p.hidden = false; p.textContent = "Não foi possível entrar (" + err + "). Tente de novo."; }
    return;
  }
  state.me = user;
  $("#auth").append(
    el("img", { src: user.avatar || "", alt: "" }),
    el("span", { textContent: user.name }),
    el("button", { textContent: "Sair", onclick: async () => { await api("/auth/logout", "POST"); location.href = "/"; } })
  );
  $("#app").hidden = false;
  await refresh().catch((e) => toast(e.message, true));
  setInterval(() => { if (!document.hidden && !$("#dlg").open) refresh().catch(() => {}); }, 20000); // mantém a grade atualizada
})();
