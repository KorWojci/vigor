"use client";

import { useActionState } from "react";
import { setupAction } from "../auth-actions";

export function SetupForm() {
  const [state, action, pending] = useActionState(setupAction, undefined);
  return (
    <form action={action} className="form">
      <label className="field">
        <span>Username</span>
        <input name="username" autoComplete="username" defaultValue="admin" required />
      </label>
      <label className="field">
        <span>Password <span className="hint">(at least 10 characters — a passphrase works well)</span></span>
        <input name="password" type="password" autoComplete="new-password" minLength={10} required />
      </label>
      <label className="field">
        <span>Confirm password</span>
        <input name="confirm" type="password" autoComplete="new-password" minLength={10} required />
      </label>
      {state?.error && <div className="notice error">{state.error}</div>}
      <button className="btn primary" disabled={pending}>
        {pending ? "Creating…" : "Create account"}
      </button>
    </form>
  );
}
