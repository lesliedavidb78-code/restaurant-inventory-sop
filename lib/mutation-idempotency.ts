import { createHash } from "node:crypto";
import { sqlite } from "@/lib/db";

export function idempotentMutation<T>(storeId: string, requestId: string | undefined, operation: string, input: unknown, run: () => T): T {
  return sqlite.transaction(() => {
    if (!requestId) return run();
    if (!/^[a-zA-Z0-9-]{8,100}$/.test(requestId)) throw new Error("请求标识无效。");
    const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const old = sqlite.prepare("SELECT input_hash inputHash,result_json result FROM mutation_requests WHERE store_id=? AND request_id=? AND operation=?").get(storeId, requestId, operation) as { inputHash: string; result: string } | undefined;
    if (old) { if (old.inputHash !== hash) throw new Error("同一请求标识不能提交不同内容，请刷新重试。"); return JSON.parse(old.result) as T; }
    const result = run();
    sqlite.prepare("INSERT INTO mutation_requests (store_id,request_id,operation,input_hash,result_json,created_at) VALUES (?,?,?,?,?,?)").run(storeId, requestId, operation, hash, JSON.stringify(result), new Date().toISOString());
    return result;
  })();
}
