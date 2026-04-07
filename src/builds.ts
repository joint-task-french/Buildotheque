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

/** Create a new build and return it. */
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

  await env.BUILDS_KV.put(buildKey(id), JSON.stringify(build));

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

/** Increment the like count of a build. Returns the updated build or null if not found. */
export async function likeBuild(id: string, env: Env): Promise<Build | null> {
  const existing = await getBuild(id, env);
  if (!existing) return null;

  const updated: Build = { ...existing, likes: existing.likes + 1 };
  await env.BUILDS_KV.put(buildKey(id), JSON.stringify(updated));
  return updated;
}

/** Search builds by optional text and tags.
 *
 * - `text`: matches against nom, description, or auteur (case-insensitive)
 * - `tags`: array of tag IDs; the build must contain ALL of them
 */
export async function searchBuilds(
  env: Env,
  text?: string,
  tags?: string[],
): Promise<Build[]> {
  const index = await getBuildIndex(env.BUILDS_KV);

  const results: Build[] = [];
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

    results.push(build);
  }

  return results;
}
