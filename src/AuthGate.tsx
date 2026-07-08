import { type ReactNode, useEffect, useState } from "react";
import { getAuthStatus, logout } from "./api";
import { LoginPage } from "./LoginPage";

type AuthState = "loading" | "in" | "out";

export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>("loading");

  useEffect(() => {
    let active = true;
    void getAuthStatus()
      .then((res) => {
        if (active) setState(res.authenticated ? "in" : "out");
      })
      .catch(() => {
        if (active) setState("out");
      });
    return () => {
      active = false;
    };
  }, []);

  function handleLogin() {
    setState("in");
  }

  function handleLogout() {
    void logout().finally(() => setState("out"));
  }

  if (state === "loading") {
    return <div className="auth-loading">正在校验登录态…</div>;
  }

  if (state === "out") {
    return <LoginPage onSuccess={handleLogin} />;
  }

  return (
    <>
      {children}
      <button className="logout-fab" onClick={handleLogout} title="退出登录">
        退出
      </button>
    </>
  );
}
