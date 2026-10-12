// GET  /api/telegram            -> { configured, bot, chats }   (is delivery ready?)
// POST /api/telegram { markdown, kind? } -> { sent: true, chats, messages, saved }
// Every brief, newsletter and report generated in the app is posted here and delivered to Arjun on Telegram,
// then kept in the Neon history (see /api/reports) whether or not delivery worked.
import { tg, chatIds, sendReport } from "./_telegram.js";
import { saveReport } from "./_db.js";

const KIND = { tgBrief: "Pre-match brief", tgNews: "Newsletter", tgReport: "Match report", tgPeriod: "Period review" };
const titleOf = (md) => (md.split("\n").map((l) => l.replace(/^#+\s*|\*\*/g, "").trim()).find(Boolean) || "Report").slice(0, 160);

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      if (!process.env.TELEGRAM_BOT_TOKEN) return res.status(200).json({ configured: false });
      const [me, ids] = await Promise.all([tg("getMe"), chatIds()]);
      return res.status(200).json({ configured: true, bot: me.username, chats: ids.length });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST" });
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    const md = String(body?.markdown || "").slice(0, 30000);
    if (md.length < 20) return res.status(400).json({ error: "Nothing to send" });
    let r, err;
    try { r = await sendReport(md); } catch (e) { err = e; }
    const saved = await saveReport({ kind: KIND[body?.kind] || "Report", title: titleOf(md), markdown: md, delivered: !err });
    if (err) throw err;
    return res.status(200).json({ sent: true, ...r, saved });
  } catch (e) {
    return res.status(e.status || 502).json({ error: String(e.message || e) });
  }
}
