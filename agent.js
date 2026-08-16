import fs from "node:fs";
import fetch from "node-fetch";
import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const HOME_CITY = "Lübeck";
const RADIUS_KM = 100;
const CHECK_INTERVAL_MS = Number(process.env.JOB_CHECK_INTERVAL_MS || 24 * 60 * 60 * 1000);
const JOBS_FILE = "jobs.json";

const ADZUNA_SEARCH_QUERIES = [
  "IT Systemadministrator",
  "IT Administrator",
  "IT Support",
  "Systemadministrator",
  "Windows Administrator",
  "Azure Engineer",
  "Support Engineer",
  "Helpdesk",
  "Cloud Engineer",
  "Microsoft Administrator",
  "Cloud Administrator",
];

async function fetchAdzunaJobs() {
  const appId = process.env.ADZUNA_APP_ID;
  const apiKey = process.env.ADZUNA_API_KEY;

  if (!appId || !apiKey) {
    console.log("⚠️ Adzuna API nicht konfiguriert. Setze ADZUNA_APP_ID und ADZUNA_API_KEY in .env");
    return [];
  }

  const jobs = [];

  for (const query of ADZUNA_SEARCH_QUERIES) {
    const url = `https://api.adzuna.com/v1/api/jobs/de/search/1?app_id=${encodeURIComponent(appId)}&app_key=${encodeURIComponent(apiKey)}&results_per_page=10&what=${encodeURIComponent(query)}&where=${encodeURIComponent(HOME_CITY)}&distance=${RADIUS_KM}`;

    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Adzuna HTTP ${response.status}`);
      }

      const data = await response.json();
      const results = Array.isArray(data.results) ? data.results : [];

      for (const job of results) {
        const title = job.title || "";
        const companyName = job.company && job.company.display_name ? job.company.display_name : "Unknown";
        const urlValue = job.redirect_url || job.url || "";

        if (!title || !urlValue) continue;

        jobs.push({
          id: job.id || `${title}:${companyName}:${urlValue}`,
          title,
          company_name: companyName,
          url: urlValue,
          source: "Adzuna",
        });
      }
    } catch (error) {
      console.log(`Adzuna request failed for "${query}": ${error.message}`);
    }
  }

  return jobs;
}

async function fetchJobs() {
  return fetchAdzunaJobs();
}

function filterJobs(jobs) {
  return jobs.filter((job) => {
    const title = (job.title || "").toLowerCase();
    return (
      title.includes("it-systemadministrator") ||
      title.includes("it administrator") ||
      title.includes("it support") ||
      title.includes("system administrator") ||
      title.includes("system engineer") ||
      title.includes("windows administrator") ||
      title.includes("windows") ||
      title.includes("microsoft") ||
      title.includes("azure") ||
      title.includes("cloud") ||
      title.includes("systemadministrator") ||
      title.includes("support engineer") ||
      title.includes("helpdesk") ||
      title.includes("cloud engineer") ||
      title.includes("m365") ||
      title.includes("administrator")
    );
  });
}

function loadOldJobs() {
  if (!fs.existsSync(JOBS_FILE)) return [];
  const raw = fs.readFileSync(JOBS_FILE, "utf8");
  return JSON.parse(raw);
}

function saveJobs(jobs) {
  fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2));
}

function detectNewJobs(oldJobs, newJobs) {
  const oldIds = new Set((oldJobs || []).map((job) => job.id));
  return newJobs.filter((job) => !oldIds.has(job.id));
}

async function readState() {
  try {
    const raw = await fsPromises.readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return {
      seen: Array.isArray(parsed.seen) ? parsed.seen : [],
    };
  } catch {
    return { seen: [] };
  }
}

async function writeState(seenUrls) {
  await fsPromises.writeFile(
    STATE_FILE,
    JSON.stringify({ seen: seenUrls.slice(-2000) }, null, 2),
    "utf8",
  );
}

function getMailConfig() {
  return {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false").toLowerCase() === "true",
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: process.env.SMTP_TO || process.env.SMTP_USER,
  };
}

async function sendEmail(newJobs) {
  const config = getMailConfig();

  if (!config.host || !config.user || !config.pass || !config.to) {
    console.log("📧 Keine SMTP-Konfiguration gefunden. E-Mail-Benachrichtigung übersprungen.");
    console.log("Setze in .env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_TO");
    return;
  }

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  });

  const htmlRows = newJobs
    .map(
      (job, index) => `
        <tr>
          <td>${index + 1}</td>
          <td><strong>${job.title}</strong></td>
          <td>${job.source}</td>
          <td><a href="${job.url}">${job.url}</a></td>
        </tr>
      `,
    )
    .join("");

  await transporter.sendMail({
    from: config.from,
    to: config.to,
    subject: `Neue IT-Administrator Jobs in ${HOME_CITY}`,
    html: `
      <h2>Neue Jobangebote</h2>
      <p>Es wurden ${newJobs.length} neue passende Stellen gefunden.</p>
      <table border="1" cellpadding="8" cellspacing="0">
        <thead>
          <tr>
            <th>#</th>
            <th>Stelle</th>
            <th>Quelle</th>
            <th>Link</th>
          </tr>
        </thead>
        <tbody>
          ${htmlRows}
        </tbody>
      </table>
    `,
  });

  console.log(`📧 E-Mail für ${newJobs.length} neue Jobs wurde versendet.`);
}

async function runAgent() {
  console.log("🔍 Checking for new jobs...");

  const results = await fetchJobs();
  const filtered = filterJobs(
    results.filter((job, index, arr) => arr.findIndex((item) => item.url === job.url) === index),
  );

  if (filtered.length === 0) {
    console.log("Keine passenden Adzuna-Stellen gefunden. Prüfe später erneut oder ergänze die Keywords.");
    return;
  }

  const oldJobs = loadOldJobs();
  const newJobs = detectNewJobs(oldJobs, filtered.map((job) => ({
    id: job.url,
    title: job.title,
    company_name: job.company_name || job.company || job.source || "Adzuna",
    url: job.url,
    source: job.source || "Adzuna",
  })));

  if (newJobs.length === 0) {
    console.log("Keine neuen Jobs heute.");
    return;
  }

  console.log(`Neue Jobs gefunden: ${newJobs.length}`);
  newJobs.forEach((job) => {
    console.log(`- ${job.title} (${job.company_name})`);
  });

  await sendEmail(newJobs);

  saveJobs([...oldJobs, ...newJobs]);
}

async function startDailyLoop() {
  await runAgent();

  if (process.env.DISABLE_DAILY_LOOP === "true") {
    return;
  }

  console.log(`⏰ Tägliche Prüfung gestartet. Nächster Lauf in ${Math.round(CHECK_INTERVAL_MS / 60000)} Minuten.`);
  setInterval(async () => {
    try {
      await runAgent();
    } catch (error) {
      console.error("Fehler beim täglichen Job-Check:", error.message);
    }
  }, CHECK_INTERVAL_MS);
}

startDailyLoop();
