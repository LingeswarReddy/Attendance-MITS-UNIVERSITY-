// lib/scraper.js
// MITS IMS Attendance Scraper
// Fast browser reuse + fresh isolated session for every student

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let cachedBrowser = null;

// ─────────────────────────────────────────────────────────────
// Find local Chrome / Edge
// ─────────────────────────────────────────────────────────────

const findChrome = () => {
  const fs = require("fs");

  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    (process.env.LOCALAPPDATA || "") +
      "\\Google\\Chrome\\Application\\chrome.exe",

    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",

    "/usr/bin/google-chrome",
    "/usr/bin/chromium",

    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];

  for (const browserPath of candidates) {
    try {
      if (browserPath && fs.existsSync(browserPath)) {
        console.log("Browser found:", browserPath);
        return browserPath;
      }
    } catch {}
  }

  return null;
};

// ─────────────────────────────────────────────────────────────
// Browser launch options
// ─────────────────────────────────────────────────────────────

const launchArgs = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--disable-extensions",
  "--disable-background-networking",
  "--disable-default-apps",
  "--disable-sync",
  "--disable-translate",
  "--hide-scrollbars",
  "--mute-audio",
  "--no-first-run",
];

// ─────────────────────────────────────────────────────────────
// Launch browser
// ─────────────────────────────────────────────────────────────

const launchBrowser = async () => {
  const puppeteer = require("puppeteer-core");

  // Vercel / AWS Lambda
  if (
    process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME
  ) {
    console.log("Launching serverless Chromium...");

    const chromium = require("@sparticuz/chromium");

    return await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });
  }

  // Local development
  const executablePath = findChrome();

  if (!executablePath) {
    throw new Error(
      "Google Chrome or Microsoft Edge not found. Please install Chrome."
    );
  }

  console.log("Launching local browser...");

  return await puppeteer.launch({
    executablePath,
    headless: "new",
    args: launchArgs,
  });
};

// ─────────────────────────────────────────────────────────────
// Get cached browser
// Browser is reused for speed
// Every user gets a NEW browser context/session
// ─────────────────────────────────────────────────────────────

const getBrowser = async () => {
  if (cachedBrowser) {
    try {
      const pages = await cachedBrowser.pages();

      if (pages.length > 8) {
        console.log("Too many browser pages. Restarting browser...");

        try {
          await cachedBrowser.close();
        } catch {}

        cachedBrowser = null;
      } else {
        console.log("Reusing cached browser ⚡");
        return cachedBrowser;
      }
    } catch {
      console.log("Cached browser is dead. Restarting...");
      cachedBrowser = null;
    }
  }

  console.log("Launching new browser 🚀");

  cachedBrowser = await launchBrowser();

  cachedBrowser.on("disconnected", () => {
    console.log("Browser disconnected.");
    cachedBrowser = null;
  });

  return cachedBrowser;
};

// ─────────────────────────────────────────────────────────────
// Get page text safely
// ─────────────────────────────────────────────────────────────

const getBodyText = async (page) => {
  try {
    return await page.evaluate(() => {
      return document.body?.innerText || "";
    });
  } catch {
    return "";
  }
};

// ─────────────────────────────────────────────────────────────
// Wait for page to settle
// ─────────────────────────────────────────────────────────────

const waitForPage = async (page, timeout = 15000) => {
  try {
    await page.waitForFunction(
      () => document.readyState === "complete",
      { timeout }
    );
  } catch {}
};

// ─────────────────────────────────────────────────────────────
// Parse Subject Details
//
// Expected structure:
//
// 1
// SOFTSKILLS
// SOFT SKILLS
// ANANDAKUMAR
// Email:anandakumarv@mits.ac.in
// Ext No: -
//
// Returns:
//
// {
//   SOFTSKILLS: {
//      name: "SOFT SKILLS",
//      faculty: "ANANDAKUMAR"
//   }
// }
// ─────────────────────────────────────────────────────────────

const parseSubjectDetails = (rawText) => {
  const lines = rawText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const subjectMap = {};

  console.log(
    "Parsing Subject Details. Total lines:",
    lines.length
  );

  for (let i = 0; i < lines.length; i++) {
    const current = lines[i];

    // Subject serial number
    if (!/^\d+$/.test(current)) continue;

    const serial = parseInt(current, 10);

    if (serial < 1 || serial > 50) continue;

    if (i + 4 >= lines.length) continue;

    const subjectCode = lines[i + 1];
    const subjectName = lines[i + 2];
    const facultyName = lines[i + 3];
    const nextLine = lines[i + 4];

    // Reject invalid subject codes
    if (/^\d+(\.\d+)?$/.test(subjectCode)) continue;

    if (
      /^(s\.?no|subject|class|total|attendance|semester|dashboard|progress)/i.test(
        subjectCode
      )
    ) {
      continue;
    }

    // The next line should normally contain email/ext information
    const validStructure =
      nextLine.toLowerCase().includes("email") ||
      nextLine.toLowerCase().includes("ext") ||
      nextLine.includes("@");

    if (!validStructure) continue;

    if (/^\d/.test(facultyName)) continue;

    if (
      facultyName.toLowerCase().includes("email") ||
      facultyName.toLowerCase().includes("ext")
    ) {
      continue;
    }

    const key = subjectCode.toUpperCase().trim();

    subjectMap[key] = {
      name: subjectName.trim(),
      faculty: facultyName.trim(),
    };

    console.log(
      `Detail found: ${key} → ${subjectName} | ${facultyName}`
    );
  }

  return subjectMap;
};

// ─────────────────────────────────────────────────────────────
// Parse Attendance Page
// ─────────────────────────────────────────────────────────────

const parseAttendance = (rawText) => {
  const lines = rawText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const result = [];

  // ───────────────────────────────────────────────────────────
  // FORMAT A
  //
  // SOFTSKILLS | SOFT SKILLS
  // Attended: 2 / 2
  // Status: Safe
  // Attendance: 100%
  // ───────────────────────────────────────────────────────────

  for (let i = 0; i < lines.length; i++) {
    const attendedMatch = lines[i].match(
      /^Attended:\s*(\d+)\s*\/\s*(\d+)$/i
    );

    if (!attendedMatch) continue;

    const attended = parseInt(attendedMatch[1], 10);
    const conducted = parseInt(attendedMatch[2], 10);

    if (conducted <= 0) continue;

    let subjectCode = "";
    let subjectName = "";

    // Look backwards for subject title
    for (let back = 1; back <= 6; back++) {
      const candidate = lines[i - back];

      if (!candidate) continue;

      if (
        /^(Attended|Status|Attendance|Cards|Table|Subject Performance|Download|Exclude)/i.test(
          candidate
        )
      ) {
        continue;
      }

      if (/^[\d.]+%$/.test(candidate)) continue;

      const pipeMatch = candidate.match(
        /^(.+?)\s*\|\s*(.+)$/
      );

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

    let status = "";
    let percentage = parseFloat(
      ((attended / conducted) * 100).toFixed(2)
    );

    // Look forward for Status and Attendance
    for (let forward = 1; forward <= 6; forward++) {
      const next = lines[i + forward];

      if (!next) continue;

      const statusMatch = next.match(
        /^Status:\s*(.+)$/i
      );

      const percentageMatch = next.match(
        /^Attendance:\s*([\d.]+)/i
      );

      if (statusMatch) {
        status = statusMatch[1].trim();
      }

      if (percentageMatch) {
        percentage = parseFloat(
          parseFloat(percentageMatch[1]).toFixed(2)
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
      subjectCode,
      subject: subjectName || subjectCode,
      faculty: "",
      attended,
      conducted,
      percentage,
      status,
    });
  }

  if (result.length > 0) {
    return result;
  }

  // ───────────────────────────────────────────────────────────
  // FORMAT B
  //
  // S.NO
  // SUBJECT CODE
  // CLASSES ATTENDED
  // TOTAL CONDUCTED
  // ATTENDANCE %
  //
  // 1
  // SOFTSKILLS
  // 2
  // 2
  // 100.0
  // ───────────────────────────────────────────────────────────

  let headerIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    if (
      lines[i]
        .toUpperCase()
        .includes("CLASSES ATTENDED")
    ) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) {
    return [];
  }

  let dataStart = headerIndex + 1;

  while (dataStart < lines.length) {
    const text = lines[dataStart].toUpperCase();

    if (
      text.includes("SUBJECT CODE") ||
      text.includes("CLASSES ATTENDED") ||
      text.includes("TOTAL CONDUCTED") ||
      text.includes("ATTENDANCE") ||
      text === "S.NO" ||
      text === "S NO"
    ) {
      dataStart++;
      continue;
    }

    if (/^\d+$/.test(lines[dataStart])) {
      break;
    }

    dataStart++;
  }

  let i = dataStart;

  while (i < lines.length) {
    const sNo = lines[i];

    if (
      !sNo ||
      /^(note|total|grand|remarks)/i.test(sNo)
    ) {
      break;
    }

    if (!/^\d+$/.test(sNo)) {
      i++;
      continue;
    }

    if (i + 4 >= lines.length) {
      break;
    }

    const subjectCode = lines[i + 1];
    const attendedStr = lines[i + 2];
    const conductedStr = lines[i + 3];
    const percentageStr = lines[i + 4];

    if (
      /^\d+$/.test(subjectCode) ||
      !/^\d+$/.test(attendedStr) ||
      !/^\d+$/.test(conductedStr)
    ) {
      i++;
      continue;
    }

    const attended = parseInt(attendedStr, 10);
    const conducted = parseInt(conductedStr, 10);

    if (conducted <= 0) {
      i++;
      continue;
    }

    const parsedPercentage =
      parseFloat(percentageStr);

    const percentage = isNaN(parsedPercentage)
      ? parseFloat(
          ((attended / conducted) * 100).toFixed(2)
        )
      : parseFloat(parsedPercentage.toFixed(2));

    const status =
      percentage >= 75
        ? "Safe"
        : percentage >= 65
        ? "Border"
        : "Danger";

    result.push({
      sNo,
      subjectCode,
      subject: subjectCode,
      faculty: "",
      attended,
      conducted,
      percentage,
      status,
    });

    i += 5;
  }

  return result;
};

// ─────────────────────────────────────────────────────────────
// Click sidebar navigation link
// ─────────────────────────────────────────────────────────────

const clickSidebarLink = async (page, text) => {
  try {
    const result = await page.evaluate((targetText) => {
      const elements = [
        ...document.querySelectorAll(
          "a, button, li, td, span, div"
        ),
      ];

      // Exact match first
      for (const element of elements) {
        const value = (
          element.innerText ||
          element.textContent ||
          ""
        )
          .trim()
          .replace(/\s+/g, " ");

        if (
          value.toLowerCase() ===
          targetText.toLowerCase()
        ) {
          element.click();
          return "exact";
        }
      }

      // Partial match
      for (const element of elements) {
        const value = (
          element.innerText ||
          element.textContent ||
          ""
        )
          .trim()
          .replace(/\s+/g, " ");

        if (
          value
            .toLowerCase()
            .includes(targetText.toLowerCase())
        ) {
          element.click();
          return "partial";
        }
      }

      return null;
    }, text);

    return result;
  } catch (error) {
    console.log(
      "Navigation click error:",
      error.message
    );

    return null;
  }
};

// ─────────────────────────────────────────────────────────────
// Wait for login form
// ─────────────────────────────────────────────────────────────

const waitForLoginForm = async (page) => {
  const attempts = [
    1000,
    2000,
    3000,
    4000,
  ];

  for (const waitTime of attempts) {
    await sleep(waitTime);

    // Best selectors
    let inputs = await page.$$("#stuLogin input");

    if (inputs.length >= 2) {
      return inputs;
    }

    inputs = await page.$$("input.login_box");

    if (inputs.length >= 2) {
      return inputs;
    }

    // Find password first
    const passwordInput = await page.$(
      "input[type='password']"
    );

    if (passwordInput) {
      const allInputs = await page.$$(
        "input"
      );

      if (allInputs.length >= 2) {
        return allInputs;
      }
    }

    console.log(
      `Login form not ready. Retrying after ${waitTime}ms...`
    );
  }

  return null;
};

// ─────────────────────────────────────────────────────────────
// Get correct login inputs
// Avoid hidden/non-clickable inputs
// ─────────────────────────────────────────────────────────────

const getLoginInputs = async (page) => {
  return await page.evaluate(() => {
    const inputs = Array.from(
      document.querySelectorAll("input")
    );

    const visibleInputs = inputs.filter((input) => {
      const style =
        window.getComputedStyle(input);

      const rect =
        input.getBoundingClientRect();

      return (
        input.offsetParent !== null &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0 &&
        !input.disabled
      );
    });

    const passwordIndex =
      visibleInputs.findIndex(
        (input) =>
          input.type === "password"
      );

    if (passwordIndex === -1) {
      return {
        usernameSelector: null,
        passwordSelector: null,
      };
    }

    const password = visibleInputs[passwordIndex];

    const username =
      visibleInputs
        .slice(0, passwordIndex)
        .reverse()
        .find(
          (input) =>
            input.type === "text" ||
            input.type === "email" ||
            input.type === ""
        ) ||
      visibleInputs[0];

    if (!username || !password) {
      return {
        usernameSelector: null,
        passwordSelector: null,
      };
    }

    // Add temporary unique attributes
    username.setAttribute(
      "data-mits-login-user",
      "true"
    );

    password.setAttribute(
      "data-mits-login-password",
      "true"
    );

    return {
      usernameSelector:
        "[data-mits-login-user='true']",
      passwordSelector:
        "[data-mits-login-password='true']",
    };
  });
};

// ─────────────────────────────────────────────────────────────
// Reset cached browser when something is seriously wrong
// ─────────────────────────────────────────────────────────────

const resetCachedBrowser = async () => {
  if (!cachedBrowser) return;

  console.log("Resetting cached browser...");

  try {
    await cachedBrowser.close();
  } catch {}

  cachedBrowser = null;
};

// ═════════════════════════════════════════════════════════════
// MAIN SCRAPER
// ═════════════════════════════════════════════════════════════

const scrapeAttendance = async (
  roll,
  password
) => {
  let browser = null;
  let context = null;
  let page = null;

  console.log("========================================");
  console.log("Starting MITS attendance scrape...");
  console.log("Roll:", roll);
  console.log("========================================");

  try {
    // ─────────────────────────────────────────────────────────
    // 1. Get fast cached browser
    // ─────────────────────────────────────────────────────────

    browser = await getBrowser();

    // ─────────────────────────────────────────────────────────
    // IMPORTANT:
    // New isolated context for every student
    //
    // This prevents previous login cookies/session
    // from affecting the next user.
    // ─────────────────────────────────────────────────────────

    if (typeof browser.createBrowserContext === "function") {
      context =
        await browser.createBrowserContext();
    } else if (
      typeof browser.createIncognitoBrowserContext ===
      "function"
    ) {
      context =
        await browser.createIncognitoBrowserContext();
    }

    if (context) {
      page = await context.newPage();
    } else {
      page = await browser.newPage();
    }

    await page.setViewport({
      width: 1280,
      height: 900,
    });

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 " +
        "(KHTML, like Gecko) " +
        "Chrome/120.0.0.0 Safari/537.36"
    );

    page.setDefaultTimeout(15000);

    // ─────────────────────────────────────────────────────────
    // STEP 1: Open MITS IMS
    // ─────────────────────────────────────────────────────────

    console.log(
      "Step 1: Opening MITS IMS..."
    );

    await page.goto(
      "http://mitsims.in/",
      {
        waitUntil: "domcontentloaded",
        timeout: 45000,
      }
    );

    await waitForPage(page, 10000);

    console.log(
      "Current URL:",
      page.url()
    );

    // ─────────────────────────────────────────────────────────
    // STEP 2: Open Student Login
    // ─────────────────────────────────────────────────────────

    console.log(
      "Step 2: Opening Student Login..."
    );

    let studentClicked = false;

    // Try direct student link
    try {
      const selector =
        await page.$("#studentlink");

      if (selector) {
        await page.evaluate(
          () =>
            document
              .querySelector("#studentlink")
              ?.click()
        );

        studentClicked = true;
      }
    } catch {}

    // Text fallback
    if (!studentClicked) {
      console.log(
        "Student ID selector not found. Trying text..."
      );

      const clicked =
        await page.evaluate(() => {
          const elements = [
            ...document.querySelectorAll(
              "a, button, div, span"
            ),
          ];

          for (const element of elements) {
            const text = (
              element.innerText ||
              element.textContent ||
              ""
            )
              .trim()
              .toLowerCase();

            if (
              text === "student" ||
              text === "student login" ||
              text.includes("student login")
            ) {
              element.click();
              return true;
            }
          }

          return false;
        });

      studentClicked = clicked;
    }

    console.log(
      "Student login clicked:",
      studentClicked
    );

    // ─────────────────────────────────────────────────────────
    // STEP 3: Wait for login form
    // ─────────────────────────────────────────────────────────

    console.log(
      "Step 3: Waiting for login form..."
    );

    const detectedInputs =
      await waitForLoginForm(page);

    if (
      !detectedInputs ||
      detectedInputs.length < 2
    ) {
      const preview =
        (await getBodyText(page)).slice(
          0,
          500
        );

      console.log(
        "Login form preview:",
        preview
      );

      throw new Error(
        "Login form not found. MITS IMS may be slow or unavailable."
      );
    }

    // ─────────────────────────────────────────────────────────
    // STEP 4: Find visible username/password fields
    // ─────────────────────────────────────────────────────────

    console.log(
      "Step 4: Finding visible login inputs..."
    );

    const loginInputs =
      await getLoginInputs(page);

    if (
      !loginInputs.usernameSelector ||
      !loginInputs.passwordSelector
    ) {
      throw new Error(
        "Visible login fields could not be detected."
      );
    }

    console.log(
      "Login inputs found successfully."
    );

    // ─────────────────────────────────────────────────────────
    // STEP 5: Fill credentials
    //
    // Using selector-based click/type instead of
    // ElementHandle click to avoid:
    // "Node is either not clickable or not an Element"
    // ─────────────────────────────────────────────────────────

    console.log(
      "Step 5: Filling login credentials..."
    );

    await page.focus(
      loginInputs.usernameSelector
    );

    await page.evaluate(
      (selector) => {
        const input =
          document.querySelector(selector);

        if (input) {
          input.value = "";
          input.dispatchEvent(
            new Event("input", {
              bubbles: true,
            })
          );
        }
      },
      loginInputs.usernameSelector
    );

    await page.type(
      loginInputs.usernameSelector,
      roll.trim(),
      {
        delay: 40,
      }
    );

    await page.focus(
      loginInputs.passwordSelector
    );

    await page.evaluate(
      (selector) => {
        const input =
          document.querySelector(selector);

        if (input) {
          input.value = "";
          input.dispatchEvent(
            new Event("input", {
              bubbles: true,
            })
          );
        }
      },
      loginInputs.passwordSelector
    );

    await page.type(
      loginInputs.passwordSelector,
      password,
      {
        delay: 40,
      }
    );

    console.log(
      "Credentials entered."
    );

    // ─────────────────────────────────────────────────────────
    // STEP 6: Submit login
    // ─────────────────────────────────────────────────────────

    console.log(
      "Step 6: Submitting login..."
    );

    let submitted = false;

    const submitSelectors = [
      "#stuLogin button[type='submit']",
      "#stuLogin input[type='submit']",
      "#stuLogin button",
      "button[type='submit']",
      "input[type='submit']",
    ];

    for (const selector of submitSelectors) {
      try {
        const button =
          await page.$(selector);

        if (button) {
          await page.evaluate(
            (sel) => {
              const element =
                document.querySelector(sel);

              if (element) {
                element.click();
              }
            },
            selector
          );

          submitted = true;

          console.log(
            "Login submitted using:",
            selector
          );

          break;
        }
      } catch {}
    }

    // Enter fallback
    if (!submitted) {
      console.log(
        "Submit button not found. Pressing Enter..."
      );

      await page.keyboard.press("Enter");

      submitted = true;
    }

    // ─────────────────────────────────────────────────────────
    // STEP 7: Wait after login
    // ─────────────────────────────────────────────────────────

    console.log(
      "Step 7: Waiting for dashboard..."
    );

    try {
      await page.waitForNavigation({
        waitUntil: "domcontentloaded",
        timeout: 20000,
      });
    } catch {
      // Some websites update page without navigation
    }

    await sleep(3500);

    await waitForPage(page, 10000);

    const afterLoginText =
      await getBodyText(page);

    console.log(
      "After login URL:",
      page.url()
    );

    console.log(
      "After login page length:",
      afterLoginText.length
    );

    // ─────────────────────────────────────────────────────────
    // Validate credentials
    // ─────────────────────────────────────────────────────────

    const loginText =
      afterLoginText.toLowerCase();

    const invalidPhrases = [
      "invalid password",
      "invalid credentials",
      "incorrect password",
      "wrong password",
      "login failed",
      "invalid username",
    ];

    for (const phrase of invalidPhrases) {
      if (loginText.includes(phrase)) {
        throw new Error(
          "Invalid credentials. Please check your roll number and password."
        );
      }
    }

    console.log(
      "Login completed successfully."
    );

    // ─────────────────────────────────────────────────────────
    // STEP 8: Subject Details
    // ─────────────────────────────────────────────────────────

    console.log(
      "Step 8: Opening Subject Details..."
    );

    const subjectDetailsClicked =
      await clickSidebarLink(
        page,
        "Subject Details"
      );

    console.log(
      "Subject Details click:",
      subjectDetailsClicked
    );

    await sleep(2000);

    const detailText =
      await getBodyText(page);

    console.log(
      "Subject Details length:",
      detailText.length
    );

    const detailMap =
      parseSubjectDetails(detailText);

    console.log(
      "Subject detail entries:",
      Object.keys(detailMap).length
    );

    // ─────────────────────────────────────────────────────────
    // STEP 9: Attendance
    // ─────────────────────────────────────────────────────────

    console.log(
      "Step 9: Opening Attendance..."
    );

    const attendanceClicked =
      await clickSidebarLink(
        page,
        "Attendance"
      );

    console.log(
      "Attendance click:",
      attendanceClicked
    );

    await sleep(2500);

    const attendanceText =
      await getBodyText(page);

    console.log(
      "Attendance page length:",
      attendanceText.length
    );

    // ─────────────────────────────────────────────────────────
    // STEP 10: Parse attendance
    // ─────────────────────────────────────────────────────────

    console.log(
      "Step 10: Parsing attendance..."
    );

    let data =
      parseAttendance(attendanceText);

    console.log(
      "Attendance rows parsed:",
      data.length
    );

    if (data.length === 0) {
      const preview =
        attendanceText
          .replace(/\s+/g, " ")
          .slice(0, 700);

      throw new Error(
        `Attendance data not detected. Preview: ${preview}`
      );
    }

    // ─────────────────────────────────────────────────────────
    // STEP 11: Merge Subject Name + Faculty
    // ─────────────────────────────────────────────────────────

    console.log(
      "Step 11: Merging subject names and faculty..."
    );

    data = data.map((row) => {
      const key =
        row.subjectCode
          .toUpperCase()
          .trim();

      const detail =
        detailMap[key];

      return {
        ...row,

        subject:
          detail?.name ||
          row.subject ||
          row.subjectCode,

        faculty:
          detail?.faculty || "",
      };
    });

    console.log(
      "========================================"
    );

    console.log(
      "FINAL SUBJECT DATA"
    );

    data.forEach((row) => {
      console.log(
        `${row.subjectCode} | ${row.subject} | ${row.faculty} | ${row.attended}/${row.conducted} | ${row.percentage}% | ${row.status}`
      );
    });

    console.log(
      "========================================"
    );

    return data;
  } catch (error) {
    console.error(
      "SCRAPER ERROR:",
      error.message
    );

    // Reset browser only for serious browser/login errors
    if (
      error.message.includes(
        "Login form"
      ) ||
      error.message.includes(
        "Target closed"
      ) ||
      error.message.includes(
        "Session closed"
      ) ||
      error.message.includes(
        "Execution context"
      )
    ) {
      await resetCachedBrowser();
    }

    throw error;
  } finally {
    // Close only this student's isolated session
    // Keep main browser alive for faster future requests

    try {
      if (page && !page.isClosed()) {
        await page.close();
      }
    } catch {}

    try {
      if (context) {
        await context.close();
      }
    } catch {}

    console.log(
      "Student session closed."
    );
  }
};

// ─────────────────────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────────────────────

module.exports = {
  scrapeAttendance,
};