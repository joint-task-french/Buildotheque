import { v4 as uuidv4 } from 'uuid';
import type { Build, BuildInput, Env } from './types';

/** Key used to store the list of all build IDs in KV. */
const BUILD_INDEX_KEY = 'build_index';

/** KV key for a build by its ID. */
function buildKey(id: string): string {
  return `build:${id}`;
}

/** Retrieve all build IDs from the index. */
async function getBuildIndex(kv: KVNamespace): Promise<string[]> {
  const raw = await kv.get(BUILD_INDEX_KEY);
  if (!raw) return [];
  return JSON.parse(raw) as string[];
}

/** Persist the list of build IDs to the index. */
async function saveBuildIndex(kv: KVNamespace, ids: string[]): Promise<void> {
  await kv.put(BUILD_INDEX_KEY, JSON.stringify(ids));
}

/** Create a new build and return it.
 *
 * NOTE: The index update (read-modify-write) is not atomic; under heavy
 * concurrent writes, entries could be lost.  For a high-concurrency
 * production deployment, replace with Cloudflare Durable Objects or
 * use KV `list()` with a shared key prefix instead of a manual index.
 */
export async function createBuild(
  input: BuildInput,
  authorId: string,
  authorName: string,
  env: Env,
): Promise<Build> {
  const id = uuidv4();
  const build: Build = {
    id,
    nom: input.nom,
    description: input.description,
    auteur: authorName,
    auteurId: authorId,
    tags: input.tags ?? [],
    encoded: input.encoded,
    likes: 0,
    timestamp: Date.now(),
  };

  // Store the build document first so it is always addressable.
  await env.BUILDS_KV.put(buildKey(id), JSON.stringify(build));

  // Update the shared index (non-atomic – see note above).
  const index = await getBuildIndex(env.BUILDS_KV);
  index.push(id);
  await saveBuildIndex(env.BUILDS_KV, index);

  return build;
}

/** Retrieve a single build by ID, or null if not found. */
export async function getBuild(id: string, env: Env): Promise<Build | null> {
  const raw = await env.BUILDS_KV.get(buildKey(id));
  if (!raw) return null;
  return JSON.parse(raw) as Build;
}

/** Update a build's mutable fields. Returns the updated build or null if not found. */
export async function updateBuild(
  id: string,
  input: Partial<BuildInput>,
  env: Env,
): Promise<Build | null> {
  const existing = await getBuild(id, env);
  if (!existing) return null;

  const updated: Build = {
    ...existing,
    nom: input.nom ?? existing.nom,
    description: input.description ?? existing.description,
    tags: input.tags ?? existing.tags,
    encoded: input.encoded ?? existing.encoded,
  };

  await env.BUILDS_KV.put(buildKey(id), JSON.stringify(updated));
  return updated;
}

/** Delete a build by ID. Returns true if deleted, false if not found. */
export async function deleteBuild(id: string, env: Env): Promise<boolean> {
  const existing = await getBuild(id, env);
  if (!existing) return false;

  await env.BUILDS_KV.delete(buildKey(id));

  const index = await getBuildIndex(env.BUILDS_KV);
  const newIndex = index.filter((i) => i !== id);
  await saveBuildIndex(env.BUILDS_KV, newIndex);

  return true;
}

/** Increment the like count of a build. Returns the updated build or null if not found.
 *
 * NOTE: This is a non-atomic read-modify-write; under heavy concurrent
 * requests, some increments may be lost.  For strict accuracy, migrate
 * to Cloudflare Durable Objects with transactional storage.
 */
export async function likeBuild(id: string, env: Env): Promise<Build | null> {
  const existing = await getBuild(id, env);
  if (!existing) return null;

  const updated: Build = { ...existing, likes: existing.likes + 1 };
  await env.BUILDS_KV.put(buildKey(id), JSON.stringify(updated));
  return updated;
}

/** Search builds by optional text and tags.
 *
 * - `text`  : matches against nom, description, or auteur (case-insensitive)
 * - `tags`  : array of tag IDs; the build must contain ALL of them
 * - `limit` : maximum number of results to return (default: 50)
 * - `offset`: number of results to skip for pagination (default: 0)
 *
 * NOTE: All build objects are fetched sequentially from KV to apply
 * filters.  This is acceptable for small datasets.  For large libraries,
 * consider Cloudflare D1 or maintaining separate tag-keyed indexes in KV.
 */
export async function searchBuilds(
  env: Env,
  text?: string,
  tags?: string[],
  limit = 50,
  offset = 0,
): Promise<{ builds: Build[]; total: number }> {
  const index = await getBuildIndex(env.BUILDS_KV);

  const matched: Build[] = [];
  const lowerText = text?.toLowerCase().trim();

  for (const id of index) {
    const build = await getBuild(id, env);
    if (!build) continue;

    // Tag filter: build must contain ALL requested tags
    if (tags && tags.length > 0) {
      const hasAllTags = tags.every((tag) => build.tags.includes(tag));
      if (!hasAllTags) continue;
    }

    // Text filter: matches nom, description, or auteur
    if (lowerText) {
      const inNom = build.nom.toLowerCase().includes(lowerText);
      const inDescription = build.description.toLowerCase().includes(lowerText);
      const inAuteur = build.auteur.toLowerCase().includes(lowerText);
      if (!inNom && !inDescription && !inAuteur) continue;
    }

    matched.push(build);
  }

  const total = matched.length;
  const builds = matched.slice(offset, offset + limit);
  return { builds, total };
}
