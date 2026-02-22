import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { createHash, randomBytes } from "crypto";
import { createServer, type Server } from "http";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTH_BASE = "https://auth.openai.com";
const OAUTH_AUTHORIZE_URL = `${AUTH_BASE}/oauth/authorize`;
const OAUTH_TOKEN_URL = `${AUTH_BASE}/oauth/token`;
const CALLBACK_PORT = 1455;
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/auth/callback`;

const AUTH_DIR = join(homedir(), ".chris-assistant");
const TOKEN_FILE = join(AUTH_DIR, "openai-auth.json");

/** Margin in seconds before we consider a token expired */
const EXPIRY_MARGIN = 300; // 5 minutes — refresh early

export interface TokenData {
  access_token: string;
  refresh_token: string;
  expires: number; // unix timestamp (milliseconds)
  accountId?: string; // ChatGPT account ID from JWT
}

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

// ---------------------------------------------------------------------------
// Authorization URL + callback server
// ---------------------------------------------------------------------------

export function buildAuthorizationUrl(challenge: string, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: "openid profile email offline_access",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    codex_cli_simplified_flow: "true",
  });
  return `${OAUTH_AUTHORIZE_URL}?${params}`;
}

/**
 * Start a local HTTP server on CALLBACK_PORT that waits for the OAuth callback.
 * Returns a promise that resolves with the authorization code.
 */
export function waitForAuthCallback(
  expectedState: string,
): { promise: Promise<string>; server: Server } {
  let resolveCode: (code: string) => void;
  let rejectCode: (err: Error) => void;

  const promise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const server = createServer((req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${CALLBACK_PORT}`);
    if (url.pathname !== "/auth/callback") {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><body><h2>Authentication failed</h2><p>You can close this tab.</p></body></html>");
      rejectCode(new Error(`OAuth error: ${error}`));
      return;
    }

    if (!code || state !== expectedState) {
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end("<html><body><h2>Invalid callback</h2><p>Missing code or state mismatch.</p></body></html>");
      rejectCode(new Error("Invalid OAuth callback: missing code or state mismatch"));
      return;
    }

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<html><body><h2>Authenticated!</h2><p>You can close this tab and return to the terminal.</p></body></html>");
    resolveCode(code);
  });

  server.listen(CALLBACK_PORT);
  return { promise, server };
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

export async function exchangeForTokens(
  authCode: string,
  codeVerifier: string,
): Promise<TokenData> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    code: authCode,
    code_verifier: codeVerifier,
    redirect_uri: REDIRECT_URI,
  });

  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  if (!data.access_token || !data.refresh_token) {
    throw new Error("OpenAI returned incomplete token response");
  }

  const accountId = extractAccountId(data.access_token);

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires: Date.now() + (data.expires_in || 3600) * 1000,
    accountId,
  };
}

// ---------------------------------------------------------------------------
// Account ID extraction from JWT
// ---------------------------------------------------------------------------

function extractAccountId(accessToken: string): string | undefined {
  try {
    const parts = accessToken.split(".");
    if (parts.length < 2) return undefined;
    const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf-8"));
    const authClaim = payload["https://api.openai.com/auth"];
    if (authClaim && authClaim.chatgpt_account_id) {
      return authClaim.chatgpt_account_id;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

async function refreshAccessToken(refreshToken: string): Promise<TokenData> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: CLIENT_ID,
    refresh_token: refreshToken,
  });

  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  const accountId = extractAccountId(data.access_token);

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || refreshToken,
    expires: Date.now() + (data.expires_in || 3600) * 1000,
    accountId,
  };
}

// ---------------------------------------------------------------------------
// Token persistence
// ---------------------------------------------------------------------------

export function loadTokens(): TokenData | null {
  if (!existsSync(TOKEN_FILE)) return null;
  try {
    const raw = readFileSync(TOKEN_FILE, "utf-8");
    const data = JSON.parse(raw);
    if (data.access_token && data.refresh_token && data.expires) {
      return data as TokenData;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveTokens(tokens: TokenData): void {
  if (!existsSync(AUTH_DIR)) {
    mkdirSync(AUTH_DIR, { recursive: true });
  }
  writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2) + "\n", {
    mode: 0o600,
  });
}

// ---------------------------------------------------------------------------
// Main accessors
// ---------------------------------------------------------------------------

export async function getValidAccessToken(): Promise<string> {
  const tokens = loadTokens();
  if (!tokens) {
    throw new Error(
      'OpenAI OAuth tokens not found. Run "chris openai login" to authenticate.',
    );
  }

  const now = Date.now();
  if (now < tokens.expires - EXPIRY_MARGIN * 1000) {
    return tokens.access_token;
  }

  // Token expired or expiring soon — try refresh
  try {
    console.log("[openai] Refreshing access token...");
    const refreshed = await refreshAccessToken(tokens.refresh_token);
    saveTokens(refreshed);
    return refreshed.access_token;
  } catch (err: any) {
    throw new Error(
      `OpenAI token refresh failed: ${err.message}. Run "chris openai login" to re-authenticate.`,
    );
  }
}

export function getAccountId(): string | undefined {
  const tokens = loadTokens();
  return tokens?.accountId;
}
