import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { SESSION_COOKIE } from "@/lib/auth";

/**
 * Nothing is reachable without a session except the login page itself.
 * Verified here rather than per-page, so a new screen cannot be added without
 * auth by accident.
 */
export async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  let signedIn = false;

  if (token && process.env.SESSION_SECRET) {
    try {
      await jwtVerify(token, new TextEncoder().encode(process.env.SESSION_SECRET));
      signedIn = true;
    } catch {
      signedIn = false;
    }
  }

  const onLogin = request.nextUrl.pathname === "/login";
  if (!signedIn && !onLogin) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (signedIn && onLogin) {
    return NextResponse.redirect(new URL("/settings", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Everything except Next internals and static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
