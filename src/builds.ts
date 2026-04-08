import { v4 as uuidv4 } from 'uuid';
import type { Build, BuildInput, Env } from './types';

const BUILD_INDEX_KEY = 'build_index';

function buildKey(id: string): string {
  return `build:${id}`;
}

function likesKey(id: string): string {
  return `likes:${id}`;
}

async function getBuildIndex(kv: KVNamespace): Promise<string[]> {
  const raw = await kv.get(BUILD_INDEX_KEY);
  if (!raw) return [];
  return JSON.parse(raw) as string[];
}

async function saveBuildIndex(kv: KVNamespace, ids: string[]): Promise<void> {
  await kv.put(BUILD_INDEX_KEY, JSON.stringify(ids));
}

async function getLikers(id: string, kv: KVNamespace): Promise<Set<string>> {
  const raw = await kv.get(likesKey(id));
  if (!raw) return new Set();
  return new Set(JSON.parse(raw) as string[]);
}

async function saveLikers(id: string, likers: Set<string>, kv: KVNamespace): Promise<void> {
  await kv.put(likesKey(id), JSON.stringify([...likers]));
}

export async function createBuild(
    input: BuildInput,
    authorId: string,
    env: Env,
): Promise<Build> {
  const id = uuidv4();
  const build: Build = {
    id,
    nom: input.nom,
    description: input.description,
    auteur: input.auteur?.trim() || 'Anonymous',
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

export async function getBuild(id: string, env: Env): Promise<Build | null> {
  const raw = await env.BUILDS_KV.get(buildKey(id));
  if (!raw) return null;
  return JSON.parse(raw) as Build;
}

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
    auteur: input.auteur !== undefined ? (input.auteur.trim() || existing.auteur) : existing.auteur,
    tags: input.tags ?? existing.tags,
    encoded: input.encoded ?? existing.encoded,
  };

  await env.BUILDS_KV.put(buildKey(id), JSON.stringify(updated));
  return updated;
}

export async function deleteBuild(id: string, env: Env): Promise<boolean> {
  const existing = await getBuild(id, env);
  if (!existing) return false;

  await env.BUILDS_KV.delete(buildKey(id));
  await env.BUILDS_KV.delete(likesKey(id));

  const index = await getBuildIndex(env.BUILDS_KV);
  const newIndex = index.filter((i) => i !== id);
  await saveBuildIndex(env.BUILDS_KV, newIndex);

  return true;
}

export async function toggleLike(
    id: string,
    userId: string,
    env: Env,
): Promise<{ build: Build; liked: boolean } | null> {
  const existing = await getBuild(id, env);
  if (!existing) return null;

  const likers = await getLikers(id, env.BUILDS_KV);
  const alreadyLiked = likers.has(userId);

  if (alreadyLiked) {
    likers.delete(userId);
  } else {
    likers.add(userId);
  }

  const liked = !alreadyLiked;
  const build: Build = { ...existing, likes: likers.size };

  await env.BUILDS_KV.put(buildKey(id), JSON.stringify(build));
  await saveLikers(id, likers, env.BUILDS_KV);

  return { build, liked };
}

export async function searchBuilds(
    env: Env,
    text?: string,
    tags?: string[],
    auteurId?: string,
    limit = 50,
    offset = 0,
    disableRandom = false,
): Promise<{ builds: Build[]; total: number }> {
  const index = await getBuildIndex(env.BUILDS_KV);
  const matched: Build[] = [];
  const lowerText = text?.toLowerCase().trim();

  for (const id of index) {
    const build = await getBuild(id, env);
    if (!build) continue;

    if (auteurId && build.auteurId !== auteurId) continue;

    if (tags && tags.length > 0) {
      const hasAllTags = tags.every((tag) => build.tags.includes(tag));
      if (!hasAllTags) continue;
    }

    if (lowerText) {
      const inNom = build.nom.toLowerCase().includes(lowerText);
      const inDescription = build.description.toLowerCase().includes(lowerText);
      const inAuteur = build.auteur.toLowerCase().includes(lowerText);
      if (!inNom && !inDescription && !inAuteur) continue;
    }

    matched.push(build);
  }

  const total = matched.length;

  if (disableRandom || total <= limit) {
    const sorted = [...matched].sort((a, b) => b.likes - a.likes);
    const builds = sorted.slice(offset, offset + limit);
    return { builds, total };
  }

  const likesCount = Math.floor(limit * 0.75);
  const randomCount = limit - likesCount;

  const sortedByLikes = [...matched].sort((a, b) => b.likes - a.likes);

  const topLikes = sortedByLikes.slice(0, likesCount);
  const topLikesIds = new Set(topLikes.map(b => b.id));

  const remaining = matched.filter(b => !topLikesIds.has(b.id));

  for (let i = remaining.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
  }

  const randomBuilds = remaining.slice(0, randomCount);

  let builds = [...topLikes, ...randomBuilds];

  return { builds, total };
}

export async function getRecentBuilds(
  env: Env,
  text?: string,
  tags?: string[],
  auteurId?: string,
  limit = 50,
  offset = 0,
): Promise<{ builds: Build[]; total: number }> {
  const index = await getBuildIndex(env.BUILDS_KV);
  const matched: Build[] = [];
  const lowerText = text?.toLowerCase().trim();

  for (const id of index) {
    const build = await getBuild(id, env);
    if (!build) continue;

    if (auteurId && build.auteurId !== auteurId) continue;

    if (tags && tags.length > 0) {
      const hasAllTags = tags.every((tag) => build.tags.includes(tag));
      if (!hasAllTags) continue;
    }

    if (lowerText) {
      const inNom = build.nom.toLowerCase().includes(lowerText);
      const inDescription = build.description.toLowerCase().includes(lowerText);
      const inAuteur = build.auteur.toLowerCase().includes(lowerText);
      if (!inNom && !inDescription && !inAuteur) continue;
    }

    matched.push(build);
  }

  const total = matched.length;
  const sorted = [...matched].sort((a, b) => b.timestamp - a.timestamp);
  const builds = sorted.slice(offset, offset + limit);
  return { builds, total };
}

export async function getTopBuilds(
  env: Env,
  text?: string,
  tags?: string[],
  auteurId?: string,
  limit = 50,
  offset = 0,
): Promise<{ builds: Build[]; total: number }> {
  return searchBuilds(env, text, tags, auteurId, limit, offset, true);
}
