// bell.ts - PB2: the signed-in app asks for the notification unread count on every page (the
// header bell), and the profile page asks for the email setting. Specs that route every /api/v1
// call and fail on any call they did not mock call this first, so these two are answered (nothing
// unread, email off) and are not counted as unmocked calls.
import type { Route } from "@playwright/test";

const ANSWERS: Record<string, unknown> = {
  "/api/v1/notifications/unread-count": { count: 0 },
  "/api/v1/notifications/preferences": { emailEnabled: false },
};

/** Answer the bell's count call or the profile's email setting call. Returns true when it did. */
export async function answerBell(route: Route): Promise<boolean> {
  const req = route.request();
  if (req.method() !== "GET") return false;
  const answer = ANSWERS[new URL(req.url()).pathname];
  if (answer === undefined) return false;
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(answer),
  });
  return true;
}
