import { db, resetDbInstance, dbPath, initDatabase, replaceDatabaseFromPath } from "../db.js";
import fs from "fs";
import path from "path";
import {
  saveFile,
  deleteFile,
  getFileUrl,
  generateBrandingFaviconFilename,
} from "../utils/fileStorage.js";

const APP_DOCUMENT_TITLE_EN_KEY = "app_document_title_en";
const APP_DOCUMENT_TITLE_ZH_KEY = "app_document_title_zh";
const APP_FAVICON_PATH_KEY = "app_favicon_path";
import archiver from "archiver";
import AdmZip from "adm-zip";

const isSafetyBackup = (file) =>
  typeof file === "string" && file.startsWith("pre-restore-") && file.endsWith(".db");

// Get paths
const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "server", "data");
const uploadsDir = path.join(dataDir, "uploads");
const backupsDir = path.join(dataDir, "backups");

// Ensure backups directory exists
if (!fs.existsSync(backupsDir)) {
  fs.mkdirSync(backupsDir, { recursive: true });
}

const removeDirSafe = (dir) => {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

const isZipBackupFile = (file) => {
  const name = (file.originalname || "").toLowerCase();
  const mime = (file.mimetype || "").toLowerCase();
  return (
    name.endsWith(".zip") ||
    mime === "application/zip" ||
    mime === "application/x-zip-compressed"
  );
};

const restoreDatabaseFromFile = (sourcePath) => {
  replaceDatabaseFromPath(sourcePath);
};

const rollbackDatabaseFromSafety = (safetyBackupPath) => {
  if (!fs.existsSync(safetyBackupPath)) {
    resetDbInstance();
    return;
  }
  replaceDatabaseFromPath(safetyBackupPath);
};

const parseIncludeFilesFlag = (value) => value === true || value === "true";

/**
 * Restore app.db and optional uploads/ from a backup zip (layout from createBackup).
 */
const restoreFromZipArchive = (zipPath, timestamp) => {
  const extractDir = path.join(backupsDir, `extract-${timestamp}`);
  removeDirSafe(extractDir);
  fs.mkdirSync(extractDir, { recursive: true });

  try {
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(extractDir, true);

    const extractedDb = path.join(extractDir, "app.db");
    if (!fs.existsSync(extractedDb)) {
      throw new Error("Invalid backup archive: app.db not found");
    }

    const extractedUploads = path.join(extractDir, "uploads");
    const hasUploads = fs.existsSync(extractedUploads);
    let uploadsSafetyPath = null;

    try {
      if (hasUploads) {
        uploadsSafetyPath = path.join(dataDir, `uploads-pre-restore-${timestamp}`);
        if (fs.existsSync(uploadsSafetyPath)) {
          removeDirSafe(uploadsSafetyPath);
        }
        if (fs.existsSync(uploadsDir)) {
          fs.renameSync(uploadsDir, uploadsSafetyPath);
        }
        fs.mkdirSync(path.dirname(uploadsDir), { recursive: true });
        fs.renameSync(extractedUploads, uploadsDir);
      }

      restoreDatabaseFromFile(extractedDb);
      return { restoredUploads: hasUploads };
    } catch (err) {
      if (hasUploads) {
        try {
          removeDirSafe(uploadsDir);
          if (uploadsSafetyPath && fs.existsSync(uploadsSafetyPath)) {
            fs.renameSync(uploadsSafetyPath, uploadsDir);
          }
        } catch (rollbackErr) {
          console.error("Uploads rollback error:", rollbackErr);
        }
      }
      resetDbInstance();
      throw err;
    }
  } finally {
    removeDirSafe(extractDir);
  }
};

export const getSetting = (req, res, next) => {
  try {
    const { key } = req.params;
    const setting = db.prepare("SELECT * FROM settings WHERE key = ?").get(key);
    
    if (!setting) {
      return res.json({ key, value: null });
    }
    
    res.json({ key: setting.key, value: setting.value });
  } catch (error) {
    next(error);
  }
};

export const getPublicBranding = (_req, res, next) => {
  try {
    const read = (key) => {
      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
      return row?.value != null ? String(row.value) : "";
    };
    const faviconPath = read(APP_FAVICON_PATH_KEY).trim();
    res.json({
      documentTitleEn: read(APP_DOCUMENT_TITLE_EN_KEY),
      documentTitleZh: read(APP_DOCUMENT_TITLE_ZH_KEY),
      faviconUrl: faviconPath ? getFileUrl(faviconPath) : null,
    });
  } catch (error) {
    next(error);
  }
};

export const uploadSiteFavicon = (req, res, next) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ message: "No file uploaded" });
    }
    const prev = db.prepare("SELECT value FROM settings WHERE key = ?").get(APP_FAVICON_PATH_KEY);
    if (prev?.value) {
      deleteFile(prev.value);
    }
    const filename = generateBrandingFaviconFilename(req.file.mimetype, req.file.originalname);
    const relative = saveFile(req.file.buffer, filename, "branding");
    const updatedAt = new Date().toISOString();
    db.prepare(
      `INSERT INTO settings (key, value, updatedAt)
       VALUES (@key, @value, @updatedAt)
       ON CONFLICT(key) DO UPDATE SET value = @value, updatedAt = @updatedAt`,
    ).run({
      key: APP_FAVICON_PATH_KEY,
      value: relative,
      updatedAt,
    });
    res.json({
      path: relative,
      url: getFileUrl(relative),
      message: "Favicon updated",
    });
  } catch (error) {
    next(error);
  }
};

export const deleteSiteFavicon = (_req, res, next) => {
  try {
    const prev = db.prepare("SELECT value FROM settings WHERE key = ?").get(APP_FAVICON_PATH_KEY);
    if (prev?.value) {
      deleteFile(prev.value);
    }
    db.prepare("DELETE FROM settings WHERE key = ?").run(APP_FAVICON_PATH_KEY);
    res.json({ message: "Favicon removed" });
  } catch (error) {
    next(error);
  }
};

export const setSetting = (req, res, next) => {
  try {
    const { key, value } = req.body;
    
    if (!key) {
      return res.status(400).json({ message: "Setting key is required" });
    }
    
    // Insert or update
    db.prepare(
      `INSERT INTO settings (key, value, updatedAt) 
       VALUES (@key, @value, @updatedAt)
       ON CONFLICT(key) DO UPDATE SET value = @value, updatedAt = @updatedAt`
    ).run({
      key,
      value: String(value),
      updatedAt: new Date().toISOString(),
    });
    
    res.json({ key, value, message: "Setting updated successfully" });
  } catch (error) {
    next(error);
  }
};

// Create backup (database only or with files)
export const createBackup = (req, res, next) => {
  try {
    const { includeFiles } = req.body;
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    
    if (includeFiles) {
      const zipFilename = `backup-with-files-${timestamp}.zip`;
      const snapshotPath = path.join(backupsDir, `zip-snapshot-${timestamp}.db`);

      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${zipFilename}"`);

      db.backup(snapshotPath)
        .then(() => {
          const archive = archiver("zip", { zlib: { level: 9 } });

          archive.on("error", (err) => {
            console.error("Archive error:", err);
            if (fs.existsSync(snapshotPath)) {
              try {
                fs.unlinkSync(snapshotPath);
              } catch {
                // ignore
              }
            }
            if (!res.headersSent) {
              res.status(500).json({ message: "Error creating backup archive" });
            }
          });

          archive.pipe(res);
          archive.file(snapshotPath, { name: "app.db" });

          if (fs.existsSync(uploadsDir)) {
            archive.directory(uploadsDir, "uploads");
          }

          archive.on("end", () => {
            if (fs.existsSync(snapshotPath)) {
              try {
                fs.unlinkSync(snapshotPath);
              } catch {
                // ignore
              }
            }
          });

          archive.finalize();
        })
        .catch((err) => {
          console.error("Backup error:", err);
          if (fs.existsSync(snapshotPath)) {
            try {
              fs.unlinkSync(snapshotPath);
            } catch {
              // ignore
            }
          }
          if (!res.headersSent) {
            res.status(500).json({ message: "Error creating database backup" });
          }
        });
    } else {
      // Database only backup
      const dbFilename = `backup-${timestamp}.db`;
      
      res.setHeader("Content-Type", "application/x-sqlite3");
      res.setHeader("Content-Disposition", `attachment; filename="${dbFilename}"`);
      
      // Create a backup using better-sqlite3's backup API (expects a path string)
      const backupPath = path.join(backupsDir, dbFilename);
      
      db.backup(backupPath)
        .then(() => {
          // Stream the backup file to response
          const stream = fs.createReadStream(backupPath);
          stream.pipe(res);
          
          stream.on("end", () => {
            // Clean up backup file after sending
            fs.unlinkSync(backupPath);
          });
          
          stream.on("error", (err) => {
            console.error("Stream error:", err);
            if (!res.headersSent) {
              res.status(500).json({ message: "Error streaming backup" });
            }
          });
        })
        .catch((err) => {
          console.error("Backup error:", err);
          if (fs.existsSync(backupPath)) {
            fs.unlinkSync(backupPath);
          }
          if (!res.headersSent) {
            res.status(500).json({ message: "Error creating database backup" });
          }
        });
    }
  } catch (error) {
    console.error("Backup error:", error);
    next(error);
  }
};

// Restore from uploaded backup
export const restoreBackup = (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No backup file provided" });
    }
    
    const uploadedFile = req.file;
    const includeFiles = parseIncludeFilesFlag(req.body?.includeFiles);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    const fileName = (uploadedFile.originalname || "").toLowerCase();
    const isZip = isZipBackupFile(uploadedFile);

    if (includeFiles) {
      if (!isZip || !fileName.endsWith(".zip")) {
        fs.unlinkSync(uploadedFile.path);
        return res.status(400).json({
          message: "Database + files restore requires a .zip backup file",
        });
      }
    } else if (!fileName.endsWith(".db")) {
      fs.unlinkSync(uploadedFile.path);
      return res.status(400).json({
        message: "Database-only restore requires a .db backup file",
      });
    }

    const safetyBackupPath = path.join(backupsDir, `pre-restore-${timestamp}.db`);

    db.backup(safetyBackupPath)
      .then(() => {
        try {
          if (includeFiles) {
            const { restoredUploads } = restoreFromZipArchive(uploadedFile.path, timestamp);
            fs.unlinkSync(uploadedFile.path);
            return res.json({
              message: restoredUploads
                ? "Database and uploaded files restored successfully"
                : "Database restored successfully (archive had no uploads folder)",
              safetyBackup: safetyBackupPath,
              restoredUploads,
            });
          }

          restoreDatabaseFromFile(uploadedFile.path);
          fs.unlinkSync(uploadedFile.path);
          return res.json({
            message: "Database restored successfully",
            safetyBackup: safetyBackupPath,
          });
        } catch (restoreErr) {
          console.error("Restore error:", restoreErr);
          try {
            rollbackDatabaseFromSafety(safetyBackupPath);
          } catch (rollbackErr) {
            console.error("Database rollback error:", rollbackErr);
            resetDbInstance();
          }
          if (fs.existsSync(uploadedFile.path)) {
            try {
              fs.unlinkSync(uploadedFile.path);
            } catch {
              // ignore cleanup errors
            }
          }
          return res.status(500).json({
            message: restoreErr.message || "Error restoring backup",
          });
        }
      })
      .catch((err) => {
        console.error("Safety backup error:", err);
        if (fs.existsSync(safetyBackupPath)) {
          try {
            fs.unlinkSync(safetyBackupPath);
          } catch (e) {
            // Ignore cleanup errors
          }
        }
        resetDbInstance();
        if (fs.existsSync(uploadedFile.path)) {
          try {
            fs.unlinkSync(uploadedFile.path);
          } catch {
            // ignore
          }
        }
        res.status(500).json({ message: "Error creating safety backup before restore" });
      });
  } catch (error) {
    console.error("Restore error:", error);
    next(error);
  }
};

// Restore from latest safety backup (pre-restore-*.db)
// List safety backups (pre-restore-*.db)
export const listSafetyBackups = (_req, res, next) => {
  try {
    const backups = fs
      .readdirSync(backupsDir)
      .filter((file) => isSafetyBackup(file))
      .map((file) => {
        const fullPath = path.join(backupsDir, file);
        const stats = fs.statSync(fullPath);
        return { file, path: fullPath, modifiedAt: stats.mtime.toISOString(), size: stats.size };
      })
      .sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : -1));
    
    res.json({ backups });
  } catch (error) {
    console.error("List safety backups error:", error);
    next(error);
  }
};

// Restore from safety backup (latest or specified file)
export const restoreSafetyBackup = (req, res, next) => {
  try {
    const { file } = req.body || {};
    let target;

    const backups = fs.readdirSync(backupsDir).filter((name) => isSafetyBackup(name));

    if (backups.length === 0) {
      return res.status(404).json({ message: "No safety backup found" });
    }

    if (file) {
      if (!isSafetyBackup(file)) {
        return res.status(400).json({ message: "Invalid safety backup name" });
      }
      if (!backups.includes(file)) {
        return res.status(404).json({ message: "Specified safety backup not found" });
      }
      target = path.join(backupsDir, file);
    } else {
      // Pick the most recent safety backup
      const sorted = backups
        .map((name) => {
          const fullPath = path.join(backupsDir, name);
          const stats = fs.statSync(fullPath);
          return { name, fullPath, mtime: stats.mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime);
      target = sorted[0].fullPath;
    }
    
    replaceDatabaseFromPath(target);

    res.json({
      message: "Database restored from safety backup",
      safetyBackup: target,
    });
  } catch (error) {
    console.error("Restore safety backup error:", error);
    // Ensure database is open after failure
    resetDbInstance();
    next(error);
  }
};

// Download a safety backup
export const downloadSafetyBackup = (req, res, next) => {
  try {
    const { file } = req.query;
    if (!isSafetyBackup(file)) {
      return res.status(400).json({ message: "Invalid safety backup name" });
    }
    const target = path.join(backupsDir, file);
    if (!fs.existsSync(target)) {
      return res.status(404).json({ message: "Safety backup not found" });
    }
    res.download(target, file);
  } catch (error) {
    console.error("Download safety backup error:", error);
    next(error);
  }
};

// Delete a safety backup
export const deleteSafetyBackup = (req, res, next) => {
  try {
    const { file } = req.body || {};
    if (!isSafetyBackup(file)) {
      return res.status(400).json({ message: "Invalid safety backup name" });
    }
    const target = path.join(backupsDir, file);
    if (!fs.existsSync(target)) {
      return res.status(404).json({ message: "Safety backup not found" });
    }
    fs.unlinkSync(target);
    res.json({ message: "Safety backup deleted", file });
  } catch (error) {
    console.error("Delete safety backup error:", error);
    next(error);
  }
};

// Reset auto-increment IDs for specified tables
export const resetTableIds = (req, res, next) => {
  try {
    const { tables } = req.body; // Array of table names: ['orders', 'expenses', 'internal_transfers']
    
    if (!tables || !Array.isArray(tables) || tables.length === 0) {
      return res.status(400).json({ message: "No tables specified" });
    }
    
    const validTables = [
      "orders",
      "expenses",
      "internal_transfers",
      "customers",
      "accounts",
      "users",
      "tags",
      "currencies",
    ];
    const tablesToReset = tables.filter((t) => validTables.includes(t));
    
    if (tablesToReset.length === 0) {
      return res.status(400).json({ message: "No valid tables specified" });
    }
    
    const results = [];
    
    for (const tableName of tablesToReset) {
      // Check if table is empty
      const count = db.prepare(`SELECT COUNT(*) as count FROM ${tableName}`).get().count;
      
      if (count > 0) {
        results.push({
          table: tableName,
          success: false,
          message: `Table has ${count} rows. Cannot reset ID while table has data.`,
          currentMaxId: db.prepare(`SELECT MAX(id) as maxId FROM ${tableName}`).get().maxId,
        });
      } else {
        // Reset the auto-increment by deleting from sqlite_sequence
        db.prepare("DELETE FROM sqlite_sequence WHERE name = ?").run(tableName);
        
        results.push({
          table: tableName,
          success: true,
          message: "ID counter reset successfully. Next ID will be 1.",
          currentMaxId: 0,
        });
      }
    }
    
    res.json({ results });
  } catch (error) {
    console.error("Reset IDs error:", error);
    next(error);
  }
};

// Get database schema information
export const getDbSchema = (req, res, next) => {
  try {
    // Get all tables
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).all();
    
    const schema = tables.map((table) => {
      const tableName = table.name;
      
      // Get column info for each table
      const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
      
      // Get row count
      const rowCount = db.prepare(`SELECT COUNT(*) as count FROM ${tableName}`).get().count;
      
      return {
        name: tableName,
        rowCount,
        columns: columns.map((col) => ({
          name: col.name,
          type: col.type,
          notNull: col.notnull === 1,
          defaultValue: col.dflt_value,
          primaryKey: col.pk === 1,
        })),
      };
    });
    
    res.json({ schema });
  } catch (error) {
    console.error("Get schema error:", error);
    next(error);
  }
};

// Clear all data and recreate fresh tables (keeps schema + seed data)
export const clearDatabase = (req, res, next) => {
  try {
    const { confirmPhrase } = req.body;

    if (confirmPhrase !== "CLEAR DATABASE") {
      return res.status(400).json({ message: "Invalid confirmation phrase" });
    }

    // Drop all application tables in reverse dependency order
    const tablesToDrop = [
      "_schema_migrations",
      "order_tag_assignments",
      "transfer_tag_assignments",
      "expense_tag_assignments",
      "tags",
      "approval_requests",
      "notifications",
      "user_notification_preferences",
      "order_changes",
      "order_receipts",
      "order_payments",
      "order_profits",
      "order_service_charges",
      "order_beneficiaries",
      "account_transactions",
      "profit_account_multipliers",
      "profit_exchange_rates",
      "profit_calculations",
      "expense_changes",
      "expenses",
      "transfer_changes",
      "internal_transfers",
      "aml_checks",
      "integration_configs",
      "tron_wallet_transactions",
      "tron_wallets",
      "orders",
      "customer_kyc_documents",
      "customer_kyc_profiles",
      "customer_beneficiaries",
      "customers",
      "accounts",
      "roles",
      "users",
      "currencies",
      "settings",
    ];

    db.exec("PRAGMA foreign_keys = OFF;");
    try {
      const dropAll = db.transaction(() => {
        for (const table of tablesToDrop) {
          db.prepare(`DROP TABLE IF EXISTS "${table}"`).run();
        }
      });
      dropAll();
    } finally {
      db.exec("PRAGMA foreign_keys = ON;");
    }

    // Recreate all tables and reseed defaults
    initDatabase();

    res.json({ message: "Database cleared and recreated successfully" });
  } catch (error) {
    console.error("Clear database error:", error);
    next(error);
  }
};

// Execute SQL query (read-only)
export const executeQuery = (req, res, next) => {
  try {
    const { sql } = req.body;
    
    if (!sql || typeof sql !== "string") {
      return res.status(400).json({ message: "No SQL query provided" });
    }
    
    // Validate that query is read-only (starts with SELECT)
    const trimmedSql = sql.trim().toLowerCase();
    if (!trimmedSql.startsWith("select") && !trimmedSql.startsWith("pragma")) {
      return res.status(400).json({ 
        message: "Only SELECT and PRAGMA queries are allowed for security reasons" 
      });
    }
    
    // Execute query with timeout
    try {
      const results = db.prepare(sql).all();
      
      res.json({ 
        success: true,
        rowCount: results.length,
        results 
      });
    } catch (queryError) {
      res.status(400).json({ 
        success: false,
        message: queryError.message 
      });
    }
  } catch (error) {
    console.error("Execute query error:", error);
    next(error);
  }
};

