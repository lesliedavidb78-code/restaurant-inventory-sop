import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("桌面端本地服务启动策略", () => {
  it("低配置电脑最多等待 60 秒，并记录提前退出原因", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "electron", "main.cjs"), "utf8");
    expect(source).toContain("const maxAttempts = 240");
    expect(source).toContain("setTimeout(resolve, 250)");
    expect(source).toContain("server.exitCode !== null");
    expect(source).toContain("已等待 60 秒");
    expect(source).toContain("服务进程已启动：pid=");
  });
});
