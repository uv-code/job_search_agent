import fs from "node:fs";
import path from "node:path";
import express from "express";
import axios from "axios";
import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const HOME_CITY = "Lübeck";
const RADIUS_KM = 100;
const CHECK_INTERVAL_MS = Number(process.env.JOB_CHECK_INTERVAL_MS || 24 * 60 * 60 * 1000);
const JOBS_FILE = "jobs.json";
const STATE_FILE = "state.json";
const FALLBACK_JOBS_FILE = "public/jobs.json";
const VISIT_COUNTER_FILE = path.join(process.cwd(), "data", "counter.json");
const PORTFOLIO_DIR = process.env.PORTFOLIO_DIR || "";
const PORTFOLIO_JOBS_FILE = PORTFOLIO_DIR ? path.join(PORTFOLIO_DIR, "jobs.json") : "";
const PORTFOLIO_STATUS_FILE = PORTFOLIO_DIR ? path.join(PORTFOLIO_DIR, "status.json") : "";
const fsPromises = fs.promises;

function ensureVisitCounterFile() {
  const dir = path.dirname(VISIT_COUNTER_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(VISIT_COUNTER_FILE)) {
    fs.writeFileSync(VISIT_COUNTER_FILE, JSON.stringify({ count: 0 }, null, 2));
  }
}

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

function loadFallbackJobs() {
  const candidateFiles = [JOBS_FILE, FALLBACK_JOBS_FILE];

  for (const filePath of candidateFiles) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    } catch (error) {
      console.warn(`Warnung beim Laden von Fallback-Datei ${filePath}:`, error.message);
    }
  }

  return [];
}

async function fetchAdzunaJobs() {
  const appId = process.env.ADZUNA_APP_ID;
  const apiKey = process.env.ADZUNA_API_KEY;

  if (!appId || !apiKey) {
    const cachedJobs = loadFallbackJobs();
    console.log("⚠️ Adzuna API nicht konfiguriert. Setze ADZUNA_APP_ID und ADZUNA_API_KEY in Azure App Settings oder .env.");
    console.log(`ℹ️  Fallback auf gecachte Jobs: ${cachedJobs.length} Einträge`);
    return cachedJobs;
  }

  const jobs = [];

  for (const query of ADZUNA_SEARCH_QUERIES) {
    const url = `https://api.adzuna.com/v1/api/jobs/de/search/1?app_id=${encodeURIComponent(appId)}&app_key=${encodeURIComponent(apiKey)}&results_per_page=10&what=${encodeURIComponent(query)}&where=${encodeURIComponent(HOME_CITY)}&distance=${RADIUS_KM}`;

    try {
      const response = await axios.get(url, {
        headers: {
          Accept: "application/json",
        },
      });

      const data = response.data || {};
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

export async function fetchLatestJobs() {
  const results = await fetchAdzunaJobs();
  const uniqueResults = results.filter(
    (job, index, arr) => arr.findIndex((item) => item.url === job.url) === index,
  );

  return filterJobs(uniqueResults);
}

function filterJobs(jobs) {
  return jobs.filter((job) => {
    const title = (job.title || "").toLowerCase();
    const company = (job.company_name || "").toLowerCase();
    const haystack = `${title} ${company}`;

    return (
      haystack.includes("it-systemadministrator") ||
      haystack.includes("systemadministrator") ||
      haystack.includes("it administrator") ||
      haystack.includes("it-admin") ||
      haystack.includes("it support") ||
      haystack.includes("support engineer") ||
      haystack.includes("system administrator") ||
      haystack.includes("system engineer") ||
      haystack.includes("windows administrator") ||
      haystack.includes("windows server") ||
      haystack.includes("windows") ||
      haystack.includes("microsoft") ||
      haystack.includes("azure") ||
      haystack.includes("cloud") ||
      haystack.includes("helpdesk") ||
      haystack.includes("cloud engineer") ||
      haystack.includes("m365") ||
      haystack.includes("administrator") ||
      haystack.includes("desktop support") ||
      haystack.includes("network administrator") ||
      haystack.includes("service desk") ||
      haystack.includes("it specialist") ||
      haystack.includes("it operations")
    );
  });
}

function loadOldJobs() {
  if (!fs.existsSync(JOBS_FILE)) return [];
  try {
    const raw = fs.readFileSync(JOBS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn("Fehler beim Laden von jobs.json:", error.message);
    return [];
  }
}

function saveJobs(jobs) {
  fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2));
}

function savePortfolioFiles(allJobs, newJobsCount) {
  if (!PORTFOLIO_DIR || !fs.existsSync(PORTFOLIO_DIR)) {
    console.log("ℹ️  PORTFOLIO_DIR nicht gesetzt oder nicht erreichbar. Überspringe Portfolio-Write für Azure.");
    return;
  }

  try {
    fs.writeFileSync(PORTFOLIO_JOBS_FILE, JSON.stringify(allJobs, null, 2));

    const status = {
      lastRun: new Date().toISOString(),
      newJobsFound: newJobsCount,
      totalJobs: allJobs.length,
      status: newJobsCount > 0 ? "new_jobs_found" : "no_new_jobs",
    };

    fs.writeFileSync(PORTFOLIO_STATUS_FILE, JSON.stringify(status, null, 2));
    console.log(`✍️  Portfolio-Dateien aktualisiert: ${PORTFOLIO_JOBS_FILE}`);
  } catch (error) {
    console.error("Fehler beim Speichern der Portfolio-Dateien:", error.message);
  }
}

async function pushPortfolioToGitHub() {
  if (!PORTFOLIO_DIR || !fs.existsSync(PORTFOLIO_DIR)) {
    console.log("ℹ️  GitHub-Push übersprungen, da PORTFOLIO_DIR in Azure nicht gesetzt ist.");
    return;
  }

  try {
    const { execSync } = await import("child_process");
    console.log("🔄 Pushe Job-Ergebnisse zu GitHub...");

    execSync(`cd "${PORTFOLIO_DIR}" && git add jobs.json status.json && git commit -m "Update job results $(date)" && git push`, {
      encoding: "utf-8",
      stdio: "pipe",
    });

    console.log("✅ GitHub Push erfolgreich!");
  } catch (error) {
    const message = error.message || error.toString();
    if (message.includes("nothing to commit") || message.includes("no changes added")) {
      console.log("ℹ️  Keine neuen Job-Dateien zum Pushen.");
    } else {
      console.error("GitHub Push fehlgeschlagen:", message);
    }
  }
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

export async function runAgent() {
  console.log("🔍 Checking for new jobs...");

  const filtered = await fetchLatestJobs();

  if (filtered.length === 0) {
    console.log("Keine passenden Adzuna-Stellen gefunden. Prüfe später erneut oder ergänze die Keywords.");
    return { jobs: [], status: { status: "no_new_jobs", totalJobs: 0, newJobsFound: 0 } };
  }

  const oldJobs = loadOldJobs();
  const newJobs = detectNewJobs(oldJobs, filtered.map((job) => ({
    id: job.url,
    title: job.title,
    company_name: job.company_name || job.company || job.source || "Adzuna",
    url: job.url,
    source: job.source || "Adzuna",
  })));

  const nextJobs = [...oldJobs, ...newJobs].slice(-2000);
  const lastRun = new Date().toISOString();

  if (newJobs.length === 0) {
    console.log("Keine neuen Jobs heute.");
    saveJobs(nextJobs);
    savePortfolioFiles(nextJobs, 0);
    return {
      jobs: filtered,
      status: {
        lastRun,
        newJobsFound: 0,
        totalJobs: nextJobs.length,
        status: "no_new_jobs",
      },
    };
  }

  console.log(`Neue Jobs gefunden: ${newJobs.length}`);
  newJobs.forEach((job) => {
    console.log(`- ${job.title} (${job.company_name})`);
  });

  await sendEmail(newJobs);

  const allKnownJobs = [...oldJobs, ...newJobs];
  saveJobs(allKnownJobs);
  savePortfolioFiles(allKnownJobs, newJobs.length);

  await pushPortfolioToGitHub();

  return {
    jobs: filtered,
    status: {
      lastRun,
      newJobsFound: newJobs.length,
      totalJobs: allKnownJobs.length,
      status: "new_jobs_found",
    },
  };
}

function applyCors(req, res, next) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }

  next();
}

async function handleAgentRequest(req, res) {
  try {
    const payload = await fetchLatestJobs();
    const hasAdzunaConfig = Boolean(process.env.ADZUNA_APP_ID && process.env.ADZUNA_API_KEY);

    res.json({
      jobs: payload,
      status: {
        lastRun: new Date().toISOString(),
        newJobsFound: payload.length,
        totalJobs: payload.length,
        status: hasAdzunaConfig ? (payload.length > 0 ? "new_jobs_found" : "no_new_jobs") : "fallback_cache",
      },
    });
  } catch (error) {
    console.error("Agent request failed:", error);
    res.status(500).json({
      error: "Agent failed to fetch jobs",
      details: error.message,
    });
  }
}

async function startApiServer() {
  const app = express();
  const port = Number(process.env.PORT || 3001);

  app.use(express.json());
  app.use(applyCors);

  app.get("/updateJobs", async (req, res) => {
    await handleAgentRequest(req, res);
  });

  app.post("/updateJobs", async (req, res) => {
    await handleAgentRequest(req, res);
  });

  app.get("/copilot-agent/updateJobs", async (req, res) => {
    await handleAgentRequest(req, res);
  });

  app.post("/copilot-agent/updateJobs", async (req, res) => {
    await handleAgentRequest(req, res);
  });

  app.get("/visit", (req, res) => {
    try {
      ensureVisitCounterFile();

      const forwardedFor = Array.isArray(req.headers["x-forwarded-for"])
        ? req.headers["x-forwarded-for"][0]
        : req.headers["x-forwarded-for"];

      const ip = (forwardedFor || "").split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
      const raw = fs.readFileSync(VISIT_COUNTER_FILE, "utf8");
      const data = JSON.parse(raw || '{}');
      const nextCount = Number(data.count || 0) + 1;

      data.count = nextCount;
      fs.writeFileSync(VISIT_COUNTER_FILE, JSON.stringify(data, null, 2));

      res.json({
        visitorIp: ip,
        totalVisits: nextCount,
      });
    } catch (error) {
      console.error("Visit counter failed:", error);
      res.status(500).json({
        error: "Visit counter failed",
        details: error.message,
      });
    }
  });

  app.get("/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.listen(port, () => {
    console.log(`🤖 Azure-ready Job Agent is running on http://localhost:${port}`);
    console.log("📡 Endpoints: /updateJobs and /copilot-agent/updateJobs");
  });
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

if (process.argv.includes("--api") || process.argv.includes("--serve") || process.env.AZURE_APP_SERVICE === "true") {
  startApiServer();
} else if (process.argv.includes("--daily")) {
  startDailyLoop();
} else {
  startDailyLoop();
}
