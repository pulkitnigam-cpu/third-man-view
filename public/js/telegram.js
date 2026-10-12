// Sends generated briefs, newsletters and reports to Arjun on Telegram (@Thirdmanviewbot) via /api/telegram,
// and shows the delivery status next to the output.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export async function sendToTelegram(markdown, statusEl, kind) {
  const set = (cls, html) => { if (statusEl) { statusEl.className = `tg-status ${cls}`; statusEl.innerHTML = html; } };
  set("busy", "Sending to Telegram…");
  try {
    const r = await fetch("api/telegram", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ markdown, kind }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    set("ok", `Sent to Telegram ✓ <span class="muted">(${j.messages} message${j.messages > 1 ? "s" : ""})</span>`);
    return true;
  } catch (e) {
    const startHint = /press Start/i.test(e.message);
    set("err", startHint ? `Not sent: open <a href="https://t.me/Thirdmanviewbot" target="_blank" rel="noopener">t.me/Thirdmanviewbot</a> and press <b>Start</b>, then resend.` : `Not sent to Telegram: ${esc(e.message)}`);
    return false;
  }
}

// A status line plus a "Send again" button, placed next to any generated output.
export const tgBar = (id) => `<span class="tg-status" id="${id}"></span><button class="btn" data-tg="${id}">Send to Telegram</button>`;

// Send and remember the outcome on `holder.tg` ({ cls, html }); refresh the status element if it's on screen.
export async function deliver(markdown, holder, elId) {
  holder.tg = { cls: "busy", html: "Sending to Telegram…" };
  const paint = () => { const el = document.getElementById(elId); if (el) { el.className = `tg-status ${holder.tg.cls}`; el.innerHTML = holder.tg.html; } };
  paint();
  const fake = { set className(v) { holder.tg.cls = v.replace("tg-status ", ""); }, set innerHTML(v) { holder.tg.html = v; } };
  await sendToTelegram(markdown, fake, elId);
  paint();
}
export const tgStatus = (holder, id) => `<span class="tg-status ${holder?.tg?.cls || ""}" id="${id}">${holder?.tg?.html || ""}</span><button class="btn" data-tg="${id}">Send to Telegram</button>`;
