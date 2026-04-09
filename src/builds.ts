import { v4 as uuidv4 } from 'uuid';
import type { Build, BuildInput, Env } from './types';

export async function createBuild(
    input: BuildInput,
    authorId: string,
    env: Env,
): Promise<Build> {
  const id = uuidv4();
  const timestamp = Date.now();
  const auteur = input.auteur?.trim() || 'Anonymous';
  const tags = input.tags ?? [];

  await env.DB.prepare(
      'INSERT INTO builds (id, nom, description, auteur, auteurId, encoded, likes, timestamp) VALUES (?, ?, ?, ?, ?, ?, 0, ?)'
  )
      .bind(id, input.nom, input.description, auteur, authorId, input.encoded, timestamp)
      .run();

  if (tags.length > 0) {
    const statements = tags.map(tag =>
        env.DB.prepare('INSERT INTO tags (build_id, tag) VALUES (?, ?)').bind(id, tag)
    );
    await env.DB.batch(statements);
  }

  return {
    id,
    nom: input.nom,
    description: input.description,
    auteur,
    auteurId: authorId,
    tags,
    encoded: input.encoded,
    likes: 0,
    timestamp,
  };
}

export async function getBuild(id: string, env: Env): Promise<Build | null> {
  const result = await env.DB.prepare(
      `SELECT b.*, GROUP_CONCAT(t.tag) as tags_list 
     FROM builds b 
     LEFT JOIN tags t ON b.id = t.build_id 
     WHERE b.id = ? 
     GROUP BY b.id`
  ).bind(id).first<any>();

  if (!result) return null;

  return {
    ...result,
    tags: result.tags_list ? result.tags_list.split(',') : [],
  } as Build;
}

export async function updateBuild(
    id: string,
    input: Partial<BuildInput>,
    env: Env,
): Promise<Build | null> {
  const existing = await getBuild(id, env);
  if (!existing) return null;

  const nom = input.nom ?? existing.nom;
  const description = input.description ?? existing.description;
  const auteur = input.auteur !== undefined ? (input.auteur.trim() || existing.auteur) : existing.auteur;
  const encoded = input.encoded ?? existing.encoded;
  const tags = input.tags ?? existing.tags;

  await env.DB.prepare(
      'UPDATE builds SET nom = ?, description = ?, auteur = ?, encoded = ? WHERE id = ?'
  ).bind(nom, description, auteur, encoded, id).run();

  if (input.tags !== undefined) {
    await env.DB.prepare('DELETE FROM tags WHERE build_id = ?').bind(id).run();

    if (tags.length > 0) {
      const statements = tags.map(tag =>
          env.DB.prepare('INSERT INTO tags (build_id, tag) VALUES (?, ?)').bind(id, tag)
      );
      await env.DB.batch(statements);
    }
  }

  return { ...existing, nom, description, auteur, encoded, tags };
}

export async function deleteBuild(id: string, env: Env): Promise<boolean> {
  await env.DB.prepare('DELETE FROM tags WHERE build_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM build_likes WHERE build_id = ?').bind(id).run();
  const result = await env.DB.prepare('DELETE FROM builds WHERE id = ?').bind(id).run();

  return result.meta.changes > 0;
}

export async function toggleLike(
    id: string,
    userId: string,
    env: Env,
): Promise<{ build: Build; liked: boolean } | null> {
  const existing = await getBuild(id, env);
  if (!existing) return null;

  const alreadyLiked = await env.DB.prepare(
      'SELECT 1 FROM build_likes WHERE build_id = ? AND user_id = ?'
  ).bind(id, userId).first();

  if (alreadyLiked) {
    await env.DB.prepare('DELETE FROM build_likes WHERE build_id = ? AND user_id = ?').bind(id, userId).run();
  } else {
    await env.DB.prepare('INSERT INTO build_likes (build_id, user_id) VALUES (?, ?)').bind(id, userId).run();
  }

  const countResult = await env.DB.prepare(
      'SELECT COUNT(*) as count FROM build_likes WHERE build_id = ?'
  ).bind(id).first<{count: number}>();

  const newLikes = countResult?.count ?? 0;

  await env.DB.prepare('UPDATE builds SET likes = ? WHERE id = ?').bind(newLikes, id).run();

  return { build: { ...existing, likes: newLikes }, liked: !alreadyLiked };
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
  let query = `
    SELECT b.*, GROUP_CONCAT(t.tag) as tags_list 
    FROM builds b 
    LEFT JOIN tags t ON b.id = t.build_id 
    WHERE 1=1
  `;
  const params: any[] = [];

  if (auteurId) {
    query += ` AND b.auteurId = ?`;
    params.push(auteurId);
  }

  if (text) {
    query += ` AND (b.nom LIKE ? OR b.description LIKE ? OR b.auteur LIKE ?)`;
    const t = `%${text}%`;
    params.push(t, t, t);
  }

  if (tags && tags.length > 0) {
    for (const tag of tags) {
      query += ` AND EXISTS (SELECT 1 FROM tags WHERE build_id = b.id AND tag = ?)`;
      params.push(tag);
    }
  }

  query += ` GROUP BY b.id`;

  const countQuery = `SELECT COUNT(*) as count FROM (${query})`;
  const totalResult = await env.DB.prepare(countQuery).bind(...params).first<{count: number}>();
  const total = totalResult?.count ?? 0;

  if (!disableRandom) {
    query += ` ORDER BY RANDOM()`;
  } else {
    query += ` ORDER BY b.likes DESC`;
  }

  query += ` LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const { results } = await env.DB.prepare(query).bind(...params).all<any>();
  const builds = results.map(r => ({
    ...r,
    tags: r.tags_list ? r.tags_list.split(',') : []
  })) as Build[];

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
  let query = `
    SELECT b.*, GROUP_CONCAT(t.tag) as tags_list 
    FROM builds b 
    LEFT JOIN tags t ON b.id = t.build_id 
    WHERE 1=1
  `;
  const params: any[] = [];

  if (auteurId) {
    query += ` AND b.auteurId = ?`;
    params.push(auteurId);
  }

  if (text) {
    query += ` AND (b.nom LIKE ? OR b.description LIKE ? OR b.auteur LIKE ?)`;
    const t = `%${text}%`;
    params.push(t, t, t);
  }

  if (tags && tags.length > 0) {
    for (const tag of tags) {
      query += ` AND EXISTS (SELECT 1 FROM tags WHERE build_id = b.id AND tag = ?)`;
      params.push(tag);
    }
  }

  query += ` GROUP BY b.id`;

  const countQuery = `SELECT COUNT(*) as count FROM (${query})`;
  const totalResult = await env.DB.prepare(countQuery).bind(...params).first<{count: number}>();
  const total = totalResult?.count ?? 0;

  query += ` ORDER BY b.timestamp DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const { results } = await env.DB.prepare(query).bind(...params).all<any>();
  const builds = results.map(r => ({
    ...r,
    tags: r.tags_list ? r.tags_list.split(',') : []
  })) as Build[];

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