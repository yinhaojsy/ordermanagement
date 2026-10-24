export const BACKUP_BUSY_MESSAGE = "A backup or restore is already in progress";

let held = false;

export function tryAcquireBackupLock() {
  if (held) return false;
  held = true;
  return true;
}

export function releaseBackupLock() {
  held = false;
}
