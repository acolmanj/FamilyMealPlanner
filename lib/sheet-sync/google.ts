import { createSign } from "node:crypto";

// Reads one file from Google Drive as a service account. The account only has view access
// to the shared file. No Google SDK: a signed JWT is swapped for an access token.

export type ServiceAccount = { client_email: string; private_key: string };
type Fetch = typeof fetch;

const SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE = "https://www.googleapis.com/drive/v3/files";
const GOOGLE_SHEET = "application/vnd.google-apps.spreadsheet";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

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

export type DriveFile = { name: string; modifiedTime: string; mimeType?: string };

export async function getFileInfo(token: string, fileId: string, f: Fetch = fetch): Promise<DriveFile> {
  const url = `${DRIVE}/${encodeURIComponent(fileId)}?fields=modifiedTime,name,mimeType&supportsAllDrives=true`;
  const res = await f(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!res.ok) await fail("Reading the file details from Google Drive", res);
  return (await res.json()) as DriveFile;
}

// The file as .xlsx. A file that was turned into a Google Sheet is exported as .xlsx instead.
export async function downloadXlsx(token: string, fileId: string, mimeType: string | undefined, f: Fetch = fetch): Promise<Buffer> {
  const id = encodeURIComponent(fileId);
  const url =
    mimeType === GOOGLE_SHEET
      ? `${DRIVE}/${id}/export?mimeType=${encodeURIComponent(XLSX)}`
      : `${DRIVE}/${id}?alt=media&supportsAllDrives=true`;
  const res = await f(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) await fail("Downloading the file from Google Drive", res);
  return Buffer.from(await res.arrayBuffer());
}
