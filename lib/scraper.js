// lib/scraper.js — MITS IMS scraper
//
// MITS IMS is a Single Page Application (SPA) at studentIndex.html#
// Every section loads via JavaScript — all hrefs are "#".
// We cannot navigate by URL. We must:
//   1. Wait for the JS to render the sidebar (body grows beyond ~310 chars)
//   2. Click the sidebar link
//   3. Wait for the main content area to update
//
// Timing reality from logs:
//   Homepage:      ~5-7s   MITS server latency
//   Login POST:    ~8-9s   MITS server processing
//   SPA render:    ~1-2s   JS rendering sidebar after login
//   Per section:   ~1s     JS swapping content

"use strict";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Chrome ──────────────────────────────────────────────────
const findChrome = () => {
  const fs = require("fs");
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    (process.env.LOCALAPPDATA || "") + "\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  for (const p of candidates) {
    try { if (p && fs.existsSync(p)) return p; } catch {}
  }
  return null;
};

const LAUNCH_ARGS = [
  "--no-sandbox", "--disable-setuid-sandbox",
  "--disable-dev-shm-usage", "--disable-gpu",
  "--disable-extensions", "--disable-background-networking",
  "--disable-default-apps", "--no-first-run",
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
];

const getBrowser = async () => {
  const puppeteer = require("puppeteer-core");
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const chromium = require("@sparticuz/chromium");
    return puppeteer.launch({
      args: [...chromium.args, ...LAUNCH_ARGS],
      defaultViewport: { width: 1024, height: 768 },
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });
  }
  const executablePath = findChrome();
  if (!executablePath) throw new Error("Chrome/Edge not found.");
  return puppeteer.launch({
    executablePath, headless: "new",
    args: LAUNCH_ARGS,
    defaultViewport: { width: 1024, height: 768 },
  });
};

// ─── Request blocker ─────────────────────────────────────────
const BLOCK_RES = new Set(["image", "stylesheet", "font", "media"]);
const BLOCK_URL = ["google-analytics", "googletagmanager", "facebook", "doubleclick", "hotjar"];

const enableBlocking = async (page) => {
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (BLOCK_RES.has(req.resourceType())) return req.abort();
    if (BLOCK_URL.some((h) => req.url().includes(h))) return req.abort();
    req.continue();
  });
};

// ─── Helpers ─────────────────────────────────────────────────
const getBodyText = async (page) => {
  try { return await page.evaluate(() => document.body?.innerText ?? ""); }
  catch { return ""; }
};

// Wait for body innerText to grow past a minimum length.
// Used to detect when the SPA has rendered content.
const waitForBodyLength = async (page, minLen, timeout = 15000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const len = await page.evaluate(() => document.body?.innerText?.length ?? 0);
      if (len >= minLen) return len;
    } catch {}
    await sleep(200);
  }
  return 0;
};

// Wait for a specific text string to appear in the body.
const waitForText = async (page, needle, timeout = 15000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const found = await page.evaluate(
        (n) => (document.body?.innerText ?? "").includes(n), needle
      );
      if (found) return true;
    } catch {}
    await sleep(200);
  }
  return false;
};

// ─── SPA section switcher ─────────────────────────────────────
// Clicks a sidebar link by exact text match, then waits for the
// main content area to change. No navigation events fire in a SPA.
const switchSection = async (page, linkText, t0) => {
  console.log(`[${Date.now() - t0}ms] Switching to "${linkText}"...`);

  // Snapshot content length before click so we can detect change
  const lenBefore = await page.evaluate(
    () => document.body?.innerText?.length ?? 0
  ).catch(() => 0);

  // Click — exact text on <a> or <li> or <div>
  const clicked = await page.evaluate((text) => {
    const all = [...document.querySelectorAll("a, li, span, div, td")];
    // Exact match first
    for (const el of all) {
      if ((el.innerText || el.textContent || "").trim() === text) {
        el.click(); return "exact:" + el.tagName;
      }
    }
    // Partial match fallback
    for (const el of all) {
      if ((el.innerText || el.textContent || "").trim().includes(text)) {
        el.click(); return "partial:" + el.tagName;
      }
    }
    return null;
  }, linkText);

  console.log(`  click result: ${clicked}`);
  if (!clicked) {
    // Dump all text nodes to diagnose what's in the sidebar
    const allText = await page.evaluate(() =>
      [...document.querySelectorAll("a, li")]
        .map((el) => (el.innerText || "").trim())
        .filter(Boolean)
        .slice(0, 40)
    ).catch(() => []);
    console.log("  Visible links/items:", JSON.stringify(allText));
    throw new Error(`"${linkText}" not found in page. See links above.`);
  }

  // Wait for content to change (SPA swaps the main div's content)
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    await sleep(200);
    try {
      const len = await page.evaluate(() => document.body?.innerText?.length ?? 0);
      if (len !== lenBefore) {
        // Content changed — wait a tiny bit more for full render
        await sleep(300);
        console.log(`  [${Date.now() - t0}ms] content updated (${lenBefore} → ${len} chars)`);
        return;
      }
    } catch { return; } // context destroyed = navigation happened, that's fine
  }
  console.log(`  [${Date.now() - t0}ms] content did not change — proceeding anyway`);
};

// ─── Parser: Subject Details ──────────────────────────────────
const parseSubjectDetails = (raw) => {
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const map   = {};

  for (let i = 0; i < lines.length; i++) {
    if (!/^\d+$/.test(lines[i])) continue;
    const serial = parseInt(lines[i], 10);
    if (serial < 1 || serial > 60) continue;
    if (i + 3 >= lines.length) continue;

    const code    = lines[i + 1];
    const name    = lines[i + 2];
    const faculty = lines[i + 3];

    if (!code || /^\d+(\.\d+)?$/.test(code)) continue;
    if (/^(s\.no|subject|code|class|total|attend|semester|dashboard|progress|sl)/i.test(code)) continue;
    if (!faculty || /^\d/.test(faculty) || /email:/i.test(faculty)) continue;

    const key = code.toUpperCase().trim();
    if (!map[key]) {
      map[key] = { name: name.trim(), faculty: faculty.trim() };
      console.log(`  detail [${key}] "${name.trim()}" | "${faculty.trim()}"`);
    }
  }
  return map;
};

// ─── Parser: Attendance table ─────────────────────────────────
const parseAttendanceTable = (raw) => {
  const lines  = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const result = [];

  let hi = -1;
  for (let i = 0; i < lines.length; i++) {
    const u = lines[i].toUpperCase();
    if (u.includes("CLASSES ATTENDED") || u.includes("TOTAL CONDUCTED")) { hi = i; break; }
  }
  if (hi === -1) return result;

  let i = hi + 1;
  // Skip column header lines
  while (i < lines.length) {
    const u = lines[i].toUpperCase();
    if (["S.NO","S NO","SNO"].includes(u) ||
        u.includes("SUBJECT CODE") || u.includes("CLASSES ATTENDED") ||
        u.includes("TOTAL CONDUCTED") || u.includes("ATTENDANCE %")) {
      i++; continue;
    }
    break;
  }

  while (i + 4 < lines.length) {
    const sNo = lines[i];
    if (/^(note|total|grand|@)/i.test(sNo)) break;
    if (!/^\d+$/.test(sNo) || parseInt(sNo, 10) > 99) { i++; continue; }

    const code = lines[i + 1];
    const attS = lines[i + 2];
    const conS = lines[i + 3];
    const pctS = lines[i + 4];

    if (!code || /^\d+$/.test(code)) { i++; continue; }
    if (!/^\d+$/.test(attS) || !/^\d+$/.test(conS)) { i++; continue; }

    const attended  = parseInt(attS, 10);
    const conducted = parseInt(conS, 10);
    if (conducted <= 0) { i++; continue; }

    const pctParsed = parseFloat(pctS);
    const percentage = isNaN(pctParsed)
      ? parseFloat(((attended / conducted) * 100).toFixed(2))
      : parseFloat(pctParsed.toFixed(2));

    result.push({
      sNo, subjectCode: code, subject: code, faculty: "",
      attended, conducted, percentage,
      status: percentage >= 75 ? "Safe" : percentage >= 65 ? "Border" : "Danger",
    });
    console.log(`  row [${code}] ${attended}/${conducted} ${percentage}%`);
    i += 5;
  }
  return result;
};

// ─── Parser: Attendance cards (fallback) ─────────────────────
const parseAttendanceCards = (raw) => {
  const lines  = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const result = [];

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^Attended:\s*(\d+)\s*\/\s*(\d+)$/i);
    if (!m) continue;
    const attended  = parseInt(m[1], 10);
    const conducted = parseInt(m[2], 10);
    if (conducted <= 0) continue;

    let code = "", name = "";
    for (let b = 1; b <= 5; b++) {
      const c = lines[i - b]; if (!c) continue;
      if (/^(Attended|Status|Attendance|Cards|Table|Download|Show)/i.test(c)) continue;
      if (/^[\d.]+%$/.test(c)) continue;
      const pipe = c.match(/^(.+?)\s*\|\s*(.+)$/);
      if (pipe) { code = pipe[1].trim(); name = pipe[2].trim(); }
      else        code = c.trim();
      break;
    }
    if (!code) continue;

    let status = "", pct = parseFloat(((attended / conducted) * 100).toFixed(2));
    for (let f = 1; f <= 5; f++) {
      const nx = lines[i + f]; if (!nx) continue;
      const sm = nx.match(/^Status:\s*(.+)$/i);
      const pm = nx.match(/^Attendance:\s*([\d.]+)/i);
      if (sm) status = sm[1].trim();
      if (pm) pct    = parseFloat(parseFloat(pm[1]).toFixed(2));
    }
    if (!status) status = pct >= 75 ? "Safe" : pct >= 65 ? "Border" : "Danger";

    result.push({
      sNo: String(result.length + 1),
      subjectCode: code, subject: name || code, faculty: "",
      attended, conducted, percentage: pct, status,
    });
  }
  return result;
};

const parseAttendance = (raw) => {
  const table = parseAttendanceTable(raw);
  if (table.length > 0) { console.log(`  → table: ${table.length} rows`); return table; }
  const cards = parseAttendanceCards(raw);
  console.log(`  → cards: ${cards.length} rows`);
  return cards;
};

// ─── Main ─────────────────────────────────────────────────────
const scrapeAttendance = async (roll, password) => {
  const t0    = Date.now();
  let browser = null, page = null;

  try {
    browser = await getBrowser();
    page    = await browser.newPage();
    await enableBlocking(page);
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
    );

    // ── 1. Homepage ───────────────────────────────────────────
    console.log(`[${Date.now() - t0}ms] Loading mitsims.in...`);
    await page.goto("http://mitsims.in/", { waitUntil: "domcontentloaded", timeout: 45000 });
    // Wait for at least one link (page is interactive)
    await waitForText(page, "Student", 8000);

    // ── 2. Student link ───────────────────────────────────────
    console.log(`[${Date.now() - t0}ms] Student link...`);
    await page.evaluate(() => {
      for (const a of document.querySelectorAll("a")) {
        const id   = (a.id || "").toLowerCase();
        const text = (a.innerText || a.textContent || "").trim().toLowerCase();
        if (id === "studentlink" || text === "student") { a.click(); return; }
      }
    });

    // Wait for the login form inputs to appear
    const formOk = await waitForText(page, "Password", 8000);
    if (!formOk) throw new Error("Login form not found.");

    // ── 3. Credentials ────────────────────────────────────────
    console.log(`[${Date.now() - t0}ms] Entering credentials...`);
    let inputs = await page.$$("#stuLogin input.login_box");
    if (inputs.length < 2) inputs = await page.$$("#stuLogin input");
    if (inputs.length < 2) inputs = await page.$$("input.login_box");
    if (inputs.length < 2) throw new Error("Login inputs not found — MITS IMS may be down.");

    await inputs[0].click({ clickCount: 3 });
    await inputs[0].type(roll,     { delay: 30 });
    await inputs[1].click({ clickCount: 3 });
    await inputs[1].type(password, { delay: 30 });

    // ── 4. Submit ─────────────────────────────────────────────
    let submitted = false;
    for (const sel of ["#stuLogin button[type='submit']", "#stuLogin button",
                        "button[type='submit']", "input[type='submit']"]) {
      const btn = await page.$(sel).catch(() => null);
      if (btn) { await btn.click(); submitted = true; break; }
    }
    if (!submitted) await inputs[1].press("Enter");
    console.log(`[${Date.now() - t0}ms] Submitted...`);

    // ── 5. Wait for SPA to render post-login sidebar ──────────
    // After login the SPA loads studentIndex.html# and renders the
    // sidebar via JS. Body starts at 310 chars (just the header).
    // We wait until "Subject Details" text appears — that means the
    // sidebar has fully rendered and is clickable.
    console.log(`[${Date.now() - t0}ms] Waiting for sidebar to render...`);
    const sidebarReady = await waitForText(page, "Subject Details", 20000);
    if (!sidebarReady) {
      const body = await getBodyText(page);
      // Check for login error
      for (const phrase of ["invalid", "incorrect", "wrong password", "login failed"]) {
        if (body.toLowerCase().includes(phrase))
          throw new Error("Invalid credentials — check roll number and password.");
      }
      throw new Error(`Sidebar did not render. Body preview: ${body.slice(0, 300)}`);
    }
    console.log(`[${Date.now() - t0}ms] Logged in ✓ (sidebar ready)`);

    // ── 6. Subject Details ────────────────────────────────────
    await switchSection(page, "Subject Details", t0);
    const detailRaw = await getBodyText(page);
    console.log(`[${Date.now() - t0}ms] Subject Details: ${detailRaw.length} chars`);
    console.log("--- DETAIL (first 500) ---\n" + detailRaw.slice(0, 500) + "\n---");
    const detailMap = parseSubjectDetails(detailRaw);
    console.log(`  detail map: ${Object.keys(detailMap).length} entries`);

    // ── 7. Attendance ─────────────────────────────────────────
    await switchSection(page, "Attendance", t0);
    const attRaw = await getBodyText(page);
    console.log(`[${Date.now() - t0}ms] Attendance: ${attRaw.length} chars`);
    console.log("--- ATT (first 600) ---\n" + attRaw.slice(0, 600) + "\n---");

    // ── 8. Parse & merge ──────────────────────────────────────
    let rows = parseAttendance(attRaw);
    if (rows.length === 0) {
      throw new Error(`No rows found.\nPreview: ${attRaw.replace(/\s+/g, " ").slice(0, 400)}`);
    }

    rows = rows.map((row) => {
      const key = row.subjectCode.toUpperCase().trim();
      const d   = detailMap[key];
      return {
        ...row,
        subject: (row.subject && row.subject !== row.subjectCode)
                    ? row.subject : (d?.name || row.subjectCode),
        faculty: d?.faculty || "",
      };
    });

    console.log(`[${Date.now() - t0}ms] Complete ✓`);
    rows.forEach((r) =>
      console.log(`  ${r.sNo}. [${r.subjectCode}] "${r.subject}" | ${r.faculty} | ${r.attended}/${r.conducted} ${r.percentage}%`)
    );
    return rows;

  } finally {
    if (page)    await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
};

module.exports = { scrapeAttendance };