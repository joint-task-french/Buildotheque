import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { swaggerUI } from '@hono/swagger-ui';
import { openapiDoc } from './openapi';
import { Context } from 'hono';
import { BuildSchema } from './types';
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
  toggleLike,
  searchBuilds,
  getRecentBuilds,
  getTopBuilds,
} from './builds';

type Variables = { user: JWTPayload };

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------------------------------------------------------------------------
// Helpers pour la vérification des domaines
// ---------------------------------------------------------------------------

/**
 * Récupère la liste des domaines autorisés à partir des variables d'environnement.
 */
function getAllowedDomains(env: Env): string[] {
  const domains: string[] = [];

  // Toujours autoriser le domaine du front par défaut
  if (env.FRONTEND_URL) {
    try {
      domains.push(new URL(env.FRONTEND_URL).hostname.toLowerCase());
    } catch {
      console.warn("FRONTEND_URL invalide");
    }
  }

  // Ajouter les domaines supplémentaires configurés
  if (env.ALLOWED_DOMAINS) {
    const extraDomains = env.ALLOWED_DOMAINS.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
    domains.push(...extraDomains);
  }

  // Retourner une liste unique
  return [...new Set(domains)];
}

/**
 * Vérifie si l'URL ou l'origine cible correspond à un des domaines autorisés (gère les wildcards).
 */
function isDomainAllowed(targetUrlOrOrigin: string, allowedDomains: string[]): boolean {
  try {
    const hostname = new URL(targetUrlOrOrigin).hostname.toLowerCase();

    return allowedDomains.some((domain) => {
      // Gestion du wildcard *.domaine.com
      if (domain.startsWith('*.')) {
        const baseDomain = domain.slice(2); // Récupère 'domaine.com'
        // Autorise le domaine de base lui-même ou n'importe quel sous-domaine
        return hostname === baseDomain || hostname.endsWith(`.${baseDomain}`);
      }

      // Correspondance stricte pour les autres
      return hostname === domain;
    });
  } catch {
    return false; // URL malformée
  }
}

// ---------------------------------------------------------------------------
// CORS – Configuration dynamique pour accepter Localhost et la Prod
// ---------------------------------------------------------------------------
app.use('*', async (c, next) => {
  const allowedDomains = getAllowedDomains(c.env);

  let defaultOrigin = '*';
  try {
    if (c.env.FRONTEND_URL) {
      defaultOrigin = new URL(c.env.FRONTEND_URL).origin;
    }
  } catch {}

  return cors({
    origin: (origin) => {
      // Autoriser le développement local
      if (origin && (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1'))) {
        return origin;
      }
      // Vérifier si le domaine de l'origine est autorisé
      if (origin && isDomainAllowed(origin, allowedDomains)) {
        return origin;
      }
      // Fallback sur l'origine du front par défaut
      return defaultOrigin;
    },
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  })(c, next);
});

// Attach user from JWT when present (non-blocking)
app.use('*', authMiddleware);

/**
 * Parse les paramètres communs de recherche de builds.
 */
function parseSearchParams(c: Context) {
  const text = c.req.query('text') ?? undefined;
  const auteurId = c.req.query('auteurId') ?? undefined;
  const tagsParam = c.req.query('tags');
  const tags = tagsParam ? tagsParam.split(',').map((t: string) => t.trim()).filter(Boolean) : undefined;

  const rawLimit = parseInt(c.req.query('limit') ?? '50', 10);
  const rawOffset = parseInt(c.req.query('offset') ?? '0', 10);
  const limit = Number.isNaN(rawLimit) || rawLimit < 1 ? 50 : Math.min(rawLimit, 200);
  const offset = Number.isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset;

  return { text, auteurId, tags, limit, offset };
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/', (c) => c.json({ status: 'ok', name: 'Buildotheque API' }));

// ---------------------------------------------------------------------------
// Auth – Discord OAuth2
// ---------------------------------------------------------------------------

app.get('/auth/discord', (c) => {
  const originalState = c.req.query('state') ?? '';
  const returnUrl = c.req.query('returnUrl'); // URL demandée par le client

  // On encapsule l'état original et l'URL de retour souhaitée dans un JSON encodé en base64
  const stateObj = {
    s: originalState,
    r: returnUrl || ''
  };
  const encodedState = btoa(JSON.stringify(stateObj));

  const params = new URLSearchParams({
    client_id: c.env.DISCORD_CLIENT_ID,
    redirect_uri: c.env.DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify',
    state: encodedState,
  });

  return c.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
});

app.get('/auth/discord/callback', async (c) => {
  const code = c.req.query('code');
  const encodedState = c.req.query('state') ?? '';

  let originalState = '';
  let requestedReturnUrl = '';

  // Décodage de l'état
  try {
    if (encodedState) {
      const decoded = JSON.parse(atob(encodedState));
      if (decoded.s) originalState = decoded.s;
      if (decoded.r) requestedReturnUrl = decoded.r;
    }
  } catch (e) {
    // Rétrocompatibilité
    originalState = encodedState;
  }

  if (!code) {
    return c.json({ error: 'Code OAuth manquant' }, 400);
  }

  try {
    const tokenResponse = await exchangeDiscordCode(code, c.env);
    const discordUser = await fetchDiscordUser(tokenResponse.access_token);
    const jwt = await createJWT(discordUser, c.env.JWT_SECRET);

    // Détermination de l'URL de redirection sécurisée
    let finalRedirectUrlStr = c.env.FRONTEND_URL;

    if (requestedReturnUrl) {
      const allowedDomains = getAllowedDomains(c.env);
      // On redirige vers l'URL demandée uniquement si son domaine est autorisé
      if (isDomainAllowed(requestedReturnUrl, allowedDomains)) {
        finalRedirectUrlStr = requestedReturnUrl;
      } else {
        console.warn("Domaine non autorisé pour le retour OAuth :", requestedReturnUrl);
      }
    }

    const redirectUrl = new URL(finalRedirectUrlStr);
    redirectUrl.searchParams.set('token', jwt);
    if (originalState) redirectUrl.searchParams.set('state', originalState);

    return c.redirect(redirectUrl.toString());
  } catch (err) {
    console.error('Discord callback error:', err);
    return c.json({ error: 'Erreur lors de la connexion avec Discord' }, 500);
  }
});

app.get('/auth/me', requireAuth, (c) => {
  const user = c.get('user');
  return c.json({ id: user.sub, username: user.username, avatar: user.avatar ?? null });
});

// ---------------------------------------------------------------------------
// Swagger UI
// ---------------------------------------------------------------------------

app.get('/swagger', swaggerUI({ url: '/doc' }));

app.get('/doc', (c) => {
  return c.json(openapiDoc);
});

// ---------------------------------------------------------------------------
// Builds – CRUD + search
// ---------------------------------------------------------------------------

app.get('/builds', async (c) => {
  const params = parseSearchParams(c);
  const disableRandom = c.req.query('random') === 'false';

  const { builds, total } = await searchBuilds(
      c.env,
      params.text,
      params.tags,
      params.auteurId,
      params.limit,
      params.offset,
      disableRandom
  );
  return c.json({ builds, total, limit: params.limit, offset: params.offset });
});

// Builds – listes dédiées
app.get('/builds/recent', async (c) => {
  const params = parseSearchParams(c);

  const { builds, total } = await getRecentBuilds(
      c.env,
      params.text,
      params.tags,
      params.auteurId,
      params.limit,
      params.offset
  );
  return c.json({ builds, total, limit: params.limit, offset: params.offset });
});

app.get('/builds/top', async (c) => {
  const params = parseSearchParams(c);

  const { builds, total } = await getTopBuilds(
      c.env,
      params.text,
      params.tags,
      params.auteurId,
      params.limit,
      params.offset
  );
  return c.json({ builds, total, limit: params.limit, offset: params.offset });
});

app.post('/builds', requireAuth, async (c) => {
  const user = c.get('user');

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Corps de requête JSON invalide' }, 400);
  }

  const result = BuildSchema.safeParse(body);
  if (!result.success) {
    return c.json({ error: result.error.issues[0].message }, 400);
  }

  const input = result.data;

  const build = await createBuild(
      {
        nom: input.nom,
        description: input.description,
        auteur: input.auteur,
        tags: input.tags,
        encoded: input.encoded,
      },
      user.sub,
      c.env,
  );

  return c.json(build, 201);
});

app.get('/builds/:id', async (c) => {
  const id = c.req.param('id') ?? '';
  const build = await getBuild(id, c.env);
  if (!build) return c.json({ error: 'Build introuvable' }, 404);
  return c.json(build);
});

app.put('/builds/:id', requireAuth, async (c) => {
  const user = c.get('user');
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

  const result = BuildSchema.partial().safeParse(body);
  if (!result.success) {
    return c.json({ error: result.error.issues[0].message }, 400);
  }

  const input = result.data;

  const updated = await updateBuild(
      id,
      input,
      c.env,
  );

  return c.json(updated);
});

app.delete('/builds/:id', requireAuth, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id') ?? '';

  const existing = await getBuild(id, c.env);
  if (!existing) return c.json({ error: 'Build introuvable' }, 404);
  if (existing.auteurId !== user.sub) {
    return c.json({ error: 'Non autorisé : vous n\'êtes pas le propriétaire de ce build' }, 403);
  }

  await deleteBuild(id, c.env);
  return c.json({ message: 'Build supprimé avec succès' });
});

app.post('/builds/:id/like', requireAuth, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id') ?? '';
  const result = await toggleLike(id, user.sub, c.env);
  if (!result) return c.json({ error: 'Build introuvable' }, 404);
  return c.json(result);
});

app.notFound((c) => c.json({ error: 'Route introuvable' }, 404));

export default app;