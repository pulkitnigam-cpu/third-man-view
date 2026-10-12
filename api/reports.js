// GET /api/reports        -> { configured, reports: [{ id, kind, title, delivered, created_at }] }  (latest 30)
// GET /api/reports?id=12  -> { report: { ..., markdown } }
// The history of everything sent to Arjun, kept in Neon Postgres.
import { dbReady, listReports, getReport } from "./_db.js";

export default async function handler(req, res) {
  if (!dbReady()) return res.status(200).json({ configured: false, reports: [] });
  try {
    const id = Number(req.query?.id || new URL(req.url, "http://x").searchParams.get("id"));
    res.setHeader("cache-control", "no-store");
    if (id) {
      const report = await getReport(id);
      return report ? res.status(200).json({ report }) : res.status(404).json({ error: "Not found" });
    }
    return res.status(200).json({ configured: true, reports: await listReports(30) });
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e) });
  }
}
