import fs from "node:fs";
import path from "node:path";
import { commitImport, parseWorkbook } from "../lib/importer";
import { seedDatabase } from "../lib/db/seed";

async function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const filePath = args.find((arg) => !arg.startsWith("--"));
  if (!filePath) {
    console.error("用法：pnpm import:xlsx -- <xlsx路径> [--commit]");
    process.exit(1);
  }
  await seedDatabase();
  const preview = parseWorkbook(fs.readFileSync(filePath), path.basename(filePath));
  console.log(JSON.stringify({ duplicate: preview.duplicate, sheets: preview.sheets, summary: preview.summary, warnings: preview.warnings, errors: preview.errors }, null, 2));
  if (args.includes("--commit")) console.log(commitImport(preview, "命令行导入"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
