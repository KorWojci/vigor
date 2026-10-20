import { redirect } from "next/navigation";
import { VigorMark } from "@/components/VitruvianFigure";
import { hasUser } from "@/lib/auth/users";
import { db } from "@/lib/server/context";
import { SetupForm } from "./SetupForm";

export const metadata = { title: "Set up" };

export default function SetupPage() {
  if (hasUser(db())) redirect("/login");
  return (
    <main className="auth-page">
      <div className="card auth-card">
        <div className="emblem"><VigorMark size={100} /></div>
        <h1 className="serif" style={{ textAlign: "center" }}>Welcome to Vigor</h1>
        <p className="muted small">
          Create the account that protects your data. Vigor is single-user: this account can see every record stored on this server.
        </p>
        <SetupForm />
      </div>
    </main>
  );
}
