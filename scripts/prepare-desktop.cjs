const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");
const runtime = path.join(root, ".desktop-runtime");
const { sourceHash, requiredRoutes } = require('./release-integrity.cjs');
const version = JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
if (JSON.parse(fs.readFileSync(path.join(standalone,'package.json'),'utf8')).version !== version) throw new Error('Next standalone 版本过旧，请先重新构建。');
const routes = JSON.parse(fs.readFileSync(path.join(standalone,'.next','server','app-paths-manifest.json'),'utf8'));
for (const route of requiredRoutes) if (!routes[route]) throw new Error('Next 构建缺少关键接口：'+route);
fs.writeFileSync(path.join(standalone,'release-manifest.json'), JSON.stringify({ version, sourceHash: sourceHash(root), buildId: fs.readFileSync(path.join(standalone,'.next','BUILD_ID'),'utf8').trim(), preparedAt: new Date().toISOString(), requiredRoutes }, null, 2));

fs.cpSync(path.join(root, "public"), path.join(standalone, "public"), { recursive: true, force: true });
fs.mkdirSync(path.join(standalone, ".next"), { recursive: true });
fs.cpSync(path.join(root, ".next", "static"), path.join(standalone, ".next", "static"), { recursive: true, force: true });

// Next standalone produced by pnpm contains Windows junctions to this
// development folder. They work here but break after the folder is copied to
// another computer. Materialise the complete production dependency closure in
// a flat node_modules tree instead of copying those junctions.
fs.rmSync(runtime, { recursive: true, force: true });
const runtimeModules = path.join(runtime, "node_modules");
fs.mkdirSync(runtimeModules, { recursive: true });

function packageEntries(modulesDir) {
  if (!fs.existsSync(modulesDir)) return [];
  const entries = [];
  for (const entry of fs.readdirSync(modulesDir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const entryPath = path.join(modulesDir, entry.name);
    if (entry.name.startsWith("@")) {
      for (const scoped of fs.readdirSync(entryPath, { withFileTypes: true })) {
        if (scoped.isDirectory() || scoped.isSymbolicLink()) {
          entries.push({ name: `${entry.name}/${scoped.name}`, path: path.join(entryPath, scoped.name) });
        }
      }
    } else if (entry.isDirectory() || entry.isSymbolicLink()) {
      entries.push({ name: entry.name, path: entryPath });
    }
  }
  return entries;
}

const queue = packageEntries(path.join(standalone, "node_modules"));
// better-sqlite3 被 Next 标记为服务端外部依赖，不一定会出现在 standalone
// 的初始软链接中。桌面版的本地账本必须显式携带它及 node-addon-api，
// 否则在其他电脑上可能出现“本地服务启动超时”。
const externalRuntimePackages = ["better-sqlite3", "node-addon-api"];
for (const packageName of externalRuntimePackages) {
  const packagePath = path.join(root, "node_modules", packageName);
  if (fs.existsSync(packagePath)) queue.push({ name: packageName, path: packagePath });
}
const copied = new Set();
while (queue.length > 0) {
  const current = queue.shift();
  let source;
  try {
    source = fs.realpathSync(current.path);
  } catch {
    continue;
  }
  const packageName = JSON.parse(fs.readFileSync(path.join(source, "package.json"), "utf8")).name;
  if (!packageName || copied.has(packageName)) continue;
  copied.add(packageName);
  const target = path.join(runtimeModules, ...packageName.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, {
    recursive: true,
    force: true,
    dereference: true,
    filter: (entry) => path.basename(entry) !== "node_modules",
  });
  // pnpm stores a package's dependency links alongside the package in its
  // virtual-store node_modules directory (rather than inside package/node_modules).
  queue.push(...packageEntries(path.dirname(source)));
}

console.log(`Desktop runtime prepared with ${copied.size} portable dependencies.`);
