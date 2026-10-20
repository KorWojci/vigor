import { NextResponse, type NextRequest } from "next/server";

/**
 * Cheap edge-side gate: requests without a session cookie are sent to /login.
 * The session itself is verified server-side (src/lib/server/context.ts) on every page/action,
 * because the SQLite database is not available in the edge runtime.
 */
const PUBLIC = ["/login", "/setup", "/api/", "/_next/", "/favicon", "/icon"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (!req.cookies.get("vigor_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

// API routes are excluded: they authenticate themselves, and running middleware on them would
// make Next.js buffer (and cap at 10 MB) large import bodies.
export const config = { matcher: ["/((?!api/|_next/static|_next/image|favicon.ico).*)"] };
