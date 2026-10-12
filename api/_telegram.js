// Telegram delivery for @Thirdmanviewbot. The token stays on the server.
// Recipients: TELEGRAM_CHAT_ID (comma-separated) if set, otherwise every chat that has pressed Start (from getUpdates).
const API = (m) => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${m}`;
let known = { ids: [], until: 0 };

export async function tg(method, body) {
  if (!process.env.TELEGRAM_BOT_TOKEN) throw Object.assign(new Error("TELEGRAM_BOT_TOKEN is not set"), { status: 503 });
  const r = await fetch(API(method), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw Object.assign(new Error(j.description || `Telegram ${r.status}`), { status: 502 });
  return j.result;
}

export async function chatIds() {
  const fixed = (process.env.TELEGRAM_CHAT_ID || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (fixed.length) return fixed;
  if (known.until > Date.now() && known.ids.length) return known.ids;
  const ups = await tg("getUpdates", { allowed_updates: ["message", "my_chat_member"] }).catch(() => []);
  const ids = new Set(known.ids);
  for (const u of ups) { const c = (u.message || u.my_chat_member)?.chat; if (c?.type === "private") ids.add(String(c.id)); }
  known = { ids: [...ids], until: Date.now() + 10 * 60 * 1000 };
  return known.ids;
}

// Our Markdown (headings, bold, italic, lists, links) -> Telegram HTML
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export function mdToHtml(md) {
  const inline = (t) => esc(t)
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, "$1<i>$2</i>")
    .replace(/(^|\s)_(?!\s)(.+?)_(?=\s|$|[.,;:])/g, "$1<i>$2</i>");
  return String(md || "").split(/\r?\n/).map((line) => {
    const h = line.match(/^(#{1,3})\s+(.*)/);
    if (h) return h[1].length === 1 ? `<b>${inline(h[2]).toUpperCase()}</b>` : `\n<b>${inline(h[2])}</b>`;
    const li = line.match(/^\s*[-*•]\s+(.*)/);
    if (li) return `• ${inline(li[1])}`;
    return inline(line);
  }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Telegram caps a message at 4096 characters: split on blank lines, never inside a tag
function chunks(html, max = 3800) {
  const out = []; let cur = "";
  for (const para of html.split(/\n\n/)) {
    const piece = para.length > max ? para.slice(0, max) : para;
    if ((cur + "\n\n" + piece).length > max && cur) { out.push(cur); cur = piece; } else cur = cur ? cur + "\n\n" + piece : piece;
  }
  if (cur) out.push(cur);
  return out;
}

export async function sendReport(markdown) {
  const ids = await chatIds();
  if (!ids.length) throw Object.assign(new Error("No Telegram chat yet: open t.me/Thirdmanviewbot and press Start"), { status: 409 });
  const parts = chunks(mdToHtml(markdown));
  for (const id of ids) for (const [i, text] of parts.entries()) {
    await tg("sendMessage", { chat_id: id, text: parts.length > 1 ? `${text}\n\n<i>(${i + 1}/${parts.length})</i>` : text, parse_mode: "HTML", disable_web_page_preview: true });
  }
  return { chats: ids.length, messages: parts.length };
}
