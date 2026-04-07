/**
 * TypeScript types for the Buildotheque API.
 */

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

/** Input payload for creating or updating a build. */
export interface BuildInput {
  nom: string;
  description: string;
  /** Display name chosen by the author (≤ 25 characters). */
  auteur?: string;
  tags?: string[];
  encoded: string;
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
  BUILDS_KV: KVNamespace;
  DISCORD_CLIENT_ID: string;
  DISCORD_CLIENT_SECRET: string;
  DISCORD_REDIRECT_URI: string;
  JWT_SECRET: string;
  FRONTEND_URL: string;
}