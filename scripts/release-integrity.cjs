const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const requiredRoutes = ['/api/stock-counts/route', '/api/stock-counts/import/preview/route', '/api/stock-counts/import/commit/route', '/api/stock-counts/template/route', '/api/purchasing/route', '/api/inventory-reports/route'];
function sourceHash(root) {
  const hash=createHash('sha256'); const files=['package.json','next.config.ts','proxy.ts'];
  function walk(dir) { for(const entry of fs.readdirSync(path.join(root,dir),{withFileTypes:true})) { const rel=path.join(dir,entry.name); if(entry.isDirectory()) walk(rel); else if(/\.(ts|tsx|js|cjs|json|css|nsi|nsh)$/.test(entry.name)) files.push(rel); } }
  for(const dir of ['app','components','lib','electron','scripts','build']) walk(dir);
  for(const file of files.sort()) { hash.update(file.replaceAll('\\','/')); hash.update(fs.readFileSync(path.join(root,file))); }
  return hash.digest('hex');
}
function verifyApp(app, version, expectedHash) {
  const pkg=JSON.parse(fs.readFileSync(path.join(app,'package.json'),'utf8'));
  const manifest=JSON.parse(fs.readFileSync(path.join(app,'release-manifest.json'),'utf8'));
  if(pkg.version!==version || manifest.version!==version || manifest.sourceHash!==expectedHash) throw new Error('发布载荷版本或源码指纹不一致，禁止生成补丁。');
  const routes=JSON.parse(fs.readFileSync(path.join(app,'.next','server','app-paths-manifest.json'),'utf8'));
  for(const route of requiredRoutes) if(!routes[route] || !fs.existsSync(path.join(app,'.next','server',routes[route]))) throw new Error('发布缺少关键接口：'+route);
  if(fs.readFileSync(path.join(app,'.next','BUILD_ID'),'utf8').trim()!==manifest.buildId) throw new Error('发布 BUILD_ID 不一致。');
  return manifest;
}
module.exports={sourceHash,verifyApp,requiredRoutes};
