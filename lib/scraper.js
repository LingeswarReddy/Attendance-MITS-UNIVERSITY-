// lib/scraper.js — MITS IMS attendance scraper
// Handles the MITS IMS single-page application (SPA).
// Exports scrapeAttendance(roll, password) -> { studentName, data }.

"use strict";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ─── Browser setup ──────────────────────────────────────────────

const findChrome = () => {
  const fs = require("fs");
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    `${process.env.LOCALAPPDATA || ""}\\Google\\Chrome\\Application\\chrome.exe`,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];

  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) return candidate;
    } catch {
      // Try the next browser path.
    }
  }
  return null;
};

const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--disable-extensions",
  "--disable-background-networking",
  "--disable-default-apps",
  "--no-first-run",
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

  if (!executablePath) {
    throw new Error(
      "Chrome/Edge not found. Install Chrome or configure its executable path."
    );
  }

  return puppeteer.launch({
    executablePath,
    headless: "new",
    args: LAUNCH_ARGS,
    defaultViewport: { width: 1024, height: 768 },
  });
};

// ─── Request blocking ──────────────────────────────────────────
// Keep scripts and document requests enabled because the IMS site is an SPA.

const BLOCK_RESOURCES = new Set(["image", "stylesheet", "font", "media"]);

const BLOCK_URL_PARTS = [
  "google-analytics",
  "googletagmanager",
  "facebook",
  "doubleclick",
  "hotjar",
];

const enableBlocking = async (page) => {
  await page.setRequestInterception(true);

  page.on("request", (request) => {
    if (request.isInterceptResolutionHandled?.()) return;

    if (
      BLOCK_RESOURCES.has(request.resourceType()) ||
      BLOCK_URL_PARTS.some((part) => request.url().includes(part))
    ) {
      return request.abort().catch(() => {});
    }

    return request.continue().catch(() => {});
  });
};

// ─── General page helpers ──────────────────────────────────────

const getBodyText = async (page) => {
  try {
    return await page.evaluate(() => document.body?.innerText ?? "");
  } catch {
    return "";
  }
};

const waitForBodyLength = async (
  page,
  minimumLength,
  timeout = 15000
) => {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    try {
      const length = await page.evaluate(
        () => document.body?.innerText?.length ?? 0
      );

      if (length >= minimumLength) return length;
    } catch {
      // Page may still be rendering.
    }

    await sleep(200);
  }

  return 0;
};

const waitForText = async (page, needle, timeout = 15000) => {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    try {
      const found = await page.evaluate(
        (text) => (document.body?.innerText ?? "").includes(text),
        needle
      );

      if (found) return true;
    } catch {
      // Keep waiting while the SPA renders.
    }

    await sleep(200);
  }

  return false;
};

// ─── Student name extraction ──────────────────────────────────
// Tries common profile selectors and name labels.
// Returns an empty string if no name can be identified.

const extractStudentName = async (page, roll) => {
  try {
    const name = await page.evaluate((studentRoll) => {
      const clean = (value) =>
        String(value || "")
          .replace(/\s+/g, " ")
          .replace(/^[\s:–—-]+|[\s:–—-]+$/g, "")
          .trim();

      const looksLikeLabel = (value) =>
        !value ||
        /^(name|student name|student|student details|profile|dashboard|home|logout|sign out|attendance|subject details|roll no|roll number|registration no|registration number|email|phone|mobile)$/i.test(
          value
        );

      const selectors = [
        "#studentName",
        "#studentname",
        "#stuName",
        "#stu_name",
        "#lblName",
        ".student-name",
        ".studentName",
        ".student_name",
        ".profile-name",
        ".user-name",
        "[id*='studentname' i]",
        "[class*='student-name' i]",
        "[class*='student_name' i]",
        "[id='name']",
        "[class='name']",
      ];

      for (const selector of selectors) {
        for (const element of document.querySelectorAll(selector)) {
          const candidate = clean(
            element.innerText || element.textContent
          );

          if (
            candidate &&
            !looksLikeLabel(candidate) &&
            candidate.toLowerCase() !==
              String(studentRoll || "").toLowerCase() &&
            candidate.length <= 100
          ) {
            return candidate.replace(
              /^(student name|name)\s*[:\-]\s*/i,
              ""
            );
          }
        }
      }

      const lines = (document.body?.innerText || "")
        .split(/\n/)
        .map(clean)
        .filter(Boolean);

      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(
          /^(?:student\s*name|student's\s*name|name)\s*[:\-]\s*(.+)$/i
        );

        if (match) {
          const candidate = clean(match[1]);

          if (
            !looksLikeLabel(candidate) &&
            candidate.toLowerCase() !==
              String(studentRoll || "").toLowerCase()
          ) {
            return candidate;
          }

          const nextLine = clean(lines[i + 1]);

          if (
            nextLine &&
            !looksLikeLabel(nextLine) &&
            nextLine.toLowerCase() !==
              String(studentRoll || "").toLowerCase() &&
            !/^\d{6,}$/.test(nextLine)
          ) {
            return nextLine;
          }
        }

        const welcome = lines[i].match(
          /^(?:welcome|welcome back)\s*[,!: -]*\s*(.+)$/i
        );

        if (welcome) {
          const candidate = clean(welcome[1]);

          if (
            candidate &&
            !looksLikeLabel(candidate) &&
            candidate.toLowerCase() !==
              String(studentRoll || "").toLowerCase()
          ) {
            return candidate;
          }
        }
      }

      return "";
    }, roll);

    if (name) {
      console.log(`Student name detected: ${name}`);
    } else {
      console.log(
        "Student name was not detected from the current IMS page."
      );
    }

    return name || "";
  } catch (error) {
    console.log("Could not extract student name:", error.message);
    return "";
  }
};

// ─── SPA section switcher ──────────────────────────────────────

const switchSection = async (page, linkText, startTime) => {
  console.log(
    `[${Date.now() - startTime}ms] Switching to "${linkText}"...`
  );

  const lengthBefore = await page
    .evaluate(() => document.body?.innerText?.length ?? 0)
    .catch(() => 0);

  const clicked = await page.evaluate((text) => {
    const elements = [
      ...document.querySelectorAll("a, li, span, div, td, button"),
    ];

    // Prefer exact matches and clickable elements.
    const exact = elements.filter(
      (element) =>
        (element.innerText || element.textContent || "").trim() ===
        text
    );

    const clickableExact =
      exact.find((element) =>
        element.matches("a, button, li")
      ) || exact[exact.length - 1];

    if (clickableExact) {
      clickableExact.click();
      return `exact:${clickableExact.tagName}`;
    }

    // Partial-match fallback.
    const partial = elements.find((element) => {
      const value = (
        element.innerText ||
        element.textContent ||
        ""
      ).trim();

      return value === text || value.includes(text);
    });

    if (partial) {
      partial.click();
      return `partial:${partial.tagName}`;
    }

    return null;
  }, linkText);

  console.log(`  click result: ${clicked}`);

  if (!clicked) {
    const visibleLinks = await page
      .evaluate(() =>
        [...document.querySelectorAll("a, li, button")]
          .map((element) => (element.innerText || "").trim())
          .filter(Boolean)
          .slice(0, 40)
      )
      .catch(() => []);

    console.log(
      "Visible links/items:",
      JSON.stringify(visibleLinks)
    );

    throw new Error(
      `"${linkText}" not found in page. See visible links in the server log.`
    );
  }

  // Wait for the SPA content to change.
  const deadline = Date.now() + 12000;

  while (Date.now() < deadline) {
    await sleep(200);

    try {
      const lengthAfter = await page.evaluate(
        () => document.body?.innerText?.length ?? 0
      );

      if (lengthAfter !== lengthBefore) {
        await sleep(350);

        console.log(
          `[${Date.now() - startTime}ms] Content updated (${lengthBefore} -> ${lengthAfter} chars)`
        );

        return;
      }
    } catch {
      // Navigation or re-render occurred.
      return;
    }
  }

  console.log(
    `[${Date.now() - startTime}ms] Content length did not change; continuing.`
  );
};

// ─── Parser: Subject Details ───────────────────────────────────

const parseSubjectDetails = (rawText) => {
  const lines = rawText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const map = {};

  for (let i = 0; i < lines.length; i++) {
    if (!/^\d+$/.test(lines[i])) continue;

    const serial = Number.parseInt(lines[i], 10);

    if (serial < 1 || serial > 60 || i + 3 >= lines.length) {
      continue;
    }

    const code = lines[i + 1];
    const name = lines[i + 2];
    const faculty = lines[i + 3];

    if (!code || /^\d+(?:\.\d+)?$/.test(code)) continue;

    if (
      /^(s\.?no|subject|code|class|total|attend|semester|dashboard|progress|sl)$/i.test(
        code
      )
    ) {
      continue;
    }

    if (!faculty || /^\d/.test(faculty) || /email:/i.test(faculty)) {
      continue;
    }

    const key = code.toUpperCase().trim();

    if (!map[key]) {
      map[key] = {
        name: name.trim(),
        faculty: faculty.trim(),
      };

      console.log(
        `  detail [${key}] "${name.trim()}" | "${faculty.trim()}"`
      );
    }
  }

  return map;
};

// ─── Parser: Attendance table ──────────────────────────────────

const parseAttendanceTable = (rawText) => {
  const lines = rawText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const result = [];

  let headerIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const upper = lines[i].toUpperCase();

    if (
      upper.includes("CLASSES ATTENDED") ||
      upper.includes("TOTAL CONDUCTED")
    ) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) return result;

  let i = headerIndex + 1;

  // Skip column headers.
  while (i < lines.length) {
    const upper = lines[i].toUpperCase();

    if (
      ["S.NO", "S NO", "SNO"].includes(upper) ||
      upper.includes("SUBJECT CODE") ||
      upper.includes("CLASSES ATTENDED") ||
      upper.includes("TOTAL CONDUCTED") ||
      upper.includes("ATTENDANCE %")
    ) {
      i++;
      continue;
    }

    break;
  }

  while (i + 4 < lines.length) {
    const serial = lines[i];

    if (/^(note|total|grand|@)/i.test(serial)) break;

    if (
      !/^\d+$/.test(serial) ||
      Number.parseInt(serial, 10) > 99
    ) {
      i++;
      continue;
    }

    const code = lines[i + 1];
    const attendedText = lines[i + 2];
    const conductedText = lines[i + 3];
    const percentageText = lines[i + 4];

    if (!code || /^\d+$/.test(code)) {
      i++;
      continue;
    }

    if (
      !/^\d+$/.test(attendedText) ||
      !/^\d+$/.test(conductedText)
    ) {
      i++;
      continue;
    }

    const attended = Number.parseInt(attendedText, 10);
    const conducted = Number.parseInt(conductedText, 10);

    if (conducted <= 0 || attended > conducted) {
      i++;
      continue;
    }

    const parsedPercentage = Number.parseFloat(percentageText);

    const percentage = Number.isNaN(parsedPercentage)
      ? Number.parseFloat(
          ((attended / conducted) * 100).toFixed(2)
        )
      : Number.parseFloat(parsedPercentage.toFixed(2));

    result.push({
      sNo: serial,
      subjectCode: code,
      subject: code,
      faculty: "",
      attended,
      conducted,
      percentage,
      status:
        percentage >= 75
          ? "Safe"
          : percentage >= 65
            ? "Border"
            : "Danger",
    });

    console.log(
      `  row [${code}] ${attended}/${conducted} ${percentage}%`
    );

    i += 5;
  }

  return result;
};

// ─── Parser: Attendance cards (fallback) ────────────────────────

const parseAttendanceCards = (rawText) => {
  const lines = rawText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const result = [];

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(
      /^Attended:\s*(\d+)\s*\/\s*(\d+)$/i
    );

    if (!match) continue;

    const attended = Number.parseInt(match[1], 10);
    const conducted = Number.parseInt(match[2], 10);

    if (conducted <= 0 || attended > conducted) continue;

    let code = "";
    let name = "";

    for (let back = 1; back <= 5; back++) {
      const candidate = lines[i - back];

      if (!candidate) continue;

      if (
        /^(Attended|Status|Attendance|Cards|Table|Download|Show)/i.test(
          candidate
        )
      ) {
        continue;
      }

      if (/^[\d.]+%$/.test(candidate)) continue;

      const pipeMatch = candidate.match(/^(.+?)\s*\|\s*(.+)$/);

      if (pipeMatch) {
        code = pipeMatch[1].trim();
        name = pipeMatch[2].trim();
      } else {
        code = candidate.trim();
      }

      break;
    }

    if (!code) continue;

    let status = "";

    let percentage = Number.parseFloat(
      ((attended / conducted) * 100).toFixed(2)
    );

    for (let forward = 1; forward <= 5; forward++) {
      const candidate = lines[i + forward];

      if (!candidate) continue;

      const statusMatch = candidate.match(/^Status:\s*(.+)$/i);
      const percentageMatch = candidate.match(
        /^Attendance:\s*([\d.]+)/i
      );

      if (statusMatch) status = statusMatch[1].trim();

      if (percentageMatch) {
        percentage = Number.parseFloat(
          Number.parseFloat(percentageMatch[1]).toFixed(2)
        );
      }
    }

    if (!status) {
      status =
        percentage >= 75
          ? "Safe"
          : percentage >= 65
            ? "Border"
            : "Danger";
    }

    result.push({
      sNo: String(result.length + 1),
      subjectCode: code,
      subject: name || code,
      faculty: "",
      attended,
      conducted,
      percentage,
      status,
    });
  }

  return result;
};

const parseAttendance = (rawText) => {
  const table = parseAttendanceTable(rawText);

  if (table.length > 0) {
    console.log(`  -> table parser: ${table.length} rows`);
    return table;
  }

  const cards = parseAttendanceCards(rawText);

  console.log(`  -> cards parser: ${cards.length} rows`);

  return cards;
};

// ─── Main scraper ──────────────────────────────────────────────

const scrapeAttendance = async (roll, password) => {
  const startTime = Date.now();

  let browser = null;
  let page = null;

  try {
    browser = await getBrowser();
    page = await browser.newPage();

    await enableBlocking(page);

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
    );

    // 1. Open the MITS homepage.
    console.log(
      `[${Date.now() - startTime}ms] Loading mitsims.in...`
    );

    await page.goto("http://mitsims.in/", {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });

    await waitForText(page, "Student", 10000);

    // 2. Open the student login.
    console.log(
      `[${Date.now() - startTime}ms] Opening Student login...`
    );

    const studentLinkClicked = await page.evaluate(() => {
      for (const anchor of document.querySelectorAll("a")) {
        const id = (anchor.id || "").toLowerCase();

        const text = (
          anchor.innerText ||
          anchor.textContent ||
          ""
        )
          .trim()
          .toLowerCase();

        if (id === "studentlink" || text === "student") {
          anchor.click();
          return true;
        }
      }

      return false;
    });

    if (!studentLinkClicked) {
      throw new Error(
        "Student login link not found on the MITS IMS homepage."
      );
    }

    const loginFormReady = await waitForText(
      page,
      "Password",
      10000
    );

    if (!loginFormReady) {
      throw new Error("Login form not found.");
    }

    // 3. Enter credentials.
    console.log(
      `[${Date.now() - startTime}ms] Entering credentials...`
    );

    let inputs = await page.$$("#stuLogin input.login_box");

    if (inputs.length < 2) {
      inputs = await page.$$("#stuLogin input");
    }

    if (inputs.length < 2) {
      inputs = await page.$$("input.login_box");
    }

    if (inputs.length < 2) {
      inputs = await page.$$("input");
    }

    if (inputs.length < 2) {
      throw new Error(
        "Login inputs not found. MITS IMS may be unavailable or its login page changed."
      );
    }

    await inputs[0].click({ clickCount: 3 });
    await inputs[0].type(String(roll), { delay: 30 });

    await inputs[1].click({ clickCount: 3 });
    await inputs[1].type(String(password), { delay: 30 });

    // 4. Submit the login form.
    let submitted = false;

    for (const selector of [
      "#stuLogin button[type='submit']",
      "#stuLogin button",
      "button[type='submit']",
      "input[type='submit']",
    ]) {
      const button = await page.$(selector).catch(() => null);

      if (button) {
        await button.click();
        submitted = true;
        break;
      }
    }

    if (!submitted) {
      await inputs[1].press("Enter");
    }

    console.log(
      `[${Date.now() - startTime}ms] Login submitted.`
    );

    // 5. Wait for the SPA sidebar.
    console.log(
      `[${Date.now() - startTime}ms] Waiting for sidebar...`
    );

    const sidebarReady = await waitForText(
      page,
      "Subject Details",
      20000
    );

    if (!sidebarReady) {
      const body = await getBodyText(page);
      const lowerBody = body.toLowerCase();

      if (
        [
          "invalid",
          "incorrect",
          "wrong password",
          "login failed",
        ].some((phrase) => lowerBody.includes(phrase))
      ) {
        throw new Error(
          "Invalid credentials. Check your roll number and password."
        );
      }

      throw new Error(
        `Sidebar did not render. Page preview: ${body.slice(0, 300)}`
      );
    }

    console.log(
      `[${Date.now() - startTime}ms] Login successful; sidebar ready.`
    );

    // Extract the name before switching to other SPA sections.
    const studentName = await extractStudentName(page, roll);

    // 6. Read subject details.
    await switchSection(page, "Subject Details", startTime);

    const detailsText = await getBodyText(page);

    console.log(
      `[${Date.now() - startTime}ms] Subject Details: ${detailsText.length} chars`
    );

    const detailsMap = parseSubjectDetails(detailsText);

    console.log(
      `Subject detail entries: ${Object.keys(detailsMap).length}`
    );

    // 7. Read attendance.
    await switchSection(page, "Attendance", startTime);

    const attendanceText = await getBodyText(page);

    console.log(
      `[${Date.now() - startTime}ms] Attendance: ${attendanceText.length} chars`
    );

    // 8. Parse attendance and merge subject names/faculty.
    let rows = parseAttendance(attendanceText);

    if (rows.length === 0) {
      throw new Error(
        `No attendance rows found. Page preview: ${attendanceText
          .replace(/\s+/g, " ")
          .slice(0, 400)}`
      );
    }

    rows = rows.map((row) => {
      const key = String(row.subjectCode || "")
        .toUpperCase()
        .trim();

      const detail = detailsMap[key];

      return {
        ...row,
        subject:
          row.subject && row.subject !== row.subjectCode
            ? row.subject
            : detail?.name || row.subjectCode,
        faculty: detail?.faculty || row.faculty || "",
      };
    });

    console.log(
      `[${Date.now() - startTime}ms] Scrape complete.`
    );

    rows.forEach((row) => {
      console.log(
        `  ${row.sNo}. [${row.subjectCode}] "${row.subject}" | ${row.faculty} | ${row.attended}/${row.conducted} ${row.percentage}%`
      );
    });

    // Return the shape expected by pages/api/attendance.js.
    return {
      studentName,
      data: rows,
    };
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }

    if (browser) {
      await browser.close().catch(() => {});
    }
  }
};

module.exports = { scrapeAttendance };