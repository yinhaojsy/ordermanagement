import fs from "fs";
import path from "path";
import archiver from "archiver";
import { db } from "../db.js";
import { tryAcquireBackupLock, releaseBackupLock } from "./backupLock.js";
import {
  computeNextRunAt,
  defaultAutoBackupSettings,
  normalizeAutoBackupInput,
} from "./autoBackupSchedule.js";

const AUTO_BACKUP_KEY = "auto_backup";
const AUTO_FILE_RE = /^auto-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.(db|zip)$/;

const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "server", "data");
const uploadsDir = path.join(dataDir, "uploads");
const autoDir = path.join(dataDir, "backups", "auto");

let timer = null;
let tickInProgress = false;

function ensureAutoDir() {
  fs.mkdirSync(autoDir, { recursive: true });
}

function cleanupTempSnapshots() {
  if (!fs.existsSync(autoDir)) return;
  for (const file of fs.readdirSync(autoDir)) {
    if (file.startsWith("snapshot-") && file.endsWith(".db")) {
      try {
        fs.unlinkSync(path.join(autoDir, file));
      } catch {
        // ignore leftover snapshot cleanup errors
      }
    }
  }
}

function writeSettings(settings) {
  const updatedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO settings (key, value, updatedAt)
     VALUES (@key, @value, @updatedAt)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`,
  ).run({
    key: AUTO_BACKUP_KEY,
    value: JSON.stringify(settings),
    updatedAt,
  });
}

function mergeStored(parsed) {
  const defaults = defaultAutoBackupSettings();
  const normalized = normalizeAutoBackupInput({ ...defaults, ...parsed });
  const value = normalized.ok ? normalized.value : {
    enabled: defaults.enabled,
    frequency: defaults.frequency,
    intervalHours: defaults.intervalHours,
    time: defaults.time,
    timezone: defaults.timezone,
    weekday: defaults.weekday,
    dayOfMonth: defaults.dayOfMonth,
    endOfMonth: defaults.endOfMonth,
    includeFiles: defaults.includeFiles,
    retentionCount: defaults.retentionCount,
  };
  return {
    ...value,
    nextRunAt: typeof parsed.nextRunAt === "string" ? parsed.nextRunAt : null,
    lastRunAt: typeof parsed.lastRunAt === "string" ? parsed.lastRunAt : null,
    lastStatus: parsed.lastStatus === "success" || parsed.lastStatus === "error" ? parsed.lastStatus : null,
    lastError: typeof parsed.lastError === "string" ? parsed.lastError : null,
  };
}

export function getAutoBackupState() {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(AUTO_BACKUP_KEY);
  if (!row) {
    return { settings: defaultAutoBackupSettings(), saved: false };
  }
  try {
    return { settings: mergeStored(JSON.parse(row.value)), saved: true };
  } catch {
    return { settings: defaultAutoBackupSettings(), saved: false };
  }
}

export function updateAutoBackupSettings(input) {
  const normalized = normalizeAutoBackupInput(input);
  if (!normalized.ok) {
    const error = new Error(normalized.message);
    error.status = 400;
    throw error;
  }
  const previous = getAutoBackupState().settings;
  const settings = {
    ...normalized.value,
    nextRunAt: computeNextRunAt(normalized.value, new Date()).toISOString(),
    lastRunAt: previous.lastRunAt,
    lastStatus: previous.lastStatus,
    lastError: previous.lastError,
  };
  writeSettings(settings);
  return settings;
}

function listFilesOldestFirst() {
  if (!fs.existsSync(autoDir)) return [];
  return fs
    .readdirSync(autoDir)
    .filter((file) => AUTO_FILE_RE.test(file))
    .map((file) => {
      const fullPath = path.join(autoDir, file);
      const stats = fs.statSync(fullPath);
      return {
        file,
        fullPath,
        mtimeMs: stats.mtimeMs,
        size: stats.size,
        includeFiles: file.endsWith(".zip"),
      };
    })
    .sort((a, b) => a.mtimeMs - b.mtimeMs || a.file.localeCompare(b.file));
}

function pruneAutoBackups(retentionCount) {
  const files = listFilesOldestFirst();
  while (files.length >= retentionCount) {
    const oldest = files.shift();
    fs.unlinkSync(oldest.fullPath);
  }
}

export function listAutoBackupFiles() {
  return listFilesOldestFirst()
    .slice()
    .reverse()
    .map(({ file, size, mtimeMs, includeFiles }) => ({
      file,
      size,
      createdAt: new Date(mtimeMs).toISOString(),
      includeFiles,
    }));
}

export function resolveAutoBackupFile(file) {
  if (typeof file !== "string" || !AUTO_FILE_RE.test(file)) {
    const error = new Error("Invalid automatic backup file");
    error.status = 400;
    throw error;
  }
  const root = path.resolve(autoDir);
  const fullPath = path.resolve(root, file);
  if (fullPath !== path.join(root, file)) {
    const error = new Error("Invalid automatic backup file");
    error.status = 400;
    throw error;
  }
  if (!fs.existsSync(fullPath)) return null;
  return { file, fullPath, includeFiles: file.endsWith(".zip") };
}

export function deleteAutoBackupFile(file) {
  const resolved = resolveAutoBackupFile(file);
  if (!resolved) {
    const error = new Error("Automatic backup not found");
    error.status = 404;
    throw error;
  }
  fs.unlinkSync(resolved.fullPath);
  return resolved.file;
}

function writeZip(snapshotPath, zipPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", resolve);
    output.on("error", reject);
    archive.on("error", reject);
    archive.pipe(output);
    archive.file(snapshotPath, { name: "app.db" });
    if (fs.existsSync(uploadsDir)) {
      archive.directory(uploadsDir, "uploads");
    }
    archive.finalize();
  });
}

async function writeAutoBackupFile(includeFiles) {
  ensureAutoDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  if (!includeFiles) {
    const filename = `auto-${timestamp}.db`;
    await db.backup(path.join(autoDir, filename));
    return filename;
  }

  const filename = `auto-${timestamp}.zip`;
  const zipPath = path.join(autoDir, filename);
  const snapshotPath = path.join(autoDir, `snapshot-${timestamp}.db`);
  try {
    await db.backup(snapshotPath);
    await writeZip(snapshotPath, zipPath);
  } catch (error) {
    if (fs.existsSync(zipPath)) {
      try {
        fs.unlinkSync(zipPath);
      } catch {
        // ignore partial zip cleanup errors
      }
    }
    throw error;
  } finally {
    if (fs.existsSync(snapshotPath)) {
      try {
        fs.unlinkSync(snapshotPath);
      } catch {
        // ignore snapshot cleanup errors
      }
    }
  }
  return filename;
}

function recordRunResult(status, errorMessage) {
  const latest = getAutoBackupState().settings;
  latest.lastRunAt = new Date().toISOString();
  latest.lastStatus = status;
  latest.lastError = errorMessage;
  latest.nextRunAt = computeNextRunAt(latest, new Date()).toISOString();
  writeSettings(latest);
  return latest;
}

async function performAutoBackup() {
  if (!tryAcquireBackupLock()) return false;
  try {
    const { settings } = getAutoBackupState();
    if (!settings.enabled) return false;
    pruneAutoBackups(settings.retentionCount);
    const file = await writeAutoBackupFile(settings.includeFiles);
    const latest = recordRunResult("success", null);
    console.log(`[auto-backup] created ${file}; next ${latest.nextRunAt}`);
    return true;
  } catch (error) {
    console.error("[auto-backup] failed:", error);
    try {
      const latest = recordRunResult("error", error?.message || "Automatic backup failed");
      console.error(`[auto-backup] next attempt ${latest.nextRunAt}`);
    } catch (writeError) {
      console.error("[auto-backup] could not record failure:", writeError);
    }
    return false;
  } finally {
    releaseBackupLock();
  }
}

export async function runDueAutoBackup() {
  if (tickInProgress) return;
  tickInProgress = true;
  try {
    const { settings, saved } = getAutoBackupState();
    if (!saved || !settings.enabled) return;
    if (!settings.nextRunAt) {
      writeSettings({
        ...settings,
        nextRunAt: computeNextRunAt(settings, new Date()).toISOString(),
      });
      return;
    }
    const due = Date.parse(settings.nextRunAt);
    if (!Number.isFinite(due) || Date.now() < due) return;
    await performAutoBackup();
  } catch (error) {
    console.error("[auto-backup] scheduler error:", error);
  } finally {
    tickInProgress = false;
  }
}

export function startAutoBackupScheduler() {
  if (timer) return;
  ensureAutoDir();
  cleanupTempSnapshots();
  const tick = () => {
    runDueAutoBackup().catch((error) => {
      console.error("[auto-backup] scheduler error:", error);
    });
  };
  setTimeout(tick, 5000);
  timer = setInterval(tick, 30 * 1000);
  console.log("[auto-backup] scheduler started");
}

export function stopAutoBackupScheduler() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  console.log("[auto-backup] scheduler stopped");
}
