import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { restoreDatabaseSnapshot } = require('../electron/database-snapshot.cjs') as {
  restoreDatabaseSnapshot: (source: string, target: string, driver: typeof Database) => Promise<{ restored: boolean }>;
};

describe('桌面账本一致快照恢复', () => {
  it('旧进程尚有 WAL 时也恢复已经提交的记录，源账本不变', async () => {
    const dir = path.join(process.cwd(), '.review-temp', 'snapshot-' + randomUUID());
    fs.mkdirSync(dir, { recursive: true });
    const sourcePath = path.join(dir, 'old.db');
    const targetPath = path.join(dir, 'new.db');
    const source = new Database(sourcePath);
    source.pragma('journal_mode=WAL');
    source.pragma('wal_autocheckpoint=0');
    source.exec('CREATE TABLE inventory(id TEXT PRIMARY KEY, quantity REAL)');
    source.pragma('wal_checkpoint(TRUNCATE)');
    source.prepare('INSERT INTO inventory VALUES (?,?)').run('committed-purchase', 10);
    try {
      await restoreDatabaseSnapshot(sourcePath, targetPath, Database);
      const target = new Database(targetPath);
      try { expect(target.prepare('SELECT quantity FROM inventory WHERE id=?').get('committed-purchase')).toEqual({ quantity: 10 }); }
      finally { target.close(); }
      expect(source.prepare('SELECT quantity FROM inventory WHERE id=?').get('committed-purchase')).toEqual({ quantity: 10 });
    } finally { source.close(); }
  });
  it('已有目标账本不被恢复操作覆盖', async () => {
    const dir = path.join(process.cwd(), '.review-temp', 'snapshot-existing-' + randomUUID());
    fs.mkdirSync(dir, { recursive: true });
    const targetPath = path.join(dir, 'existing.db');
    const target = new Database(targetPath);
    target.exec('CREATE TABLE inventory(quantity REAL); INSERT INTO inventory VALUES (27)');
    target.close();
    expect(await restoreDatabaseSnapshot(path.join(dir, 'missing-source.db'), targetPath, Database)).toEqual({ restored: false });
    const retained = new Database(targetPath);
    try { expect(retained.prepare('SELECT quantity FROM inventory').get()).toEqual({ quantity: 27 }); }
    finally { retained.close(); }
  });
  it('损坏源文件失败时不会留下可启用的目标账本', async () => {
    const dir = path.join(process.cwd(), '.review-temp', 'snapshot-corrupt-' + randomUUID());
    fs.mkdirSync(dir, { recursive: true });
    const sourcePath = path.join(dir, 'corrupt.db');
    const targetPath = path.join(dir, 'not-created.db');
    fs.writeFileSync(sourcePath, 'invalid sqlite fixture');
    await expect(restoreDatabaseSnapshot(sourcePath, targetPath, Database)).rejects.toThrow();
    expect(fs.existsSync(targetPath)).toBe(false);
    expect(fs.readFileSync(sourcePath, 'utf8')).toBe('invalid sqlite fixture');
  });
});
