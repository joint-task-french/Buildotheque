import { SignJWT, jwtVerify } from 'jose';
import type { Context } from 'hono';
import type { Env, JWTPayload, DiscordTokenResponse, DiscordUser } from './types';

const DISCORD_API = 'https://discord.com/api/v10';
const TOKEN_EXPIRY = '7d';

/** * Hache une chaîne de caractères (l'ID Discord) en SHA-512.
 */
async function hashDiscordId(id: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(id);
  const hashBuffer = await crypto.subtle.digest('SHA-512', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Encode the JWT secret as a CryptoKey. */
async function getJwtKey(secret: string): Promise<CryptoKey> {
  const encoded = new TextEncoder().encode(secret);
  return crypto.subtle.importKey('raw', encoded, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

/** Create a signed JWT for a Discord user. */
export async function createJWT(user: DiscordUser, secret: string): Promise<string> {
  const key = await getJwtKey(secret);

  const hashedId = await hashDiscordId(user.id);

  const avatarUrl = user.avatar
      ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}`
      : undefined;

  const payload: JWTPayload = {
    sub: hashedId,
    username: user.global_name ?? user.username,
    avatar: avatarUrl,
  };

  return new SignJWT({ ...payload })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(TOKEN_EXPIRY)
      .sign(key);
}

/** Verify a JWT and return its payload, or null if invalid. */
export async function verifyJWT(token: string, secret: string): Promise<JWTPayload | null> {
  try {
    const key = await getJwtKey(secret);
    const { payload } = await jwtVerify(token, key);
    return payload as unknown as JWTPayload;
  } catch {
    return null;
  }
}

/** Extract the Bearer token from the Authorization header. */
function extractBearerToken(authHeader: string | null | undefined): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

/** Middleware: attach authenticated user to context variables if a valid JWT is present. */
export async function authMiddleware(
    c: Context<{ Bindings: Env; Variables: { user?: JWTPayload } }>,
    next: () => Promise<void>,
): Promise<void> {
  const token = extractBearerToken(c.req.header('Authorization'));
  if (token) {
    const payload = await verifyJWT(token, c.env.JWT_SECRET);
    if (payload) {
      c.set('user', payload);
    }
  }
  await next();
}

/** Middleware: require authentication, return 401 if not authenticated. */
export async function requireAuth(
    c: Context<{ Bindings: Env; Variables: { user?: JWTPayload } }>,
    next: () => Promise<void>,
): Promise<Response | void> {
  const token = extractBearerToken(c.req.header('Authorization'));
  if (!token) {
    return c.json({ error: 'Authentification requise' }, 401);
  }
  const payload = await verifyJWT(token, c.env.JWT_SECRET);
  if (!payload) {
    return c.json({ error: 'Token invalide ou expiré' }, 401);
  }
  c.set('user', payload);
  await next();
}

/** Exchange an OAuth2 code for a Discord access token. */
export async function exchangeDiscordCode(
    code: string,
    env: Env,
): Promise<DiscordTokenResponse> {
  const body = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    client_secret: env.DISCORD_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: env.DISCORD_REDIRECT_URI,
  });

  const response = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Discord token exchange failed: ${error}`);
  }

  return response.json() as Promise<DiscordTokenResponse>;
}

/** Fetch the authenticated Discord user using an access token. */
export async function fetchDiscordUser(accessToken: string): Promise<DiscordUser> {
  const response = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch Discord user: ${error}`);
  }

  return response.json() as Promise<DiscordUser>;
}