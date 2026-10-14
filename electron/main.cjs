const { app, BrowserWindow, dialog } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { restoreDatabaseSnapshot } = require("./database-snapshot.cjs");

// 固定用户数据目录，避免产品显示名称或安装目录变化后生成一套隔离的空白账本。
const appDataRoot = app.getPath("appData");
const stableUserData = path.join(appDataRoot, "restaurant-inventory-sop");
app.setPath("userData", stableUserData);

let server;
let logFile;

function findLegacyDatabase(databaseFile) {
  // 公开审查版绝不接管私有门店版账本。
  return undefined;
}

function getEdition() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "edition.json"), "utf8"));
  } catch {
    return { mode: "blank" };
  }
}

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    fs.appendFileSync(logFile, line, "utf8");
  } catch {}
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function waitForServer(url) {
  // 老旧电脑在首次加载 SQLite、迁移账本或被杀毒软件扫描时，15 秒不足以启动 Next 服务。
  // 延长到 60 秒，并在服务进程已经退出时立刻给出更明确的失败原因。
  const maxAttempts = 240;
  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    if (server && server.exitCode !== null) {
      throw new Error(`本地服务启动失败（服务进程已退出，退出码：${server.exitCode}）。请查看启动日志。`);
    }
    if (i > 0 && i % 40 === 0) log(`本地服务仍在启动，已等待 ${Math.round(i / 4)} 秒。`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("本地服务启动超时（已等待 60 秒），请查看启动日志。");
}

async function createWindow() {
  const edition = getEdition();
  const userData = app.getPath("userData");
  const dataDir = path.join(userData, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const databaseFile = path.join(dataDir, "restaurant.db");
  const bundledDatabase = path.join(process.resourcesPath, "seed-data", "restaurant.db");
  const appRoot = app.isPackaged
    ? path.join(process.resourcesPath, "app")
    : path.join(process.cwd(), ".next", "standalone");
  const Database = require(path.join(appRoot, "node_modules", "better-sqlite3"));
  logFile = path.join(userData, "启动日志.txt");
  if (!fs.existsSync(databaseFile)) {
    const legacyDatabase = findLegacyDatabase(databaseFile);
    if (legacyDatabase) {
      await restoreDatabaseSnapshot(legacyDatabase, databaseFile, Database);
      log(`已从旧用户数据目录恢复门店账本：${legacyDatabase}`);
    }
  }
  if (app.isPackaged && edition.mode === "template" && !fs.existsSync(databaseFile) && fs.existsSync(bundledDatabase)) {
    await restoreDatabaseSnapshot(bundledDatabase, databaseFile, Database);
  }
  if (fs.existsSync(databaseFile)) {
    const version = require("../package.json").version;
    const backupFile = path.join(userData, "backups", `upgrade-${version}.db`);
    const snapshot = await restoreDatabaseSnapshot(databaseFile, backupFile, Database);
    if (snapshot.restored) log(`升级前一致账本备份已保存：${backupFile}`);
  }
  log(`应用启动；数据目录：${dataDir}`);

  const port = await freePort();
  const serverFile = path.join(appRoot, "server.js");
  log(`启动服务：${serverFile}，端口：${port}`);

  server = spawn(process.execPath, [serverFile], {
    cwd: appRoot,
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      RESTAURANT_DATA_DIR: dataDir,
      RESTAURANT_SEED_MODE: edition.mode === "blank" ? "blank" : "template",
    },
  });
  log(`服务进程已启动：pid=${server.pid}`);
  server.stdout.on("data", (data) => log(`服务输出：${data.toString().trim()}`));
  server.stderr.on("data", (data) => log(`服务错误：${data.toString().trim()}`));
  server.on("error", (error) => {
    log(`服务进程错误：${error.stack || error.message}`);
  });
  server.on("exit", (code, signal) => log(`服务进程退出：code=${code} signal=${signal}`));

  const url = `http://127.0.0.1:${port}`;
  await waitForServer(url);
  log(`服务就绪：${url}`);
  const window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1060,
    minHeight: 680,
    title: "门店经营进销存管理系统",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true },
  });
  await window.loadURL(url);
}

// Fixed shared data directory must have one owning desktop instance.
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
else app.whenReady().then(createWindow).catch((error) => {
  log(`应用启动失败：${error.stack || error.message}`);
  dialog.showErrorBox("启动失败", `${error.message}\n\n请打开“启动日志.txt”后将内容发给技术人员。`);
  app.quit();
});
app.on("second-instance", () => {
  const window = BrowserWindow.getAllWindows()[0];
  if (window) { if (window.isMinimized()) window.restore(); window.focus(); }
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  if (server) server.kill();
});
