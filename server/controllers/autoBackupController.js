import {
  deleteAutoBackupFile,
  getAutoBackupState,
  listAutoBackupFiles,
  resolveAutoBackupFile,
  updateAutoBackupSettings,
} from "../services/autoBackup.js";
import { restoreExistingBackupFile } from "./settingsController.js";

const sendKnownError = (res, error, next) => {
  if (error?.status) {
    res.status(error.status).json({ message: error.message });
    return;
  }
  next(error);
};

export const getAutoBackupSettings = (_req, res, next) => {
  try {
    res.json(getAutoBackupState());
  } catch (error) {
    next(error);
  }
};

export const saveAutoBackupSettings = (req, res, next) => {
  try {
    const settings = updateAutoBackupSettings(req.body || {});
    res.json({ settings, message: "Automatic backup settings saved" });
  } catch (error) {
    sendKnownError(res, error, next);
  }
};

export const listAutoBackups = (_req, res, next) => {
  try {
    res.json({ backups: listAutoBackupFiles() });
  } catch (error) {
    next(error);
  }
};

export const downloadAutoBackup = (req, res, next) => {
  try {
    const resolved = resolveAutoBackupFile(req.query.file);
    if (!resolved) {
      res.status(404).json({ message: "Automatic backup not found" });
      return;
    }
    res.download(resolved.fullPath, resolved.file);
  } catch (error) {
    sendKnownError(res, error, next);
  }
};

export const deleteAutoBackup = (req, res, next) => {
  try {
    const file = deleteAutoBackupFile(req.body?.file);
    res.json({ message: "Automatic backup deleted", file });
  } catch (error) {
    sendKnownError(res, error, next);
  }
};

export const restoreAutoBackup = async (req, res, next) => {
  try {
    const resolved = resolveAutoBackupFile(req.body?.file);
    if (!resolved) {
      res.status(404).json({ message: "Automatic backup not found" });
      return;
    }
    const result = await restoreExistingBackupFile(resolved.fullPath);
    res.json(result);
  } catch (error) {
    console.error("Restore automatic backup error:", error);
    sendKnownError(res, error, next);
  }
};
