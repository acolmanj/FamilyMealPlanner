import { createHash, timingSafeEqual } from "node:crypto";

// The family passcode lives only in server settings (FAMILY_PASSCODE), never in
// the repo or the browser. Spaces and capital letters are ignored so phones
// that add a capital letter at the start still work.
function normalise(value: string) {
  return value.trim().toLowerCase();
}

function digest(value: string) {
  return createHash("sha256").update(normalise(value)).digest();
}

export function passcodeSettings() {
  const passcode = process.env.FAMILY_PASSCODE ?? "";
  const email = process.env.FAMILY_EMAIL ?? "";
  const password = process.env.FAMILY_PASSWORD ?? "";
  return { ready: Boolean(passcode && email && password), passcode, email, password };
}

export function passcodeMatches(attempt: string, passcode: string) {
  if (!passcode) return false;
  // Compare fixed-length hashes so the check takes the same time for any guess.
  return timingSafeEqual(digest(attempt), digest(passcode));
}
