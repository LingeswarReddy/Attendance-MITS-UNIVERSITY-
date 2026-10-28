// pages/api/attendance.js

const { scrapeAttendance } = require("../../lib/scraper");

export default async function handler(req, res) {
  // Allow only POST requests
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed",
    });
  }

  // Get roll number and password from the request
  const { roll, password } = req.body || {};

  // Validate required fields
  if (!roll || !password) {
    return res.status(400).json({
      success: false,
      error: "Roll number and password are required.",
    });
  }

  try {
    console.log("Starting attendance scrape for:", roll.trim());

    // Fetch attendance details from the scraper
    const result = await scrapeAttendance(roll.trim(), password);

    // Support both the original array response and an object response
    const data = Array.isArray(result) ? result : result?.data;

    // Extract the student name if the scraper provides it
    const studentName = Array.isArray(result)
      ? ""
      : result?.studentName || result?.name || "";

    // Validate the scraper response
    if (!Array.isArray(data)) {
      throw new Error("Invalid attendance data returned by the scraper.");
    }

    // Send attendance data and student name to the frontend
    return res.status(200).json({
      success: true,
      data,
      studentName,
    });
  } catch (err) {
    console.error("Attendance scrape error:", err.message);

    return res.status(500).json({
      success: false,
      error: err.message || "Failed to fetch attendance data.",
    });
  }
}

// API configuration
export const config = {
  api: {
    bodyParser: true,
    responseLimit: false,
  },
};
