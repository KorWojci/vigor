"use client";

import { useActionState } from "react";
import { loginAction } from "../auth-actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, undefined);
  return (
    <form action={action} className="form">
      <label className="field">
        <span>Username</span>
        <input name="username" autoComplete="username" required autoFocus />
      </label>
      <label className="field">
        <span>Password</span>
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      {state?.error && <div className="notice error">{state.error}</div>}
      <button className="btn primary" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
