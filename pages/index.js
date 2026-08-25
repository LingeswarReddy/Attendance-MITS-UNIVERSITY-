import { useState } from "react";
import Head from "next/head";
import styles from "../styles/Home.module.css";

// ── Helpers ──────────────────────────────────────────────────
const pct = (a, c) => (c <= 0 ? 0 : (a / c) * 100);
const classesNeeded = (a, c, t) => pct(a,c) >= t ? 0 : Math.max(0, Math.ceil((t*c - 100*a)/(100-t)));
const classesSkip   = (a, c, t) => pct(a,c) < t  ? 0 : Math.max(0, Math.floor((100*a - t*c)/t));
const projectedPct  = (a, c, leaves) => { const nc = c + leaves; return nc <= 0 ? 0 : (a/nc)*100; };

const statusCls = (s) => {
  const v = (s||"").toLowerCase();
  if (v === "safe")   return styles.statusSafe;
  if (v === "border") return styles.statusBorder;
  return styles.statusDanger;
};
const pctCls   = (p) => p >= 75 ? styles.pctGreen : p >= 65 ? styles.pctYellow : styles.pctRed;
const barColor = (p) => p >= 75 ? "#22c55e" : p >= 65 ? "#f59e0b" : "#ef4444";

// ── Overall banner ────────────────────────────────────────────
const OverallBanner = ({ attended, conducted, roll, onLogout }) => {
  const overall = pct(attended, conducted);
  const safe    = overall >= 75;
  return (
    <div className={`${styles.overallBanner} ${safe ? styles.overallSafe : styles.overallDanger}`}>
      <div className={styles.overallTop}>
        <div className={styles.overallLeft}>
          <span className={styles.overallLabel}>Overall Attendance</span>
          <span className={styles.overallPct}>{overall.toFixed(2)}%</span>
          <span className={`${styles.statusBadge} ${safe ? styles.statusSafe : styles.statusDanger}`}>
            {safe ? "✅ Safe" : "⚠️ At Risk"}
          </span>
          {roll && <span className={styles.overallRoll}>Roll: {roll}</span>}
        </div>
        <div className={styles.overallRight}>
          <div className={styles.overallStat}>
            <span className={styles.overallStatVal}>{attended}</span>
            <span className={styles.overallStatLbl}>Attended</span>
          </div>
          <div className={styles.overallDivider} />
          <div className={styles.overallStat}>
            <span className={styles.overallStatVal}>{conducted}</span>
            <span className={styles.overallStatLbl}>Conducted</span>
          </div>
        </div>
      </div>
      <div className={styles.overallBarWrap}>
        <div className={styles.overallBar}>
          <div className={styles.overallBarFill}
            style={{ width:`${Math.min(overall,100)}%`, background: safe ? "#22c55e" : "#ef4444" }} />
          <div className={styles.overallBarMark} />
        </div>
        <div className={styles.overallBarLabels}>
          <span>0%</span><span style={{marginLeft:"71%"}}>75%</span><span>100%</span>
        </div>
      </div>
    </div>
  );
};

// ── Subject card ──────────────────────────────────────────────
const SubjectCard = ({ row }) => {
  const s = (row.status||"").toLowerCase();
  return (
    <div className={`${styles.subjectCard} ${s==="safe"?styles.cardSafe:s==="border"?styles.cardBorder:styles.cardDanger}`}>
      <div className={styles.cardTop}>
        <div className={styles.cardTitles}>
          {row.subjectCode && (
            <span className={styles.cardCode}>{row.subjectCode}</span>
          )}
          <span className={styles.cardName}>{row.subject}</span>
          {row.faculty && (
            <span className={styles.cardFaculty}>👨‍🏫 {row.faculty}</span>
          )}
        </div>
        <span className={`${styles.cardPct} ${pctCls(row.percentage)}`}>
          {row.percentage.toFixed(1)}%
        </span>
      </div>
      <div className={styles.cardMeta}>
        <span className={styles.cardAttended}>
          Attended: <strong>{row.attended} / {row.conducted}</strong>
        </span>
        <span className={`${styles.statusBadge} ${statusCls(row.status)}`}>{row.status}</span>
      </div>
      <div className={styles.progressTrack}>
        <div className={styles.progressFill}
          style={{ width:`${Math.min(row.percentage,100)}%`, background: barColor(row.percentage) }} />
        <div className={styles.markerLine} style={{left:"75%"}} />
      </div>
    </div>
  );
};

// ── Chart ─────────────────────────────────────────────────────
const AttendanceChart = ({ data }) => (
  <div className={styles.chartWrap}>
    <div className={styles.chartBars}>
      {data.map((row, i) => (
        <div key={i} className={styles.barCol}>
          <span className={styles.barPct}>{row.percentage.toFixed(0)}%</span>
          <div className={styles.barTrack}>
            <div className={styles.barFill}
              style={{ height:`${Math.min(row.percentage,100)}%`, background: barColor(row.percentage) }} />
            <div className={styles.barMarker75} />
          </div>
          <span className={styles.barLabel} title={`${row.subjectCode} – ${row.subject}`}>
            {(row.subjectCode || row.subject).slice(0,10)}
          </span>
        </div>
      ))}
    </div>
    <div className={styles.chartLegend}>
      <span><span className={styles.legendDot} style={{background:"#22c55e"}}/>Safe ≥75%</span>
      <span><span className={styles.legendDot} style={{background:"#f59e0b"}}/>Border 65–74%</span>
      <span><span className={styles.legendDot} style={{background:"#ef4444"}}/>Danger &lt;65%</span>
      <span><span className={styles.legendLine}/>75% mark</span>
    </div>
  </div>
);

// ── Tabs ──────────────────────────────────────────────────────
const Tabs = ({ active, onChange }) => (
  <div className={styles.tabBar}>
    {["Cards","Table"].map(t => (
      <button key={t}
        className={`${styles.tab} ${active===t?styles.tabActive:""}`}
        onClick={()=>onChange(t)}>{t}</button>
    ))}
  </div>
);

// ═════════════════════════════════════════════════════════════
export default function Home() {
  const [roll, setRoll]           = useState("");
  const [password, setPassword]   = useState("");
  const [loading, setLoading]     = useState(false);
  const [stepMsg, setStepMsg]     = useState("");
  const [error, setError]         = useState("");
  const [data, setData]           = useState(null);
  const [loggedRoll, setLoggedRoll] = useState("");
  const [tab, setTab]             = useState("Cards");
  const [targetPct, setTargetPct] = useState(75);
  const [leavePlan, setLeavePlan] = useState(0);
  const [showPassword, setShowPassword] = useState(false);

  const steps = [
    "🌐 Opening MITS IMS portal…",
    "🔐 Submitting your credentials…",
    "🚀 Logging you in securely…",
    "📊 Fetching your attendance data…",
    "🧮 Processing subject details…",
  ];

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!roll.trim() || !password) { setError("Please enter both roll number and password."); return; }
    setError(""); setData(null); setLoading(true);
    let idx = 0; setStepMsg(steps[0]);
    const iv = setInterval(() => { idx=(idx+1)%steps.length; setStepMsg(steps[idx]); }, 5000);
    try {
      const res  = await fetch("/api/attendance", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ roll: roll.trim(), password }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Something went wrong.");
      setData(json.data);
      setLoggedRoll(roll.trim());
    } catch(err) { setError(err.message); }
    finally { clearInterval(iv); setStepMsg(""); setLoading(false); }
  };

  const handleLogout = () => {
    setData(null); setLoggedRoll(""); setRoll(""); setPassword(""); setError("");
  };

  // Derived
  const totalAttended  = data ? data.reduce((s,r)=>s+r.attended,0)  : 0;
  const totalConducted = data ? data.reduce((s,r)=>s+r.conducted,0) : 0;
  const overallPct     = pct(totalAttended, totalConducted);
  const canSkip        = classesSkip(totalAttended, totalConducted, targetPct);
  const needMore       = classesNeeded(totalAttended, totalConducted, targetPct);
  const projected      = projectedPct(totalAttended, totalConducted, leavePlan);

  const downloadCSV = () => {
    if (!data) return;
    const rows = data.map(r=>`${r.subjectCode},"${r.subject}","${r.faculty||""}",${r.attended},${r.conducted},${r.percentage}%,${r.status}`).join("\n");
    const blob = new Blob(["Subject Code,Subject Name,Faculty,Attended,Conducted,Percentage,Status\n"+rows],{type:"text/csv"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `MITS_attendance_${loggedRoll}.csv`;
    a.click();
  };

  return (
    <>
      <Head>
        <title>MITS Attendance Tracker – Check MITS IMS Attendance Online | Lingeswar</title>
        <meta name="description" content="Free MITS attendance tracker for Madanapalle Institute students. View subject-wise attendance with faculty names, subject codes, overall percentage, predictions and leave planning. Built by Lingeswar." />
        <meta name="keywords" content="MITS attendance tracker, MITS IMS attendance, Madanapalle Institute attendance, mitsims.in attendance checker, MITS student portal, MITS CSE attendance, JNTUA attendance, MITS Madanapalle" />
        <meta name="author" content="Lingeswar" />
        <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large" />
        <link rel="canonical" href="https://mits-attendance.vercel.app" />
        <meta property="og:type"        content="website" />
        <meta property="og:url"         content="https://mits-attendance.vercel.app" />
        <meta property="og:title"       content="MITS Attendance Tracker – Check Your IMS Attendance Instantly" />
        <meta property="og:description" content="Track your MITS Madanapalle attendance subject-wise with faculty names, predictions and leave planning. Free tool by Lingeswar." />
        <meta property="og:image"       content="https://mits-attendance.vercel.app/og-image.png" />
        <meta property="og:locale"      content="en_IN" />
        <meta property="og:site_name"   content="MITS Attendance Tracker" />
        <meta name="twitter:card"        content="summary_large_image" />
        <meta name="twitter:title"       content="MITS Attendance Tracker" />
        <meta name="twitter:description" content="Check your MITS IMS attendance with faculty names, subject codes and smart predictions." />
        <meta name="twitter:image"       content="https://mits-attendance.vercel.app/og-image.png" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div className={styles.page}>

        {/* ── Marquee ───────────────────────────────────── */}
        <div className={styles.marqueeWrap}>
          <div className={styles.marquee}>
            🎓 MITS Attendance Tracker by Lingeswar &nbsp;•&nbsp;
            Track your IMS attendance subject-wise &nbsp;•&nbsp;
            View faculty names and subject codes &nbsp;•&nbsp;
            Madanapalle Institute of Technology &amp; Science &nbsp;•&nbsp;
            Plan your leaves smartly &nbsp;•&nbsp;
          </div>
        </div>

        {/* ── Header ────────────────────────────────────── */}
        <header className={styles.header}>
          <div className={styles.headerInner}>
            <div className={styles.logoBlock}>
              <span className={styles.logoMITS}>MITS</span>
              <div>
                <div className={styles.logoFull}>Madanapalle Institute of Technology &amp; Science</div>
                <div className={styles.logoDept}>Dept. of Computer Science &amp; Engineering · Deemed to be University</div>
              </div>
            </div>
            <div className={styles.headerRight}>
              <div className={styles.creatorBadge}>Built by <strong>Lingeswar</strong></div>
              {data && (
                <button className={styles.logoutBtn} onClick={handleLogout}>
                  🚪 Logout
                </button>
              )}
            </div>
          </div>
        </header>

        {/* ── Hero ──────────────────────────────────────── */}
        {!data && (
          <section className={styles.hero}>
            <h1 className={styles.heroTitle}>🔥 MITS Attendance Tracker</h1>
            <p className={styles.heroSub}>Track · Analyse · Plan Your Classes — Instantly</p>
            <p className={styles.heroMeta}>Login with your MITS IMS credentials to view real-time attendance</p>
          </section>
        )}

        {/* ── Login card ────────────────────────────────── */}
        {!data && (
          <section className={styles.loginSection}>
            <div className={styles.loginCard}>
              <h2 className={styles.loginTitle}>🔐 Student Login</h2>
              <p className={styles.loginSub}>Enter your MITS IMS credentials below</p>
              <form onSubmit={handleSubmit} className={styles.form}>
                <label className={styles.label}>
                  🎓 Roll Number
                  <input className={styles.input} type="text" placeholder="e.g. 22B91A0501"
                    value={roll} onChange={e=>setRoll(e.target.value)} disabled={loading} autoComplete="username" />
                </label>
                <label className={styles.label}>
  🔑 Password
  <div className={styles.passwordWrap}>
    <input
      className={styles.inputPassword}
      type={showPassword ? "text" : "password"}
      placeholder="Your IMS password"
      value={password}
      onChange={e => setPassword(e.target.value)}
      disabled={loading}
      autoComplete="current-password"
    />
    <button
      type="button"
      className={styles.eyeBtn}
      onClick={() => setShowPassword(!showPassword)}
      tabIndex={-1}
    >
      {showPassword ? "🙈" : "👁️"}
    </button>
  </div>
</label>
                {error && <div className={styles.errorBox}>❌ {error}</div>}
                <button className={styles.submitBtn} type="submit" disabled={loading}>
                  {loading ? "⏳ Fetching Attendance…" : "🚀 Fetch My Attendance"}
                </button>
              </form>
              {loading && (
                <div className={styles.loadingBox}>
                  <div className={styles.spinner} />
                  <p className={styles.stepText}>{stepMsg}</p>
                  <p className={styles.stepHint}>This usually takes 20–60 seconds. Please wait…</p>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ══════════════════════════════════════════════
            RESULTS
        ══════════════════════════════════════════════ */}
        {data && (
          <section className={styles.results}>

            {/* 1. Overall attendance first */}
            <OverallBanner
              attended={totalAttended}
              conducted={totalConducted}
              roll={loggedRoll}
              onLogout={handleLogout}
            />

            {/* 2. Subject Performance */}
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>📚 Subject Performance</h2>
              <button className={styles.csvBtn} onClick={downloadCSV}>⬇ Download CSV</button>
            </div>

            <Tabs active={tab} onChange={setTab} />

            {/* Cards */}
            {tab === "Cards" && (
              <div className={styles.cardGrid}>
                {data.map((row, i) => <SubjectCard key={i} row={row} />)}
              </div>
            )}

            {/* Table */}
            {tab === "Table" && (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Subject Code</th>
                      <th>Subject Name</th>
                      <th>Faculty</th>
                      <th>Attended</th>
                      <th>Conducted</th>
                      <th>%</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((row, i) => (
                      <tr key={i}>
                        <td>{i+1}</td>
                        <td><span className={styles.codeChip}>{row.subjectCode || "—"}</span></td>
                        <td className={styles.subjectNameCell}>{row.subject}</td>
                        <td className={styles.facultyCell}>{row.faculty || "—"}</td>
                        <td>{row.attended}</td>
                        <td>{row.conducted}</td>
                        <td>
                          <span className={`${styles.pctBadge} ${pctCls(row.percentage)}`}>
                            {row.percentage.toFixed(2)}%
                          </span>
                        </td>
                        <td>
                          <span className={`${styles.statusBadge} ${statusCls(row.status)}`}>
                            {row.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* 3. Chart */}
            <div className={styles.panel}>
              <h3 className={styles.panelTitle}>
                📊 Attendance Chart <span className={styles.panelSub}>Subject-wise trend</span>
              </h3>
              <AttendanceChart data={data} />
            </div>

            {/* 4. Statistics & Prediction */}
            <div className={styles.panel}>
              <h3 className={styles.panelTitle}>
                🎯 Attendance Statistics <span className={styles.panelSub}>Predictive insights</span>
              </h3>

              <div className={styles.statRow}>
                <div className={styles.statBox}>
                  <span className={styles.statLabel}>Current Overall</span>
                  <span className={`${styles.statValue} ${pctCls(overallPct)}`}>{overallPct.toFixed(2)}%</span>
                </div>
                <div className={styles.statBox}>
                  <span className={styles.statLabel}>Classes Attended</span>
                  <span className={styles.statValue}>{totalAttended} / {totalConducted}</span>
                </div>
                <div className={styles.statBox}>
                  <span className={styles.statLabel}>Total Subjects</span>
                  <span className={styles.statValue}>{data.length}</span>
                </div>
              </div>

              <div className={styles.inputRow}>
                <label className={styles.label} style={{flex:1}}>
                  🎯 Target Attendance %
                  <span className={styles.inputHint}>Enter a value from 1 to 100</span>
                  <input className={styles.input} type="number" min="1" max="100"
                    value={targetPct} onChange={e=>setTargetPct(Number(e.target.value))} />
                </label>
                <label className={styles.label} style={{flex:1}}>
                  🏖️ If I Take Leave (Classes)
                  <span className={styles.inputHint}>Enter planned future absences</span>
                  <input className={styles.input} type="number" min="0"
                    value={leavePlan} onChange={e=>setLeavePlan(Number(e.target.value))} />
                </label>
              </div>

              <div className={styles.predictionBox}>
                <h4 className={styles.predTitle}>Prediction Summary</h4>
                <div className={styles.predRow}>
                  <span className={styles.predLabel}>Current Overall Attendance</span>
                  <span className={`${styles.predValue} ${pctCls(overallPct)}`}>{overallPct.toFixed(2)}%</span>
                </div>
                <div className={styles.predDivider} />
                <div className={styles.predPlanBox}>
                  <p className={styles.predPlanTitle}>Attendance Plan</p>
                  {overallPct >= targetPct ? (
                    <p className={styles.predGood}>
                      ✅ To stay at or above <strong>{targetPct}%</strong>, you can still miss{" "}
                      <strong>{canSkip}</strong> class{canSkip!==1?"es":""}.
                    </p>
                  ) : (
                    <p className={styles.predWarn}>
                      ⚠️ You need <strong>{needMore}</strong> more consecutive class{needMore!==1?"es":""}{" "}
                      to reach <strong>{targetPct}%</strong>.
                    </p>
                  )}
                </div>
                <div className={styles.predDivider} />
                <div className={styles.predRow}>
                  <span className={styles.predLabel}>
                    Projected Attendance After {leavePlan} Leave Class{leavePlan!==1?"es":""}
                  </span>
                  <span className={`${styles.predValue} ${pctCls(projected)}`}>{projected.toFixed(2)}%</span>
                </div>
              </div>
            </div>

          </section>
        )}

        {/* ── SEO content block ──────────────────────────── */}
        {!data && (
          <section className={styles.seoSection}>
            <div className={styles.seoInner}>
              <h2 className={styles.seoTitle}>About MITS Attendance Tracker</h2>
              <p>
                This free tool helps students of{" "}
                <strong>Madanapalle Institute of Technology &amp; Science (MITS)</strong>,
                affiliated with <strong>JNTUA Ananthapuramu</strong>, to instantly check their
                attendance from the MITS IMS portal (mitsims.in) — with subject codes, subject names,
                and faculty names all in one place.
              </p>
              <div className={styles.seoGrid}>
                <div className={styles.seoCard}>
                  <span className={styles.seoIcon}>📊</span>
                  <h3>Subject-wise Tracking</h3>
                  <p>See attendance for every subject with subject code, full name, faculty name, and classes attended.</p>
                </div>
                <div className={styles.seoCard}>
                  <span className={styles.seoIcon}>👨‍🏫</span>
                  <h3>Faculty Details</h3>
                  <p>View the faculty name assigned to each subject directly alongside your attendance data.</p>
                </div>
                <div className={styles.seoCard}>
                  <span className={styles.seoIcon}>🎯</span>
                  <h3>Smart Predictions</h3>
                  <p>Set your target percentage and instantly know how many classes you can skip or must attend.</p>
                </div>
                <div className={styles.seoCard}>
                  <span className={styles.seoIcon}>📥</span>
                  <h3>CSV Download</h3>
                  <p>Export your full attendance data including faculty names as a CSV file.</p>
                </div>
              </div>
              <p className={styles.seoCredit}>
                Built with ❤️ by <strong>Lingeswar</strong>, CSE student at MITS Madanapalle.
              </p>
            </div>
          </section>
        )}

        {/* ── Footer ────────────────────────────────────── */}
        <footer className={styles.footer}>
          <div className={styles.footerInner}>
            <div>
              <strong className={styles.footerBrand}>MITS Attendance Tracker</strong>
              <p>For students of Madanapalle Institute of Technology &amp; Science</p>
            </div>
            <div className={styles.footerLinks}>
              <a href="https://mitsims.in" target="_blank" rel="noopener noreferrer">MITS IMS Portal</a>
              <a href="https://www.mitsindia.edu" target="_blank" rel="noopener noreferrer">MITS Official Site</a>
            </div>
          </div>
          <p className={styles.footerCredit}>
            © 2026 MITS Attendance Tracker &nbsp;·&nbsp; Built by <strong>Lingeswar</strong> &nbsp;·&nbsp; CSE, MITS Madanapalle
          </p>
        </footer>

      </div>
    </>
  );
}
