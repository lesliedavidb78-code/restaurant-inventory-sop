const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

async function restoreDatabaseSnapshot(source, destination, Database) {
  if (fs.existsSync(destination)) return { restored: false };
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const staging = destination + '.restore-' + randomUUID();
  let opened;
  try {
    // SQLite's online backup sees committed WAL frames and produces one consistent snapshot.
    opened = new Database(source, { readonly: true, fileMustExist: true });
    await opened.backup(staging);
    opened.close();
    opened = undefined;
    const verified = new Database(staging, { fileMustExist: true });
    try {
      if (verified.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('账本快照完整性检查失败，未启用恢复文件。');
      verified.pragma('wal_checkpoint(TRUNCATE)');
      verified.pragma('journal_mode=DELETE');
    } finally { verified.close(); }
    // A second process must not overwrite a file created during backup.
    if (fs.existsSync(destination)) return { restored: false };
    fs.renameSync(staging, destination);
    return { restored: true };
  } finally {
    if (opened?.open) opened.close();
    for (const file of [staging, staging + '-wal', staging + '-shm', staging + '-journal']) {
      fs.rmSync(file, { force: true });
    }
  }
}

module.exports = { restoreDatabaseSnapshot };
