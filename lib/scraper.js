// lib/scraper.js — MITS IMS scraper

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  for (const p of candidates) {
    try { if (p && fs.existsSync(p)) return p; } catch {}
  }
  return null;
};

const getBrowser = async () => {
  const puppeteer = require("puppeteer-core");
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const chromium = require("@sparticuz/chromium");
    return puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });
  }
  const executablePath = findChrome();
  if (!executablePath) throw new Error("Google Chrome not found. Install Chrome and retry.");
  return puppeteer.launch({
    executablePath,
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
};

const getBodyText = async (page) => {
  try { return await page.evaluate(() => document.body?.innerText || ""); }
  catch { return ""; }
};

// ─────────────────────────────────────────────────────────────
// parseSubjectDetails
// Handles this exact format from Subject Details page:
//
//   1
//   SOFTSKILLS
//   SOFT SKILLS
//   ANANDAKUMAR
//   Email:anandakumarv@mits.ac.in
//   Ext No: -
//   0.0
//   0.0
//   2
//   APPTITUDE
//   APPTITUDE
//   TIPU RAHAMAN
//   Email:tipurahamans@mits.ac.in
//   ...
//
// Returns { "SOFTSKILLS": { name:"SOFT SKILLS", faculty:"ANANDAKUMAR" }, ... }
// ─────────────────────────────────────────────────────────────
const parseSubjectDetails = (rawText) => {
  const lines = rawText.split("\n").map(l => l.trim()).filter(Boolean);
  const map = {};

  console.log("  parseSubjectDetails — total lines:", lines.length);
  // Print first 40 lines to diagnose
  lines.slice(0, 40).forEach((l, i) => console.log(`  [${i}] ${l}`));

  for (let i = 0; i < lines.length; i++) {
    // Must be a serial number 1-30
    if (!/^\d+$/.test(lines[i])) continue;
    const serial = parseInt(lines[i]);
    if (serial < 1 || serial > 30) continue;

    // Need at least 4 more lines
    if (i + 4 >= lines.length) continue;

    const subjectCode = lines[i + 1];
    const subjectName = lines[i + 2];
    const facultyName = lines[i + 3];
    const line4       = lines[i + 4]; // Should be Email: or Ext No:

    // subjectCode must not be a number or header word
    if (/^\d+(\.\d+)?$/.test(subjectCode)) continue;
    if (/^(s\.no|subject|class|total|attend|semester|dashboard|progress)/i.test(subjectCode)) continue;

    // line4 must look like an email line OR ext line
    const isEmailOrExt = line4.toLowerCase().includes("email:") ||
                         line4.toLowerCase().includes("ext") ||
                         line4.includes("@mits.ac.in");

    if (!isEmailOrExt) {
      // Try one line earlier — sometimes email is at i+4 when subjectName = subjectCode
      const line3 = lines[i + 3];
      const line3isEmailOrExt = line3.toLowerCase().includes("email:") ||
                                line3.toLowerCase().includes("ext") ||
                                line3.includes("@mits.ac.in");
      if (line3isEmailOrExt) {
        // Pattern: sNo, code, name(=code), Email (no separate faculty name)
        // Skip this case — no faculty name available
        console.log(`  Skip (no faculty): [${subjectCode}]`);
        continue;
      }
      continue;
    }

    // facultyName must look like a name (letters and spaces, not a code)
    if (/^\d/.test(facultyName)) continue;
    if (facultyName.toLowerCase().includes("email:")) continue;

    const key = subjectCode.toUpperCase().trim();
    map[key] = {
      name: subjectName.trim(),
      faculty: facultyName.trim(),
    };
    console.log(`  ✓ Detail: [${key}] → "${subjectName}" | "${facultyName}"`);
  }

  return map;
};

// ─────────────────────────────────────────────────────────────
// parseAttendancePage
// Handles the card format seen in the page:
//   SOFTSKILLS | SOFT SKILLS
//   Attended: 2 / 2
//   Status: Safe
//   Attendance: 100%
// ─────────────────────────────────────────────────────────────
const parseAttendancePage = (rawText) => {
  const lines = rawText.split("\n").map(l => l.trim()).filter(Boolean);
  const result = [];

  for (let i = 0; i < lines.length; i++) {
    const attendedMatch = lines[i].match(/^Attended:\s*(\d+)\s*\/\s*(\d+)$/i);
    if (!attendedMatch) continue;

    const attended  = parseInt(attendedMatch[1], 10);
    const conducted = parseInt(attendedMatch[2], 10);
    if (conducted <= 0) continue;

    // Look back up to 4 lines for the subject line
    let subjectCode = "", subjectName = "";
    for (let back = 1; back <= 4; back++) {
      const candidate = lines[i - back];
      if (!candidate) continue;
      if (/^(Attended|Status|Attendance|Cards|Table|Exclude|Download|Show|Subject Performance|^\d+\.?\d*%$)/i.test(candidate)) continue;
      if (/^[\d.]+%$/.test(candidate)) continue;

      const pipeMatch = candidate.match(/^(.+?)\s*\|\s*(.+)$/);
      if (pipeMatch) {
        subjectCode = pipeMatch[1].trim();
        subjectName = pipeMatch[2].trim();
      } else {
        subjectCode = candidate.trim();
        subjectName = "";
      }
      break;
    }

    if (!subjectCode) continue;

    let status = "Unknown";
    let percentage = parseFloat(((attended / conducted) * 100).toFixed(2));
    for (let fwd = 1; fwd <= 5; fwd++) {
      const nx = lines[i + fwd];
      if (!nx) continue;
      const sm = nx.match(/^Status:\s*(.+)$/i);
      const pm = nx.match(/^Attendance:\s*([\d.]+)/i);
      if (sm) status = sm[1].trim();
      if (pm) percentage = parseFloat(parseFloat(pm[1]).toFixed(2));
    }
    if (status === "Unknown") status = percentage >= 75 ? "Safe" : percentage >= 65 ? "Border" : "Danger";

    result.push({
      sNo: String(result.length + 1),
      subjectCode,
      subject: subjectName || subjectCode,
      faculty: "",
      attended,
      conducted,
      percentage,
      status,
    });
    console.log(`  ✓ Att: [${subjectCode}] "${subjectName}" ${attended}/${conducted} ${percentage}%`);
  }

  // Fallback: plain table format
  if (result.length === 0) {
    let headerIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toUpperCase().includes("CLASSES ATTENDED")) { headerIdx = i; break; }
    }
    if (headerIdx !== -1) {
      let dataStart = headerIdx + 1;
      while (dataStart < lines.length) {
        const l = lines[dataStart].toUpperCase();
        if (l.includes("SUBJECT CODE") || l.includes("CLASSES ATTENDED") ||
            l.includes("TOTAL CONDUCTED") || l.includes("ATTENDANCE") ||
            l === "S.NO" || l === "S NO") { dataStart++; continue; }
        if (/^\d+$/.test(lines[dataStart])) break;
        dataStart++;
      }
      let i = dataStart;
      while (i < lines.length) {
        const sNo = lines[i];
        if (!sNo || /^(note|total|grand)/i.test(sNo)) break;
        if (!/^\d+$/.test(sNo) || parseInt(sNo) > 99) { i++; continue; }
        if (i + 4 >= lines.length) break;
        const subjectCode = lines[i+1], attendedStr = lines[i+2], conductedStr = lines[i+3], pctStr = lines[i+4];
        if (/^\d+$/.test(subjectCode) || !/^\d+$/.test(attendedStr) || !/^\d+$/.test(conductedStr)) { i++; continue; }
        const attended = parseInt(attendedStr), conducted = parseInt(conductedStr);
        if (conducted <= 0) { i++; continue; }
        const pctVal = parseFloat(pctStr);
        const percentage = isNaN(pctVal) ? parseFloat(((attended/conducted)*100).toFixed(2)) : parseFloat(pctVal.toFixed(2));
        result.push({ sNo, subjectCode, subject: subjectCode, faculty: "", attended, conducted, percentage,
          status: percentage >= 75 ? "Safe" : percentage >= 65 ? "Border" : "Danger" });
        i += 5;
      }
    }
  }

  return result;
};

// ─────────────────────────────────────────────────────────────
// Click sidebar nav link — EXACT match first, then partial
// ─────────────────────────────────────────────────────────────
const clickSidebarLink = async (page, exactText) => {
  return await page.evaluate((text) => {
    // Try <a> tags first (sidebar links)
    const anchors = [...document.querySelectorAll("a")];
    for (const a of anchors) {
      const t = (a.innerText || a.textContent || "").trim();
      if (t === text) { a.click(); return "exact-a"; }
    }
    // Partial match on <a>
    for (const a of anchors) {
      const t = (a.innerText || a.textContent || "").trim();
      if (t.includes(text)) { a.click(); return "partial-a"; }
    }
    // Any clickable element
    const all = [...document.querySelectorAll("li, td, span, div")];
    for (const el of all) {
      const t = (el.innerText || "").trim();
      if (t === text) { el.click(); return "exact-el"; }
    }
    return null;
  }, exactText);
};

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────
const scrapeAttendance = async (roll, password) => {
  let browser = null, page = null;
  try {
    browser = await getBrowser();
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36");

    // 1. Load
    console.log("Opening mitsims.in...");
    await page.goto("http://mitsims.in/", { waitUntil: "domcontentloaded", timeout: 45000 });
    await sleep(3000);

    // 2. Student link
    await page.evaluate(() => {
      for (const link of document.querySelectorAll("a")) {
        const text = (link.innerText || "").toLowerCase();
        const id   = (link.id || "").toLowerCase();
        if (id === "studentlink" || text.trim() === "student") { link.click(); return; }
      }
    });
    await sleep(3000);

    // 3. Login
    let inputs = await page.$$("#stuLogin input.login_box");
    if (inputs.length < 2) inputs = await page.$$("#stuLogin input");
    if (inputs.length < 2) inputs = await page.$$("input.login_box");
    if (inputs.length < 2) throw new Error("Login form not found. MITS IMS may be down.");

    await inputs[0].click({ clickCount: 3 });
    await inputs[0].type(roll, { delay: 80 });
    await sleep(300);
    await inputs[1].click({ clickCount: 3 });
    await inputs[1].type(password, { delay: 80 });
    await sleep(400);

    let submitted = false;
    for (const sel of ["#stuLogin button[type='submit']","#stuLogin button","button[type='submit']","input[type='submit']"]) {
      try { const btn = await page.$(sel); if (btn) { await btn.click(); submitted = true; break; } } catch {}
    }
    if (!submitted) await inputs[1].press("Enter");

    try { await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }); } catch {}
    await sleep(6000);

    const afterLogin = await getBodyText(page);
    for (const phrase of ["invalid","incorrect","wrong password","login failed"]) {
      if (afterLogin.toLowerCase().includes(phrase))
        throw new Error("Invalid credentials. Please check your roll number and password.");
    }
    console.log("Logged in OK. Length:", afterLogin.length);

    // 4. Click "Subject Details" in sidebar
    console.log("Clicking Subject Details...");
    const sdResult = await clickSidebarLink(page, "Subject Details");
    console.log("Subject Details click result:", sdResult);
    await sleep(5000);

    const detailText = await getBodyText(page);
    console.log("Subject Details page length:", detailText.length);
    // Print first 800 chars to see exact format
    console.log("=== SUBJECT DETAILS SAMPLE ===\n" + detailText.slice(0, 800) + "\n===");

    const detailMap = parseSubjectDetails(detailText);
    console.log("Detail map entries:", Object.keys(detailMap).length);
    console.log("Keys:", JSON.stringify(Object.keys(detailMap)));

    // 5. Click "Attendance" in sidebar
    console.log("Clicking Attendance...");
    const attResult = await clickSidebarLink(page, "Attendance");
    console.log("Attendance click result:", attResult);
    await sleep(5000);

    const attText = await getBodyText(page);
    console.log("Attendance page length:", attText.length);
    console.log("=== ATTENDANCE SAMPLE ===\n" + attText.slice(0, 1000) + "\n===");

    // 6. Parse
    let data = parseAttendancePage(attText);
    console.log("Rows parsed:", data.length);

    if (data.length === 0) {
      throw new Error(`Attendance not detected. Preview: ${attText.replace(/\s+/g," ").slice(0,500)}`);
    }

    // 7. Merge
    data = data.map(row => {
      const key    = row.subjectCode.toUpperCase().trim();
      const detail = detailMap[key];
      if (detail) console.log(`  Merge [${key}]: name="${detail.name}" faculty="${detail.faculty}"`);
      else        console.log(`  No detail for [${key}]`);
      return {
        ...row,
        subject: (row.subject && row.subject !== row.subjectCode)
          ? row.subject
          : (detail?.name || row.subjectCode),
        faculty: detail?.faculty || "",
      };
    });

    console.log("=== FINAL DATA ===");
    data.forEach(r => console.log(`  ${r.sNo}. [${r.subjectCode}] ${r.subject} | ${r.faculty} | ${r.attended}/${r.conducted} | ${r.percentage}%`));

    return data;

  } finally {
    try { if (page) await page.close(); } catch {}
    try { if (browser) await browser.close(); } catch {}
  }
};

module.exports = { scrapeAttendance };