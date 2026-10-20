import { redirect } from "next/navigation";
import { VigorMark } from "@/components/VitruvianFigure";
import { hasUser } from "@/lib/auth/users";
import { currentUser, db } from "@/lib/server/context";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (!hasUser(db())) redirect("/setup");
  if (await currentUser()) redirect("/");
  return (
    <main className="auth-page">
      <div className="card auth-card">
        <div className="emblem"><VigorMark size={120} /></div>
        <h1 className="serif" style={{ textAlign: "center", letterSpacing: "0.2em" }}>VIGOR</h1>
        <p className="muted small" style={{ textAlign: "center" }}>Your private health and fitness record.</p>
        <LoginForm />
      </div>
    </main>
  );
}
