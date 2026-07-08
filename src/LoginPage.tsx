import { type FormEvent, useState } from "react";
import { login } from "./api";

export function LoginPage({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(password);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1 className="login-title">女娲 · 人格聊天</h1>
        <p className="login-sub">请输入站点口令以继续使用</p>
        <input
          className="login-input"
          type="password"
          placeholder="站点口令"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          disabled={busy}
        />
        {error && <div className="login-error">{error}</div>}
        <button className="login-button" type="submit" disabled={busy}>
          {busy ? "校验中…" : "进入"}
        </button>
      </form>
    </div>
  );
}
