const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const { spawn } = require("child_process");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const TEMPLATE = path.join(ROOT, "android-template");
const WORK_ROOT = path.join(ROOT, "work");
const APK_TTL_MS = 60 * 60 * 1000;
const MAX_CONCURRENT_BUILDS = Number(process.env.MAX_CONCURRENT_BUILDS || 1);

fs.mkdirSync(WORK_ROOT, { recursive: true });

app.disable("x-powered-by");
app.use(helmet({
  // The frontend uses inline styles/scripts in one static HTML file.
  contentSecurityPolicy: false
}));
app.use(express.json({ limit: "20kb" }));
app.use("/api/", rateLimit({
  windowMs: 60 * 1000,
  limit: 12,
  standardHeaders: "draft-8",
  legacyHeaders: false
}));
app.use(express.static(path.join(ROOT, "public"), { index: "index.html" }));

const jobs = new Map();
let activeBuilds = 0;

function validateWebsiteUrl(value) {
  if (typeof value !== "string" || value.length > 2048) {
    throw new Error("Website URL is required (maximum 2048 characters).");
  }
  let url;
  try { url = new URL(value.trim()); } catch {
    throw new Error("Enter a valid website URL, for example https://example.com");
  }
  if (url.protocol !== "https:") {
    throw new Error("For this MVP, the website URL must start with https://");
  }
  if (!url.hostname || url.username || url.password) {
    throw new Error("Enter a public HTTPS URL without username or password.");
  }
  if (url.hostname === "localhost" || url.hostname.endsWith(".localhost") ||
      url.hostname.endsWith(".local") || url.hostname === "127.0.0.1" ||
      url.hostname === "::1") {
    throw new Error("Localhost URLs cannot be packaged for other devices.");
  }
  return url.toString();
}

function validateAppName(value) {
  if (typeof value !== "string") throw new Error("App name is required.");
  const name = value.trim();
  if (name.length < 2 || name.length > 30) {
    throw new Error("App name must be between 2 and 30 characters.");
  }
  if (!/^[\p{L}\p{N} _.-]+$/u.test(name)) {
    throw new Error("App name can use letters, numbers, spaces, dots, _ and - only.");
  }
  return name;
}

function validatePackageName(value) {
  if (typeof value !== "string") throw new Error("Package name is required.");
  const pkg = value.trim();
  // Android application IDs need at least two dot-separated segments.
  if (pkg.length > 150 || !/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/i.test(pkg)) {
    throw new Error("Use a package name like com.example.myapp (letters/numbers, dot-separated; each part starts with a letter).");
  }
  return pkg;
}

function xmlEscape(value) {
  return value.replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function copyDir(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

function runGradle(projectDir, job) {
  return new Promise((resolve, reject) => {
    const gradleCommand = process.env.GRADLE_COMMAND ||
      (process.platform === "win32" ? "gradle.bat" : "gradle");
    const child = spawn(gradleCommand, [
      "--no-daemon",
      "--stacktrace",
      "assembleDebug"
    ], {
      cwd: projectDir,
      env: process.env,
      windowsHide: true
    });

    let output = "";
    const keepTail = (chunk) => {
      output = (output + chunk.toString()).slice(-18000);
    };
    child.stdout.on("data", keepTail);
    child.stderr.on("data", keepTail);
    child.on("error", (error) => reject(new Error(
      `Could not start Gradle. Install Gradle and configure Android SDK. Details: ${error.message}`
    )));
    child.on("close", (code) => {
      job.buildLog = output;
      if (code === 0) resolve();
      else reject(new Error("Android build failed. Check the server console/build log and setup instructions."));
    });
  });
}

async function buildApk(job, options) {
  const projectDir = path.join(WORK_ROOT, job.id, "project");
  const apkDir = path.join(WORK_ROOT, job.id);
  try {
    job.status = "building";
    job.message = "Preparing Android project…";
    copyDir(TEMPLATE, projectDir);

    const appGradle = path.join(projectDir, "app", "build.gradle");
    let gradleText = fs.readFileSync(appGradle, "utf8");
    gradleText = gradleText
      .replaceAll("__PACKAGE_NAME__", options.packageName)
      .replaceAll("__APP_NAME_XML__", xmlEscape(options.appName))
      .replaceAll("__WEBSITE_URL_XML__", xmlEscape(options.websiteUrl));
    fs.writeFileSync(appGradle, gradleText, "utf8");

    job.message = "Building APK with Android SDK and Gradle…";
    await runGradle(projectDir, job);

    const builtApk = path.join(projectDir, "app", "build", "outputs", "apk", "debug", "app-debug.apk");
    if (!fs.existsSync(builtApk)) throw new Error("Gradle finished but the APK file was not found.");
    const finalApk = path.join(apkDir, "website-app.apk");
    fs.copyFileSync(builtApk, finalApk);
    job.apkPath = finalApk;
    job.status = "completed";
    job.message = "APK ready to download.";
  } catch (error) {
    job.status = "failed";
    job.message = error.message;
    console.error(`[${job.id}] ${error.stack || error}`);
  } finally {
    activeBuilds = Math.max(0, activeBuilds - 1);
    job.finishedAt = Date.now();
  }
}

app.post("/api/build", (req, res) => {
  let options;
  try {
    options = {
      websiteUrl: validateWebsiteUrl(req.body.websiteUrl),
      appName: validateAppName(req.body.appName),
      packageName: validatePackageName(req.body.packageName)
    };
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  if (activeBuilds >= MAX_CONCURRENT_BUILDS) {
    return res.status(429).json({ error: "A build is already running. Please wait and try again." });
  }

  const id = crypto.randomUUID();
  const job = {
    id, status: "queued", message: "Build queued…",
    createdAt: Date.now(), finishedAt: null, apkPath: null, buildLog: ""
  };
  jobs.set(id, job);
  activeBuilds += 1;
  res.status(202).json({ id, status: job.status, message: job.message });
  buildApk(job, options);
});

app.get("/api/status/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Build not found or expired." });
  res.json({
    id: job.id, status: job.status, message: job.message,
    downloadUrl: job.status === "completed" ? `/api/download/${job.id}` : null
  });
});

app.get("/api/download/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || job.status !== "completed" || !job.apkPath || !fs.existsSync(job.apkPath)) {
    return res.status(404).json({ error: "APK is not ready or has expired." });
  }
  res.download(job.apkPath, "website-app.apk");
});

// Remove generated APKs after one hour to avoid filling the server disk.
setInterval(() => {
  const cutoff = Date.now() - APK_TTL_MS;
  for (const [id, job] of jobs) {
    if (job.createdAt < cutoff && job.status !== "building") {
      fs.rm(path.join(WORK_ROOT, id), { recursive: true, force: true }, () => {});
      jobs.delete(id);
    }
  }
}, 5 * 60 * 1000).unref();

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Website-to-APK running at http://localhost:${PORT}`);
  console.log(`Node: ${process.version}; OS: ${os.platform()} ${os.arch()}`);
  console.log("Requires JDK 17+, Android SDK (platform 35 + build-tools 35.0.0), and Gradle 8.9+.");
});
