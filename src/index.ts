import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { swaggerUI } from '@hono/swagger-ui';
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

type Variables = { user?: JWTPayload };

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
  const user = c.get('user') as JWTPayload;
  return c.json({ id: user.sub, username: user.username, avatar: user.avatar ?? null });
});

// ---------------------------------------------------------------------------
// Swagger UI
// ---------------------------------------------------------------------------

app.get('/swagger', swaggerUI({ url: '/doc' }));

app.get('/doc', (c) => {
  return c.json({
    openapi: '3.0.0',
    info: {
      title: 'Buildotheque API',
      version: '1.0.0',
      description: 'API pour gérer les builds avec authentification Discord.',
    },
    servers: [
      {
        url: '{protocol}://{host}',
        variables: {
          protocol: { default: 'https' },
          host: { default: 'api.buildotheque.com' },
        },
      },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        Build: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            nom: { type: 'string' },
            description: { type: 'string' },
            auteur: { type: 'string' },
            auteurId: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
            encoded: { type: 'string' },
            likes: { type: 'integer' },
            timestamp: { type: 'integer' },
          },
        },
        User: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            username: { type: 'string' },
            avatar: { type: 'string', nullable: true },
          },
        },
      },
    },
    paths: {
      '/': {
        get: {
          summary: 'Vérifier la santé de l\'API',
          responses: {
            200: {
              description: 'OK',
              content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string' }, name: { type: 'string' } } } } },
            },
          },
        },
      },
      '/auth/discord': {
        get: {
          summary: 'Redirection vers Discord OAuth2',
          parameters: [
            { name: 'state', in: 'query', schema: { type: 'string' } },
            { name: 'returnUrl', in: 'query', schema: { type: 'string' }, description: 'URL de redirection personnalisée après connexion' }
          ],
          responses: { 302: { description: 'Redirection vers Discord' } },
        },
      },
      '/auth/me': {
        get: {
          summary: 'Récupérer l\'utilisateur connecté',
          security: [{ BearerAuth: [] }],
          responses: {
            200: { description: 'Succès', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } },
            401: { description: 'Non authentifié' },
          },
        },
      },
      '/builds': {
        get: {
          summary: 'Rechercher des builds',
          parameters: [
            { name: 'text', in: 'query', schema: { type: 'string' } },
            { name: 'auteurId', in: 'query', schema: { type: 'string' } },
            { name: 'tags', in: 'query', schema: { type: 'string' }, description: 'Tags séparés par des virgules' },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
            { name: 'random', in: 'query', schema: { type: 'boolean', default: true } },
          ],
          responses: {
            200: {
              description: 'Liste de builds',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      builds: { type: 'array', items: { $ref: '#/components/schemas/Build' } },
                      total: { type: 'integer' },
                      limit: { type: 'integer' },
                      offset: { type: 'integer' },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          summary: 'Créer un nouveau build',
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['nom', 'description', 'encoded'],
                  properties: {
                    nom: { type: 'string', maxLength: 25 },
                    description: { type: 'string', maxLength: 250 },
                    auteur: { type: 'string', maxLength: 25 },
                    tags: { type: 'array', items: { type: 'string', maxLength: 25 }, maxItems: 5 },
                    encoded: { type: 'string', maxLength: 8000 },
                  },
                },
              },
            },
          },
          responses: {
            201: { description: 'Créé', content: { 'application/json': { schema: { $ref: '#/components/schemas/Build' } } } },
            400: { description: 'Requête invalide' },
            401: { description: 'Non authentifié' },
          },
        },
      },
      '/builds/{id}': {
        get: {
          summary: 'Récupérer un build par ID',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: { description: 'Succès', content: { 'application/json': { schema: { $ref: '#/components/schemas/Build' } } } },
            404: { description: 'Non trouvé' },
          },
        },
        put: {
          summary: 'Modifier un build',
          security: [{ BearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    nom: { type: 'string', maxLength: 25 },
                    description: { type: 'string', maxLength: 250 },
                    auteur: { type: 'string', maxLength: 25 },
                    tags: { type: 'array', items: { type: 'string', maxLength: 25 }, maxItems: 5 },
                    encoded: { type: 'string', maxLength: 8000 },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Mis à jour', content: { 'application/json': { schema: { $ref: '#/components/schemas/Build' } } } },
            400: { description: 'Requête invalide' },
            401: { description: 'Non authentifié' },
            403: { description: 'Interdit' },
            404: { description: 'Non trouvé' },
          },
        },
        delete: {
          summary: 'Supprimer un build',
          security: [{ BearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: { description: 'Supprimé' },
            401: { description: 'Non authentifié' },
            403: { description: 'Interdit' },
            404: { description: 'Non trouvé' },
          },
        },
      },
      '/builds/{id}/like': {
        post: {
          summary: 'Liker/Unliker un build',
          security: [{ BearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: {
              description: 'Succès',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { likes: { type: 'integer' }, liked: { type: 'boolean' } },
                  },
                },
              },
            },
            401: { description: 'Non authentifié' },
            404: { description: 'Non trouvé' },
          },
        },
      },
      '/builds/recent': {
        get: {
          summary: 'Récupérer les builds récents',
          parameters: [
            { name: 'text', in: 'query', schema: { type: 'string' } },
            { name: 'auteurId', in: 'query', schema: { type: 'string' } },
            { name: 'tags', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
          ],
          responses: { 200: { description: 'Succès', content: { 'application/json': { schema: { type: 'object', properties: { builds: { type: 'array', items: { $ref: '#/components/schemas/Build' } }, total: { type: 'integer' }, limit: { type: 'integer' }, offset: { type: 'integer' } } } } } } },
        },
      },
      '/builds/top': {
        get: {
          summary: 'Récupérer les tops builds',
          parameters: [
            { name: 'text', in: 'query', schema: { type: 'string' } },
            { name: 'auteurId', in: 'query', schema: { type: 'string' } },
            { name: 'tags', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
          ],
          responses: { 200: { description: 'Succès', content: { 'application/json': { schema: { type: 'object', properties: { builds: { type: 'array', items: { $ref: '#/components/schemas/Build' } }, total: { type: 'integer' }, limit: { type: 'integer' }, offset: { type: 'integer' } } } } } } },
        },
      },
    },
  });
});

// ---------------------------------------------------------------------------
// Builds – CRUD + search
// ---------------------------------------------------------------------------

app.get('/builds', async (c) => {
  const text = c.req.query('text') ?? undefined;
  const auteurId = c.req.query('auteurId') ?? undefined;
  const tagsParam = c.req.query('tags');
  const tags = tagsParam ? tagsParam.split(',').map((t) => t.trim()).filter(Boolean) : undefined;

  const rawLimit = parseInt(c.req.query('limit') ?? '50', 10);
  const rawOffset = parseInt(c.req.query('offset') ?? '0', 10);
  const limit = Number.isNaN(rawLimit) || rawLimit < 1 ? 50 : Math.min(rawLimit, 200);
  const offset = Number.isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset;
  const disableRandom = c.req.query('random') === 'false';

  const { builds, total } = await searchBuilds(c.env, text, tags, auteurId, limit, offset, disableRandom);
  return c.json({ builds, total, limit, offset });
});

// Builds – listes dédiées
app.get('/builds/recent', async (c) => {
  const text = c.req.query('text') ?? undefined;
  const auteurId = c.req.query('auteurId') ?? undefined;
  const tagsParam = c.req.query('tags');
  const tags = tagsParam ? tagsParam.split(',').map((t) => t.trim()).filter(Boolean) : undefined;

  const rawLimit = parseInt(c.req.query('limit') ?? '50', 10);
  const rawOffset = parseInt(c.req.query('offset') ?? '0', 10);
  const limit = Number.isNaN(rawLimit) || rawLimit < 1 ? 50 : Math.min(rawLimit, 200);
  const offset = Number.isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset;

  const { builds, total } = await getRecentBuilds(c.env, text, tags, auteurId, limit, offset);
  return c.json({ builds, total, limit, offset });
});

app.get('/builds/top', async (c) => {
  const text = c.req.query('text') ?? undefined;
  const auteurId = c.req.query('auteurId') ?? undefined;
  const tagsParam = c.req.query('tags');
  const tags = tagsParam ? tagsParam.split(',').map((t) => t.trim()).filter(Boolean) : undefined;

  const rawLimit = parseInt(c.req.query('limit') ?? '50', 10);
  const rawOffset = parseInt(c.req.query('offset') ?? '0', 10);
  const limit = Number.isNaN(rawLimit) || rawLimit < 1 ? 50 : Math.min(rawLimit, 200);
  const offset = Number.isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset;

  const { builds, total } = await getTopBuilds(c.env, text, tags, auteurId, limit, offset);
  return c.json({ builds, total, limit, offset });
});

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

  const input = body as {
    nom: unknown;
    description: unknown;
    auteur?: unknown;
    tags?: unknown;
    encoded: unknown;
  };

  if (typeof input.nom !== 'string' || input.nom.trim() === '') {
    return c.json({ error: 'Le champ "nom" doit être une chaîne non vide' }, 400);
  }
  if (input.nom.length > 25) {
    return c.json({ error: 'Le champ "nom" ne peut pas dépasser 25 caractères' }, 400);
  }
  if (typeof input.description !== 'string') {
    return c.json({ error: 'Le champ "description" doit être une chaîne' }, 400);
  }
  if (input.description.length > 250) {
    return c.json({ error: 'Le champ "description" ne peut pas dépasser 250 caractères' }, 400);
  }
  if (input.auteur !== undefined) {
    if (typeof input.auteur !== 'string' || input.auteur.trim() === '') {
      return c.json({ error: 'Le champ "auteur" doit être une chaîne non vide' }, 400);
    }
    if (input.auteur.length > 25) {
      return c.json({ error: 'Le champ "auteur" ne peut pas dépasser 25 caractères' }, 400);
    }
  }
  if (typeof input.encoded !== 'string' || input.encoded.trim() === '') {
    return c.json({ error: 'Le champ "encoded" doit être une chaîne non vide' }, 400);
  }
  if (input.encoded.length > 8000) {
    return c.json({ error: 'Le champ "encoded" ne peut pas dépasser 8000 caractères' }, 400);
  }
  if (input.tags !== undefined) {
    if (!Array.isArray(input.tags)) {
      return c.json({ error: 'Le champ "tags" doit être un tableau' }, 400);
    }
    if (input.tags.length > 5) {
      return c.json({ error: 'Maximum 5 tags autorisés' }, 400);
    }
    for (const tag of input.tags) {
      if (typeof tag !== 'string') {
        return c.json({ error: 'Chaque tag doit être une chaîne de caractères' }, 400);
      }
      if (tag.length > 25) {
        return c.json({ error: 'Chaque tag ne peut pas dépasser 25 caractères' }, 400);
      }
    }
  }

  const build = await createBuild(
      {
        nom: input.nom,
        description: input.description,
        auteur: typeof input.auteur === 'string' ? input.auteur : undefined,
        tags: Array.isArray(input.tags) ? (input.tags as string[]) : undefined,
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

  const input = body as {
    nom?: unknown;
    description?: unknown;
    auteur?: unknown;
    tags?: unknown;
    encoded?: unknown;
  };

  if (input.nom !== undefined) {
    if (typeof input.nom !== 'string' || input.nom.trim() === '') {
      return c.json({ error: 'Le champ "nom" doit être une chaîne non vide' }, 400);
    }
    if (input.nom.length > 25) {
      return c.json({ error: 'Le champ "nom" ne peut pas dépasser 25 caractères' }, 400);
    }
  }
  if (input.description !== undefined) {
    if (typeof input.description !== 'string') {
      return c.json({ error: 'Le champ "description" doit être une chaîne' }, 400);
    }
    if (input.description.length > 250) {
      return c.json({ error: 'Le champ "description" ne peut pas dépasser 250 caractères' }, 400);
    }
  }
  if (input.auteur !== undefined) {
    if (typeof input.auteur !== 'string' || input.auteur.trim() === '') {
      return c.json({ error: 'Le champ "auteur" doit être une chaîne non vide' }, 400);
    }
    if (input.auteur.length > 25) {
      return c.json({ error: 'Le champ "auteur" ne peut pas dépasser 25 caractères' }, 400);
    }
  }
  if (input.encoded !== undefined) {
    if (typeof input.encoded !== 'string' || input.encoded.trim() === '') {
      return c.json({ error: 'Le champ "encoded" doit être une chaîne non vide' }, 400);
    }
    if (input.encoded.length > 8000) {
      return c.json({ error: 'Le champ "encoded" ne peut pas dépasser 8000 caractères' }, 400);
    }
  }
  if (input.tags !== undefined) {
    if (!Array.isArray(input.tags)) {
      return c.json({ error: 'Le champ "tags" doit être un tableau' }, 400);
    }
    if (input.tags.length > 5) {
      return c.json({ error: 'Maximum 5 tags autorisés' }, 400);
    }
    for (const tag of input.tags) {
      if (typeof tag !== 'string') {
        return c.json({ error: 'Chaque tag doit être une chaîne de caractères' }, 400);
      }
      if (tag.length > 25) {
        return c.json({ error: 'Chaque tag ne peut pas dépasser 25 caractères' }, 400);
      }
    }
  }

  const updated = await updateBuild(
      id,
      {
        nom: typeof input.nom === 'string' ? input.nom : undefined,
        description: typeof input.description === 'string' ? input.description : undefined,
        auteur: typeof input.auteur === 'string' ? input.auteur : undefined,
        tags: Array.isArray(input.tags) ? (input.tags as string[]) : undefined,
        encoded: typeof input.encoded === 'string' ? input.encoded : undefined,
      },
      c.env,
  );

  return c.json(updated);
});

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

app.post('/builds/:id/like', requireAuth, async (c) => {
  const user = c.get('user') as JWTPayload;
  const id = c.req.param('id') ?? '';
  const result = await toggleLike(id, user.sub, c.env);
  if (!result) return c.json({ error: 'Build introuvable' }, 404);
  return c.json(result);
});

app.notFound((c) => c.json({ error: 'Route introuvable' }, 404));

export default app;