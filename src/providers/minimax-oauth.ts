import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { randomBytes, createHash, randomUUID } from "crypto";
import { homedir } from "os";

const CLIENT_ID = "78257093-7e40-4613-99e0-527b14b39113";
const SCOPE = "group_id profile model.completion";
const GRANT_TYPE = "urn:ietf:params:oauth:grant-type:user_code";
const CODE_URL = "https://api.minimax.io/oauth/code";
const TOKEN_URL = "https://api.minimax.io/oauth/token";

const AUTH_DIR = join(homedir(), ".chris-assistant");
const TOKEN_FILE = join(AUTH_DIR, "minimax-auth.json");

/** Margin in seconds before we consider a token expired */
const EXPIRY_MARGIN = 60;

export interface TokenData {
  access_token: string;
  refresh_token: string;
  expires: number; // unix timestamp (milliseconds)
}

interface DeviceCodeResponse {
  user_code: string;
  verification_uri: string;
  expired_in: number; // unix timestamp (milliseconds)
  interval?: number; // poll interval (milliseconds)
  state: string;
}

// --- PKCE helpers ---

export function generatePKCE() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("base64url");
  return { verifier, challenge, state };
}

// --- Device code flow ---

export async function requestDeviceCode(
  challenge: string,
  state: string,
): Promise<DeviceCodeResponse> {
  const body = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });

  const res = await fetch(CODE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "x-request-id": randomUUID(),
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to request device code (${res.status}): ${text}`);
  }

  const payload = await res.json();
  if (!payload.user_code || !payload.verification_uri) {
    throw new Error("MiniMax OAuth returned incomplete response (missing user_code or verification_uri)");
  }
  if (payload.state !== state) {
    throw new Error("MiniMax OAuth state mismatch");
  }

  return payload;
}

export async function pollForToken(
  userCode: string,
  verifier: string,
  interval: number | undefined,
  expiredIn: number,
): Promise<TokenData> {
  // expired_in is a unix timestamp in milliseconds
  const deadline = expiredIn;
  let pollIntervalMs = interval || 2000;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));

    const body = new URLSearchParams({
      grant_type: GRANT_TYPE,
      client_id: CLIENT_ID,
      user_code: userCode,
      code_verifier: verifier,
    });

    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
    });

    const text = await res.text();
    let payload: any;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }

    if (!res.ok) {
      const msg = payload?.base_resp?.status_msg || text || "unknown error";
      return { status: "error", message: msg } as any;
    }

    if (!payload) {
      throw new Error("MiniMax OAuth: empty response from token endpoint");
    }

    if (payload.status === "success" && payload.access_token && payload.refresh_token && payload.expired_in) {
      return {
        access_token: payload.access_token,
        refresh_token: payload.refresh_token,
        expires: payload.expired_in, // unix timestamp (ms)
      };
    }

    if (payload.status === "error") {
      throw new Error("MiniMax OAuth failed. Please try again later.");
    }

    // status === "pending" or anything else — keep polling
    pollIntervalMs = Math.min(pollIntervalMs * 1.5, 10000);
  }

  throw new Error("Device code expired — please try again");
}

// --- Token persistence ---

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

export function getValidAccessToken(): string {
  const tokens = loadTokens();
  if (!tokens) {
    throw new Error(
      'MiniMax OAuth tokens not found. Run "chris minimax login" to authenticate.',
    );
  }

  const now = Date.now();
  if (now >= tokens.expires - EXPIRY_MARGIN * 1000) {
    throw new Error(
      'MiniMax OAuth token has expired. Run "chris minimax login" to re-authenticate.',
    );
  }

  return tokens.access_token;
}
