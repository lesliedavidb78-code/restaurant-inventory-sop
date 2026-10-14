import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { sqlite, ensureSchema } from "@/lib/db";

export const SESSION_COOKIE = "restaurant_session";
export const STORE_COOKIE = "restaurant_store";
export type AppRole = "owner" | "manager" | "finance" | "storekeeper";
export type SessionContext = { userId: string; username: string; displayName: string; storeId: string; role: AppRole; stores: { id: string; name: string; code: string; role: AppRole }[] };
export type StoreMember = { id: string; username: string; displayName: string; role: AppRole; createdAt: string };

function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function makePasswordHash(password: string) { return passwordHash(password); }
export function verifyPassword(password: string, encoded: string) {
  const [salt, hash] = encoded.split(":");
  if (!salt || !hash) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function createSession(userId: string) {
  ensureSchema();
  const id = randomUUID(); const now = new Date(); const expires = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  sqlite.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now.toISOString());
  sqlite.prepare("INSERT INTO sessions (id,user_id,expires_at,created_at) VALUES (?,?,?,?)").run(id, userId, expires.toISOString(), now.toISOString());
  return { id, expires };
}
export function getSession(sessionId?: string, preferredStoreId?: string): SessionContext | null {
  if (!sessionId) return null;
  ensureSchema();
  const user = sqlite.prepare("SELECT u.id,u.username,u.display_name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires_at>? ").get(sessionId, new Date().toISOString()) as { id: string; username: string; display_name: string } | undefined;
  if (!user) return null;
  const stores = sqlite.prepare("SELECT s.id,s.name,s.code,r.role FROM user_store_roles r JOIN stores s ON s.id=r.store_id WHERE r.user_id=? ORDER BY s.created_at").all(user.id) as { id: string; name: string; code: string; role: AppRole }[];
  const selected = stores.find((store) => store.id === preferredStoreId) ?? stores[0];
  return selected ? { userId: user.id, username: user.username, displayName: user.display_name, storeId: selected.id, role: selected.role, stores } : null;
}
export function createUserWithStore(input: { username: string; displayName: string; password: string; storeName: string; storeCode: string }) {
  ensureSchema(); const now = new Date().toISOString(); const userId = randomUUID(); const storeId = randomUUID();
  const code = input.storeCode.trim().toUpperCase();
  sqlite.transaction(() => {
    sqlite.prepare("INSERT INTO users (id,username,display_name,password_hash,created_at) VALUES (?,?,?,?,?)").run(userId, input.username.trim().toLowerCase(), input.displayName.trim(), passwordHash(input.password), now);
    sqlite.prepare("INSERT INTO stores (id,name,code,created_at,created_by) VALUES (?,?,?,?,?)").run(storeId, input.storeName.trim(), code, now, input.displayName.trim());
    sqlite.prepare("INSERT INTO warehouses (id,store_id,booth_id,name,type,created_at,created_by) VALUES (?,?,?,?,?,?,?)").run(randomUUID(), storeId, null, "门店总仓", "main", now, input.displayName.trim());
    sqlite.prepare("INSERT INTO user_store_roles (user_id,store_id,role,created_at) VALUES (?,?,?,?)").run(userId, storeId, "owner", now);
  })();
  return { userId, storeId };
}
export function addStoreForOwner(userId: string, input: { name: string; code: string; actor: string }) {
  ensureSchema(); const now = new Date().toISOString(); const storeId = randomUUID();
  sqlite.transaction(() => {
    sqlite.prepare("INSERT INTO stores (id,name,code,created_at,created_by) VALUES (?,?,?,?,?)").run(storeId, input.name.trim(), input.code.trim().toUpperCase(), now, input.actor);
    sqlite.prepare("INSERT INTO warehouses (id,store_id,booth_id,name,type,created_at,created_by) VALUES (?,?,?,?,?,?,?)").run(randomUUID(), storeId, null, "门店总仓", "main", now, input.actor);
    sqlite.prepare("INSERT INTO user_store_roles (user_id,store_id,role,created_at) VALUES (?,?,?,?)").run(userId, storeId, "owner", now);
  })(); return storeId;
}
/** Creates an account that can access exactly one existing store. Only the API layer
 * decides whether the caller is the store owner; this function enforces the role and
 * keeps the password hash private from all returned data. */
export function createStoreMember(storeId: string, input: { username: string; displayName: string; password: string; role: AppRole }): StoreMember {
  if (!(["manager", "finance", "storekeeper"] as const).includes(input.role as "manager" | "finance" | "storekeeper")) {
    throw new Error("只能创建店长、财务或库管账号");
  }
  const username = input.username.trim().toLowerCase();
  const displayName = input.displayName.trim();
  if (username.length < 3 || username.length > 40) throw new Error("账号长度应为 3 至 40 个字符");
  if (!/^[a-z0-9_.-]+$/i.test(username)) throw new Error("账号只能包含字母、数字、点、下划线或短横线");
  if (!displayName) throw new Error("姓名不能为空");
  if (input.password.length < 8) throw new Error("密码至少 8 位");

  ensureSchema();
  const store = sqlite.prepare("SELECT id FROM stores WHERE id=?").get(storeId) as { id: string } | undefined;
  if (!store) throw new Error("门店不存在");

  const now = new Date().toISOString();
  const id = randomUUID();
  sqlite.transaction(() => {
    sqlite.prepare("INSERT INTO users (id,username,display_name,password_hash,created_at) VALUES (?,?,?,?,?)")
      .run(id, username, displayName, passwordHash(input.password), now);
    sqlite.prepare("INSERT INTO user_store_roles (user_id,store_id,role,created_at) VALUES (?,?,?,?)")
      .run(id, storeId, input.role, now);
  })();
  return { id, username, displayName, role: input.role, createdAt: now };
}

/** Returns safe, display-only member records. Password hashes must never leave auth.ts. */
export function listStoreMembers(storeId: string): StoreMember[] {
  ensureSchema();
  return sqlite.prepare(`
    SELECT u.id, u.username, u.display_name AS displayName, r.role, u.created_at AS createdAt
    FROM user_store_roles r
    JOIN users u ON u.id = r.user_id
    WHERE r.store_id = ?
    ORDER BY CASE r.role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'finance' THEN 2 ELSE 3 END, u.created_at, u.username
  `).all(storeId) as StoreMember[];
}
