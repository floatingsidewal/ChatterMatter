/**
 * Invite tokens for P2P session access control.
 *
 * Tokens are 22-character base64url strings (128-bit entropy).
 * They can be embedded in URLs like: ws://hostname:4117?token=Yw9kL3mZ_pQ8vNx1bHcTfA
 */

import { randomBytes } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InviteToken {
  /** The 22-character base64url token string. */
  token: string;
  /** ISO timestamp when the token was created. */
  createdAt: string;
  /** ISO timestamp when the token expires, or null for no expiration. */
  expiresAt: string | null;
  /** Maximum number of uses, or null for unlimited. */
  maxUses: number | null;
  /** Number of times this token has been used. */
  useCount: number;
  /** ISO timestamp when the token was revoked, or null if not revoked. */
  revokedAt: string | null;
  /** Optional human-readable label (e.g., "Team invite", "Guest access"). */
  label?: string;
  /** Default role assigned to users who join with this token. */
  defaultRole: "reviewer" | "viewer";
}

export interface TokenValidationResult {
  valid: boolean;
  reason?: string;
}

export interface CreateTokenOptions {
  /** Time until expiration in milliseconds. Default: 24 hours. */
  expiresIn?: number;
  /** Maximum number of uses. Default: null (unlimited). */
  maxUses?: number | null;
  /** Human-readable label. */
  label?: string;
  /** Default role for users joining with this token. Default: "reviewer". */
  defaultRole?: "reviewer" | "viewer";
}

// ---------------------------------------------------------------------------
// Token Generation
// ---------------------------------------------------------------------------

/** Default expiration: 24 hours in milliseconds. */
const DEFAULT_EXPIRES_IN = 24 * 60 * 60 * 1000;

/**
 * Generate a cryptographically random invite token.
 * Returns a 22-character base64url string (128-bit entropy).
 */
export function generateInviteToken(): string {
  return randomBytes(16).toString("base64url"); // 22 chars
}

/**
 * Create a full InviteToken object with the given options.
 */
export function createInviteToken(options?: CreateTokenOptions): InviteToken {
  const now = new Date();
  const expiresIn = options?.expiresIn;

  // Calculate expiration:
  // - undefined: use default (24h)
  // - 0: no expiration
  // - negative: expired (for testing)
  // - positive: add to now
  let expiresAt: string | null = null;
  if (expiresIn === undefined) {
    expiresAt = new Date(now.getTime() + DEFAULT_EXPIRES_IN).toISOString();
  } else if (expiresIn !== 0) {
    expiresAt = new Date(now.getTime() + expiresIn).toISOString();
  }

  return {
    token: generateInviteToken(),
    createdAt: now.toISOString(),
    expiresAt,
    maxUses: options?.maxUses ?? null,
    useCount: 0,
    revokedAt: null,
    label: options?.label,
    defaultRole: options?.defaultRole ?? "reviewer",
  };
}

// ---------------------------------------------------------------------------
// Token Validation
// ---------------------------------------------------------------------------

/**
 * Validate an invite token.
 * Returns { valid: true } if the token can be used, or { valid: false, reason } if not.
 */
export function validateToken(token: InviteToken): TokenValidationResult {
  if (token.revokedAt) {
    return { valid: false, reason: "Invite link has been revoked" };
  }

  if (token.expiresAt && new Date(token.expiresAt) < new Date()) {
    return { valid: false, reason: "Invite link has expired" };
  }

  if (token.maxUses !== null && token.useCount >= token.maxUses) {
    return { valid: false, reason: "Invite link has reached its usage limit" };
  }

  return { valid: true };
}

/**
 * Extract the token parameter from a WebSocket URL.
 * Returns the token string or null if not present.
 */
export function extractTokenFromUrl(url: string): string | null {
  try {
    // WebSocket URLs need to be converted to http(s) for URL parsing
    const httpUrl = url.replace(/^ws(s)?:/, "http$1:");
    const parsed = new URL(httpUrl);
    return parsed.searchParams.get("token");
  } catch {
    return null;
  }
}

/**
 * Build an invite URL from a base WebSocket URL and token.
 */
export function buildInviteUrl(baseUrl: string, token: string): string {
  try {
    // Parse and rebuild to ensure clean URL
    const httpUrl = baseUrl.replace(/^ws(s)?:/, "http$1:");
    const parsed = new URL(httpUrl);
    parsed.searchParams.set("token", token);
    // Convert back to ws(s)
    const wsUrl = parsed.toString().replace(/^http(s)?:/, "ws$1:");
    return wsUrl;
  } catch {
    // Fallback: simple string concatenation
    const separator = baseUrl.includes("?") ? "&" : "?";
    return `${baseUrl}${separator}token=${token}`;
  }
}
