import { createSign } from "node:crypto";

// Reads the family's Google Sheet as a service account. The account only has view access
// to the shared sheet. No Google SDK: a signed JWT is swapped for an access token.

export type ServiceAccount = { client_email: string; private_key: string };
type Fetch = typeof fetch;

// Read the sheet's cells, and read the file's name and last-changed time from Drive.
const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.metadata.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE = "https://www.googleapis.com/drive/v3/files";
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";

// The key JSON from the Google Cloud console, or null when it is missing or not a key.
export function parseServiceAccount(json: string | undefined): ServiceAccount | null {
  if (!json) return null;
  const read = (s: string) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  // A key pasted into a settings box can arrive with real line breaks inside the JSON.
  const k = read(json) ?? read(json.replace(/\r?\n/g, "\\n"));
  if (typeof k?.client_email !== "string" || typeof k?.private_key !== "string") return null;
  // Line breaks in the key itself can arrive as the two characters "\n".
  return { client_email: k.client_email, private_key: k.private_key.replace(/\\n/g, "\n") };
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");

export function signJwt(key: ServiceAccount, now = Math.floor(Date.now() / 1000)): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: key.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  const signature = createSign("RSA-SHA256").update(`${header}.${claims}`).sign(key.private_key);
  return `${header}.${claims}.${b64url(signature)}`;
}

async function fail(what: string, res: Response): Promise<never> {
  const body = (await res.text().catch(() => "")).slice(0, 300);
  throw new Error(`${what} failed (${res.status}): ${body}`);
}

export async function getAccessToken(key: ServiceAccount, f: Fetch = fetch): Promise<string> {
  const res = await f(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: signJwt(key) }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) await fail("Google sign-in", res);
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("Google sign-in gave no access token");
  return data.access_token;
}

export type DriveFile = { name: string; modifiedTime: string };

export async function getFileInfo(token: string, fileId: string, f: Fetch = fetch): Promise<DriveFile> {
  const url = `${DRIVE}/${encodeURIComponent(fileId)}?fields=modifiedTime,name&supportsAllDrives=true`;
  const res = await f(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!res.ok) await fail("Reading the file details from Google Drive", res);
  return (await res.json()) as DriveFile;
}

// The cells of one range as the sheet shows them, row by row. Google leaves out blank
// rows at the end and blank cells at the end of a row.
export async function getSheetValues(token: string, sheetId: string, range: string, f: Fetch = fetch): Promise<string[][]> {
  const url = `${SHEETS}/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`;
  const res = await f(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) await fail("Reading the sheet from Google Sheets", res);
  const data = (await res.json()) as { values?: unknown[][] };
  return (data.values ?? []).map((row) => (Array.isArray(row) ? row.map((v) => (v == null ? "" : String(v))) : []));
}
