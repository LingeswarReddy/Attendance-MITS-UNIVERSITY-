// pages/api/attendance.js
const { scrapeAttendance } = require("../../lib/scraper");

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { roll, password } = req.body || {};

  if (!roll || !password) {
    return res.status(400).json({ error: "Roll number and password are required." });
  }

  try {
    console.log("Starting scrape for:", roll);
    const data = await scrapeAttendance(roll.trim(), password);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    console.error("Scrape error:", err.message);
    return res.status(500).json({ success: false, error: err.message || "Unknown error" });
  }
}

export const config = {
  api: {
    bodyParser: true,
    responseLimit: false,
  },
};
