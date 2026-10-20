"use client";

import { useActionState, useState } from "react";
import { createTokenAction, rotateTokenAction, type TokenState } from "@/app/(app)/settings/actions";

function Reveal({ state }: { state: TokenState | undefined }) {
  const [copied, setCopied] = useState(false);
  if (state?.error) return <div className="notice error">{state.error}</div>;
  if (!state?.token) return null;
  return (
    <div className="notice ok" style={{ marginTop: 10 }}>
      <p>
        <strong>Token for “{state.name}”</strong> — copy it now. It is stored only as a hash and will never be shown again.
      </p>
      <div className="row">
        <code style={{ wordBreak: "break-all", padding: "6px 8px", flex: 1 }}>{state.token}</code>
        <button
          type="button"
          className="btn small"
          onClick={() => {
            navigator.clipboard?.writeText(state.token!).then(() => setCopied(true));
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export function CreateTokenForm() {
  const [state, action, pending] = useActionState(createTokenAction, undefined);
  return (
    <div>
      <form action={action} className="row">
        <input name="name" placeholder="Device name, e.g. My iPhone" maxLength={60} style={{ flex: 1, minWidth: 180 }} />
        <button className="btn primary" disabled={pending}>{pending ? "Creating…" : "Create ingestion token"}</button>
      </form>
      <Reveal state={state} />
    </div>
  );
}

export function RotateTokenButton({ id }: { id: number }) {
  const [state, action, pending] = useActionState(rotateTokenAction, undefined);
  return (
    <div>
      <form action={action}>
        <input type="hidden" name="id" value={id} />
        <button className="btn small" disabled={pending}>Rotate</button>
      </form>
      <Reveal state={state} />
    </div>
  );
}
