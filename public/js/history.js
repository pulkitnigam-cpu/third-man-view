// "Sent to Arjun": every brief, newsletter and report delivered on Telegram, from the Neon history (/api/reports).
import { md } from "./brief.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const when = (iso) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });

export async function openHistory() {
  const dlg = $("#history"), body = $("#hiBody");
  $("#hiClose").onclick = () => dlg.close();
  dlg.onclick = (e) => { if (e.target === dlg) dlg.close(); };
  if (!dlg.open) dlg.showModal();
  list(body);
}

async function list(body) {
  $("#hiTitle").textContent = "History";
  body.innerHTML = `<div class="sk" style="height:56px"></div><div class="sk" style="height:56px"></div>`;
  const j = await fetch("api/reports").then((r) => r.json()).catch(() => ({ error: "Couldn't load the history" }));
  if (j.error) { body.innerHTML = `<div class="empty">${esc(j.error)}</div>`; return; }
  if (!j.configured) { body.innerHTML = `<div class="empty">History needs the Neon database (DATABASE_URL). Reports are still sent to Telegram.</div>`; return; }
  if (!j.reports.length) { body.innerHTML = `<div class="empty">Nothing sent yet. Write a newsletter or a brief and it will appear here.</div>`; return; }
  body.innerHTML = `<ul class="hi-list">${j.reports.map((r) => `<li><button data-id="${r.id}">
    <span class="hi-kind">${esc(r.kind)}</span><span class="hi-t">${esc(r.title)}</span>
    <span class="hi-meta">${when(r.created_at)} · ${r.delivered ? "delivered" : "not delivered"}</span></button></li>`).join("")}</ul>`;
  body.querySelectorAll("[data-id]").forEach((b) => (b.onclick = () => show(body, b.dataset.id)));
}

async function show(body, id) {
  body.innerHTML = `<div class="sk" style="height:240px"></div>`;
  const j = await fetch(`api/reports?id=${id}`).then((r) => r.json()).catch(() => ({}));
  if (!j.report) { body.innerHTML = `<div class="empty">Couldn't open that report.</div>`; return; }
  $("#hiTitle").textContent = j.report.kind;
  body.innerHTML = `<button class="btn hi-back">← All reports</button><p class="hi-meta">${when(j.report.created_at)} · ${j.report.delivered ? "delivered to Telegram" : "not delivered"}</p><article class="card brief newsletter">${md(j.report.markdown, esc)}</article>`;
  body.querySelector(".hi-back").onclick = () => list(body);
}
