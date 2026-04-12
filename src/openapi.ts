export const openapiDoc = {
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
        type: 'http' as const,
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
    schemas: {
      Build: {
        type: 'object' as const,
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
        type: 'object' as const,
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
            content: { 'application/json': { schema: { type: 'object' as const, properties: { status: { type: 'string' }, name: { type: 'string' } } } } },
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
                  type: 'object' as const,
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
                type: 'object' as const,
                required: ['nom', 'description', 'encoded'],
                properties: {
                  nom: { type: 'string', maxLength: 25 },
                  description: { type: 'string', maxLength: 500 },
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
                type: 'object' as const,
                properties: {
                  nom: { type: 'string', maxLength: 25 },
                  description: { type: 'string', maxLength: 500 },
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
                  type: 'object' as const,
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
        responses: { 200: { description: 'Succès', content: { 'application/json': { schema: { type: 'object' as const, properties: { builds: { type: 'array', items: { $ref: '#/components/schemas/Build' } }, total: { type: 'integer' }, limit: { type: 'integer' }, offset: { type: 'integer' } } } } } } },
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
        responses: { 200: { description: 'Succès', content: { 'application/json': { schema: { type: 'object' as const, properties: { builds: { type: 'array', items: { $ref: '#/components/schemas/Build' } }, total: { type: 'integer' }, limit: { type: 'integer' }, offset: { type: 'integer' } } } } } } },
      },
    },
  },
} as const;
