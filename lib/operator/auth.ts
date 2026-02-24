import { NextRequest } from "next/server";

/**
 * Optional API guard for sensitive operator endpoints.
 * If OPERATOR_API_TOKEN is not set, auth is disabled.
 */
export function requireOperatorAuth(req: NextRequest): Response | null {
  const expected = process.env.OPERATOR_API_TOKEN?.trim();
  if (!expected) return null;

  const fromHeader =
    req.headers.get("x-operator-token") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    "";

  if (fromHeader !== expected) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  return null;
}
