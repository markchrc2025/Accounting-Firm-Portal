// bell.ts - PB2: the header bell asks for the unread count on every page of the signed-in app.
// Specs that route every /api/v1 call and fail on any call they did not mock call this first, so
// the bell is answered (nothing unread) and is not counted as an unmocked call.
import type { Route } from "@playwright/test";

/** Answer the bell's unread-count call with "none unread". Returns true when it did. */
export async function answerBell(route: Route): Promise<boolean> {
  const req = route.request();
  if (
    req.method() === "GET" &&
    new URL(req.url()).pathname === "/api/v1/notifications/unread-count"
  ) {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ count: 0 }),
    });
    return true;
  }
  return false;
}
