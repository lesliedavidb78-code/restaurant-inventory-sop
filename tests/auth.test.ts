import { afterEach, describe, expect, it } from "vitest";
import { createStoreMember, createUserWithStore, listStoreMembers, verifyPassword } from "@/lib/auth";
import { ensureSchema, sqlite } from "@/lib/db";

const createdUsernames: string[] = [];
const createdStoreIds: string[] = [];

function unique(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

afterEach(() => {
  ensureSchema();
  for (const username of createdUsernames.splice(0)) {
    const user = sqlite.prepare("SELECT id FROM users WHERE username=?").get(username) as { id: string } | undefined;
    if (user) {
      sqlite.prepare("DELETE FROM sessions WHERE user_id=?").run(user.id);
      sqlite.prepare("DELETE FROM user_store_roles WHERE user_id=?").run(user.id);
      sqlite.prepare("DELETE FROM users WHERE id=?").run(user.id);
    }
  }
  for (const storeId of createdStoreIds.splice(0)) {
    sqlite.prepare("DELETE FROM user_store_roles WHERE store_id=?").run(storeId);
    sqlite.prepare("DELETE FROM warehouses WHERE store_id=?").run(storeId);
    sqlite.prepare("DELETE FROM stores WHERE id=?").run(storeId);
  }
});

describe("门店成员管理", () => {
  it("老板可创建财务账号，密码保存为哈希且列表不暴露密码", () => {
    const ownerUsername = unique("owner");
    createdUsernames.push(ownerUsername);
    const owner = createUserWithStore({
      username: ownerUsername,
      displayName: "测试老板",
      password: "owner-password",
      storeName: "成员测试店",
      storeCode: unique("team-store"),
    });
    createdStoreIds.push(owner.storeId);

    const financeUsername = unique("finance");
    createdUsernames.push(financeUsername);
    const member = createStoreMember(owner.storeId, {
      username: financeUsername,
      displayName: "测试财务",
      password: "finance-password",
      role: "finance",
    });

    expect(member).toMatchObject({ username: financeUsername, displayName: "测试财务", role: "finance" });
    const stored = sqlite.prepare("SELECT password_hash FROM users WHERE id=?").get(member.id) as { password_hash: string };
    expect(stored.password_hash).not.toBe("finance-password");
    expect(verifyPassword("finance-password", stored.password_hash)).toBe(true);

    expect(listStoreMembers(owner.storeId)).toContainEqual({
      id: member.id,
      username: financeUsername,
      displayName: "测试财务",
      role: "finance",
      createdAt: expect.any(String),
    });
  });

  it("拒绝把成员创建为老板角色", () => {
    expect(() => createStoreMember("any-store", {
      username: unique("bad"), displayName: "无效角色", password: "password-123", role: "owner",
    })).toThrow("只能创建店长、财务或库管账号");
  });
});
