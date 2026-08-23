# MITS Attendance Tracker — Next.js + Vercel

Web scraping app that logs into MITS IMS and shows your attendance.  
No Streamlit, no Python — runs entirely on **Next.js** deployed to **Vercel**.

---

## 🗂 Project Structure

```
mits-attendance/
├── pages/
│   ├── index.js          ← React UI (full frontend)
│   ├── _app.js
│   └── api/
│       └── attendance.js ← Serverless scraping API
├── lib/
│   └── scraper.js        ← Puppeteer MITS IMS scraper
├── styles/
│   ├── Home.module.css
│   └── globals.css
├── vercel.json           ← Function memory + timeout config
├── next.config.js
└── package.json
```

---

## 🚀 Deploy to Vercel (3 steps)

### 1. Push to GitHub
```bash
git init
git add .
git commit -m "init"
git remote add origin https://github.com/YOUR_USERNAME/mits-attendance.git
git push -u origin main
```

### 2. Import in Vercel
- Go to [vercel.com](https://vercel.com) → **New Project**
- Import your GitHub repo
- Framework: **Next.js** (auto-detected)
- Click **Deploy** — no extra settings needed

### 3. Done ✅
Your app is live at `https://mits-attendance.vercel.app`

---

## 💻 Run Locally

```bash
npm install
npm run dev
# open http://localhost:3000
```

> **Local requirement**: Google Chrome must be installed at a standard path.

---

## ⚙️ How It Works

| Layer | Technology |
|---|---|
| Frontend | React (Next.js pages) |
| API | Next.js API Route (`/api/attendance`) |
| Scraping | Puppeteer Core + @sparticuz/chromium |
| Hosting | Vercel Serverless Functions |

The frontend calls `/api/attendance` with `roll` + `password`.  
The API spins up a headless Chromium, logs into `mitsims.in`, navigates to the attendance page, scrapes the text, parses it, and returns JSON.  
No passwords are stored anywhere.

---

## 🔒 Security Note

Your credentials are sent over HTTPS to the Vercel function, used once to scrape, and never stored. Vercel functions are stateless.

---

## 📦 Key Packages

| Package | Purpose |
|---|---|
| `puppeteer-core` | Headless browser control |
| `@sparticuz/chromium` | Lightweight Chromium for AWS Lambda / Vercel |
| `next` | React framework + API routes |
