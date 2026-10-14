import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("覆盖补丁兼容规则", () => {
  it("自动读取旧安装记录，找不到时停止静默创建隔离目录", () => {
    const source = fs.readFileSync(path.join(root, "build", "overlay-patch.nsi"), "utf8");
    expect(source).toContain("RequestExecutionLevel admin");
    expect(source).toContain("Function DetectExistingInstall");
    expect(source).toContain('ReadRegStr $0 ${ROOT} "${UNINSTALL_KEY}" "DisplayIcon"');
    expect(source).toContain("nsDialogs::SelectFolderDialog");
    expect(source).toContain("为避免产生隔离数据，本次更新已停止");
  });

  it("公开版使用独立固定目录，不接管私有门店账本", () => {
    const source = fs.readFileSync(path.join(root, "electron", "main.cjs"), "utf8");
    expect(source).toContain('path.join(appDataRoot, "restaurant-inventory-sop")');
    expect(source).not.toContain("const candidateDirectories");
    expect(source).toContain("return undefined;");
    expect(source).toContain('app.setPath("userData", stableUserData)');
    expect(source).toContain("findLegacyDatabase");
  });
});
