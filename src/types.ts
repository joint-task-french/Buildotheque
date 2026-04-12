import { z } from 'zod';

/** TypeScript types for the Buildotheque API. */

/** Zod schema for build input validation. */
export const BuildSchema = z.object({
  nom: z.string().trim().min(1, 'Le champ "nom" doit être une chaîne non vide').max(25, 'Le champ "nom" ne peut pas dépasser 25 caractères'),
  description: z.string().max(500, 'Le champ "description" ne peut pas dépasser 500 caractères'),
  auteur: z.string().trim().min(1, 'Le champ "auteur" doit être une chaîne non vide').max(25, 'Le champ "auteur" ne peut pas dépasser 25 caractères').optional(),
  encoded: z.string().trim().min(1, 'Le champ "encoded" doit être une chaîne non vide').max(8000, 'Le champ "encoded" ne peut pas dépasser 8000 caractères'),
  tags: z.array(z.string().max(25, 'Chaque tag ne peut pas dépasser 25 caractères')).max(5, 'Maximum 5 tags autorisés').optional(),
});

/** Input payload for creating or updating a build. */
export type BuildInput = z.infer<typeof BuildSchema>;

/** A build object stored in KV. */
export interface Build {
  /** Unique identifier for the build. */
  id: string;
  /** Name of the build. */
  nom: string;
  /** Detailed description of the build. */
  description: string;
  /** Author (Discord username) of the build. */
  auteur: string;
  /** Discord user ID of the author (Hashed using SHA-512). */
  auteurId: string;
  /** List of tag identifiers associated with the build. */
  tags: string[];
  /** Encoded string containing the build configuration. */
  encoded: string;
  /** Number of likes. */
  likes: number;
  /** Creation timestamp (Unix ms). */
  timestamp: number;
}

/** Discord OAuth token response. */
export interface DiscordTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
}

/** Discord user object returned from the API. */
export interface DiscordUser {
  id: string;
  username: string;
  discriminator: string;
  global_name?: string | null;
  avatar?: string | null;
}

/** JWT payload stored in session tokens. */
export interface JWTPayload {
  sub: string;        // Hashed Discord user ID (SHA-512)
  username: string;   // Discord username
  avatar?: string;    // Discord avatar hash
  iat?: number;
  exp?: number;
}

/** Cloudflare Workers environment bindings. */
export interface Env {
  DB: D1Database;
  DISCORD_CLIENT_ID: string;
  DISCORD_CLIENT_SECRET: string;
  DISCORD_REDIRECT_URI: string;
  JWT_SECRET: string;
  FRONTEND_URL: string;
  ALLOWED_DOMAINS?: string;
}