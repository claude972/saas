import { NextResponse } from "next/server";

// The real auth guard is client-side (token lives in localStorage, not in a
// cookie). This middleware only exists to keep the matcher in place and to let
// /login and static assets through untouched. It never blocks navigation.
export function middleware() {
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Run on everything except Next internals and common static assets.
    "/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};
