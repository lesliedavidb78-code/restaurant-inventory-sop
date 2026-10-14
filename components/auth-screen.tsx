"use client";
import { useState } from "react";

export function AuthScreen() {
  const [mode, setMode] = useState<"login" | "register">("register"); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(form: FormData) {
    setBusy(true); setNotice("");
    const body = Object.fromEntries(form.entries()); const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
    const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const result = await response.json(); setBusy(false);
    if (!response.ok) return setNotice(result.error ?? "操作失败，请检查后重试"); window.location.reload();
  }
  return <main className="auth-page"><section className="auth-card"><div className="auth-brand"><span>示例餐厅</span><h1>门店经营进销存管理系统</h1><p>首次使用请注册。注册完成后会自动创建您的门店、总仓和老板权限。</p></div><div className="auth-tabs"><button className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>新建账号并开始使用</button><button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>已有账号登录</button></div><form action={submit} className="auth-form"><label>账号<input name="username" required placeholder="如：demo.owner" autoComplete="username" /></label><label>密码<input name="password" required type="password" minLength={8} placeholder="至少 8 位" autoComplete={mode === "login" ? "current-password" : "new-password"} /></label>{mode === "register" && <><label>您的姓名<input name="displayName" required placeholder="如：张经理" /></label><label>门店名称<input name="storeName" required placeholder="如：示例门店" /></label><label>门店编码<input name="storeCode" required placeholder="如：DEMO-001（仅英文、数字、-、_）" /></label></>}<button className="primary-action" disabled={busy}>{busy ? "处理中…" : mode === "register" ? "注册并进入系统" : "登录"}</button>{notice && <p className="form-notice">{notice}</p>}</form><p className="auth-tip">数据保存在当前电脑的本地数据库。后续部署到服务器后，注册链接即可供多人使用。</p></section></main>;
}
