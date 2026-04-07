import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, JWTPayload } from './types';
import {
  authMiddleware,
  requireAuth,
  createJWT,
  exchangeDiscordCode,
  fetchDiscordUser,
} from './auth';
import {
  createBuild,
  getBuild,
  updateBuild,
  deleteBuild,
  likeBuild,
  searchBuilds,
} from './builds';

type Variables = { user?: JWTPayload };

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------------------------------------------------------------------------
// CORS – allow requests from the configured frontend URL
// ---------------------------------------------------------------------------
app.use('*', async (c, next) => {
  const frontendUrl = c.env.FRONTEND_URL ?? '';
  return cors({
    origin: frontendUrl || '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  })(c, next);
});

// Attach user from JWT when present (non-blocking)
app.use('*', authMiddleware);

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/', (c) => c.json({ status: 'ok', name: 'Buildotheque API' }));

// ---------------------------------------------------------------------------
// Auth – Discord OAuth2
// ---------------------------------------------------------------------------

/**
 * GET /auth/discord
 * Redirect the user to Discord's OAuth2 authorization page.
 * Query param `state` is optional and will be forwarded back after login.
 */
app.get('/auth/discord', (c) => {
  const state = c.req.query('state') ?? '';
  const params = new URLSearchParams({
    client_id: c.env.DISCORD_CLIENT_ID,
    redirect_uri: c.env.DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify',
    state,
  });
  return c.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
});

/**
 * GET /auth/discord/callback
 * Handle the OAuth2 callback from Discord, create a JWT, and redirect to the frontend.
 */
app.get('/auth/discord/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state') ?? '';

  if (!code) {
    return c.json({ error: 'Code OAuth manquant' }, 400);
  }

  try {
    const tokenResponse = await exchangeDiscordCode(code, c.env);
    const discordUser = await fetchDiscordUser(tokenResponse.access_token);
    const jwt = await createJWT(discordUser, c.env.JWT_SECRET);

    // Redirect to frontend with the token as a query param.
    const redirectUrl = new URL(c.env.FRONTEND_URL);
    redirectUrl.searchParams.set('token', jwt);
    if (state) redirectUrl.searchParams.set('state', state);

    return c.redirect(redirectUrl.toString());
  } catch (err) {
    console.error('Discord callback error:', err);
    return c.json({ error: 'Erreur lors de la connexion avec Discord' }, 500);
  }
});

/**
 * GET /auth/me
 * Return the currently authenticated user's profile.
 */
app.get('/auth/me', requireAuth, (c) => {
  const user = c.get('user') as JWTPayload;
  return c.json({ id: user.sub, username: user.username, avatar: user.avatar ?? null });
});

// ---------------------------------------------------------------------------
// Builds – CRUD + search
// ---------------------------------------------------------------------------

/**
 * GET /builds
 * Search and list builds.
 *
 * Query params:
 *   - `text`   : search text matched against nom, description, auteur
 *   - `tags`   : comma-separated list of tag IDs (ALL must be present on the build)
 *   - `limit`  : max number of results (default: 50, max: 200)
 *   - `offset` : number of results to skip (default: 0)
 */
app.get('/builds', async (c) => {
  const text = c.req.query('text') ?? undefined;
  const tagsParam = c.req.query('tags');
  const tags = tagsParam ? tagsParam.split(',').map((t) => t.trim()).filter(Boolean) : undefined;

  const rawLimit = parseInt(c.req.query('limit') ?? '50', 10);
  const rawOffset = parseInt(c.req.query('offset') ?? '0', 10);
  const limit = Number.isNaN(rawLimit) || rawLimit < 1 ? 50 : Math.min(rawLimit, 200);
  const offset = Number.isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset;

  const { builds, total } = await searchBuilds(c.env, text, tags, limit, offset);
  return c.json({ builds, total, limit, offset });
});

/**
 * POST /builds
 * Create a new build. Requires authentication.
 *
 * Body: { nom, description, tags?, encoded }
 */
app.post('/builds', requireAuth, async (c) => {
  const user = c.get('user') as JWTPayload;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Corps de requête JSON invalide' }, 400);
  }

  if (
    typeof body !== 'object' ||
    body === null ||
    !('nom' in body) ||
    !('description' in body) ||
    !('encoded' in body)
  ) {
    return c.json({ error: 'Champs requis manquants : nom, description, encoded' }, 400);
  }

  const input = body as { nom: unknown; description: unknown; tags?: unknown; encoded: unknown };

  if (typeof input.nom !== 'string' || input.nom.trim() === '') {
    return c.json({ error: 'Le champ "nom" doit être une chaîne non vide' }, 400);
  }
  if (typeof input.description !== 'string') {
    return c.json({ error: 'Le champ "description" doit être une chaîne' }, 400);
  }
  if (typeof input.encoded !== 'string' || input.encoded.trim() === '') {
    return c.json({ error: 'Le champ "encoded" doit être une chaîne non vide' }, 400);
  }
  if (input.tags !== undefined && !Array.isArray(input.tags)) {
    return c.json({ error: 'Le champ "tags" doit être un tableau' }, 400);
  }

  const build = await createBuild(
    {
      nom: input.nom,
      description: input.description,
      tags: Array.isArray(input.tags) ? (input.tags as string[]) : undefined,
      encoded: input.encoded,
    },
    user.sub,
    user.username,
    c.env,
  );

  return c.json(build, 201);
});

/**
 * GET /builds/:id
 * Retrieve a single build by ID.
 */
app.get('/builds/:id', async (c) => {
  const id = c.req.param('id') ?? '';
  const build = await getBuild(id, c.env);
  if (!build) return c.json({ error: 'Build introuvable' }, 404);
  return c.json(build);
});

/**
 * PUT /builds/:id
 * Update a build. Requires authentication and ownership.
 *
 * Body: { nom?, description?, tags?, encoded? }
 */
app.put('/builds/:id', requireAuth, async (c) => {
  const user = c.get('user') as JWTPayload;
  const id = c.req.param('id') ?? '';

  const existing = await getBuild(id, c.env);
  if (!existing) return c.json({ error: 'Build introuvable' }, 404);
  if (existing.auteurId !== user.sub) {
    return c.json({ error: 'Non autorisé : vous n\'êtes pas le propriétaire de ce build' }, 403);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Corps de requête JSON invalide' }, 400);
  }

  const input = body as { nom?: unknown; description?: unknown; tags?: unknown; encoded?: unknown };

  if (input.nom !== undefined && (typeof input.nom !== 'string' || input.nom.trim() === '')) {
    return c.json({ error: 'Le champ "nom" doit être une chaîne non vide' }, 400);
  }
  if (input.description !== undefined && typeof input.description !== 'string') {
    return c.json({ error: 'Le champ "description" doit être une chaîne' }, 400);
  }
  if (input.encoded !== undefined && (typeof input.encoded !== 'string' || input.encoded.trim() === '')) {
    return c.json({ error: 'Le champ "encoded" doit être une chaîne non vide' }, 400);
  }
  if (input.tags !== undefined && !Array.isArray(input.tags)) {
    return c.json({ error: 'Le champ "tags" doit être un tableau' }, 400);
  }

  const updated = await updateBuild(
    id,
    {
      nom: typeof input.nom === 'string' ? input.nom : undefined,
      description: typeof input.description === 'string' ? input.description : undefined,
      tags: Array.isArray(input.tags) ? (input.tags as string[]) : undefined,
      encoded: typeof input.encoded === 'string' ? input.encoded : undefined,
    },
    c.env,
  );

  return c.json(updated);
});

/**
 * DELETE /builds/:id
 * Delete a build. Requires authentication and ownership.
 */
app.delete('/builds/:id', requireAuth, async (c) => {
  const user = c.get('user') as JWTPayload;
  const id = c.req.param('id') ?? '';

  const existing = await getBuild(id, c.env);
  if (!existing) return c.json({ error: 'Build introuvable' }, 404);
  if (existing.auteurId !== user.sub) {
    return c.json({ error: 'Non autorisé : vous n\'êtes pas le propriétaire de ce build' }, 403);
  }

  await deleteBuild(id, c.env);
  return c.json({ message: 'Build supprimé avec succès' });
});

/**
 * POST /builds/:id/like
 * Increment the like counter for a build. Requires authentication.
 */
app.post('/builds/:id/like', requireAuth, async (c) => {
  const id = c.req.param('id') ?? '';
  const updated = await likeBuild(id, c.env);
  if (!updated) return c.json({ error: 'Build introuvable' }, 404);
  return c.json(updated);
});

// ---------------------------------------------------------------------------
// 404 fallback
// ---------------------------------------------------------------------------
app.notFound((c) => c.json({ error: 'Route introuvable' }, 404));

export default app;
