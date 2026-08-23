import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        {/* ── Favicon / Icons ─────────────────────────── */}
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="manifest" href="/site.webmanifest" />
        <meta name="theme-color" content="#1e3a6e" />

        {/* ── Fonts ───────────────────────────────────── */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />

        {/* ── JSON-LD Structured Data (Google rich result) */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebApplication",
              "name": "MITS Attendance Tracker",
              "url": "https://mits-attendance.vercel.app",
              "description":
                "Free online attendance tracker for MITS Madanapalle students. Login with MITS IMS credentials to view subject-wise attendance, predictions, and leave planning.",
              "applicationCategory": "EducationApplication",
              "operatingSystem": "All",
              "offers": { "@type": "Offer", "price": "0", "priceCurrency": "INR" },
              "author": {
                "@type": "Person",
                "name": "Lingeswar",
                "affiliation": {
                  "@type": "CollegeOrUniversity",
                  "name": "Madanapalle Institute of Technology and Science",
                  "alternateName": "MITS",
                  "url": "https://www.mitsindia.edu"
                }
              },
              "featureList": [
                "Subject-wise attendance tracking",
                "Overall attendance overview",
                "Leave planning and prediction",
                "CSV download",
                "MITS IMS integration"
              ]
            }),
          }}
        />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
