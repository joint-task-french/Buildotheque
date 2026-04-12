import { v4 as uuidv4 } from 'uuid';
import type { Build, BuildInput, Env } from './types';

async function updateTags(id: string, tags: string[], env: Env): Promise<void> {
  if (tags.length > 0) {
    const statements = tags.map(tag =>
        env.DB.prepare('INSERT INTO tags (build_id, tag) VALUES (?, ?)').bind(id, tag)
    );
    await env.DB.batch(statements);
  }
}

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

  await updateTags(id, tags, env);

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
  ).bind(id).first<{ [key: string]: any; tags_list: string | null }>();

  if (!result) return null;

  return {
    ...result,
    tags: result.tags_list ? result.tags_list.split(',') : [],
  } as unknown as Build;
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
    await updateTags(id, tags, env);
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
    const timestamp = Date.now();
    await env.DB.prepare('INSERT INTO build_likes (build_id, user_id, timestamp) VALUES (?, ?, ?)').bind(id, userId, timestamp).run();
  }

  const countResult = await env.DB.prepare(
      'SELECT COUNT(*) as count FROM build_likes WHERE build_id = ?'
  ).bind(id).first<{count: number}>();

  const newLikes = countResult?.count ?? 0;

  await env.DB.prepare('UPDATE builds SET likes = ? WHERE id = ?').bind(newLikes, id).run();

  return { build: { ...existing, likes: newLikes }, liked: !alreadyLiked };
}


type SearchCondition = {
  field: string;
  value: string | number;
  operator: 'LIKE' | '=' | '>' | '<' | '>=' | '<=';
};

function parseAdvancedSearch(text: string) {
  const parts = text.split(';');
  const conditions: SearchCondition[] = [];
  const freeText: string[] = [];

  let hasOperator = false;
  for (const part of parts) {
    const colonIndex = part.indexOf(':');
    if (colonIndex === -1) {
      if (part.trim()) freeText.push(part.trim());
      continue;
    }

    const key = part.substring(0, colonIndex).trim().toLowerCase();
    let value = part.substring(colonIndex + 1).trim();

    if (!value) {
      if (part.trim()) freeText.push(part.trim());
      continue;
    }

    hasOperator = true;
    let field = '';
    let operator: 'LIKE' | '=' | '>' | '<' | '>=' | '<=' = 'LIKE';

    switch (key) {
      case 'nom':
      case 'name':
        field = 'b.nom';
        break;
      case 'description':
      case 'desc':
        field = 'b.description';
        break;
      case 'auteur':
      case 'author':
      case 'pseudo':
        field = 'b.auteur';
        break;
      case 'likes':
        field = 'b.likes';
        operator = '=';
        break;
      case 'timestamp':
      case 'date':
        field = 'b.timestamp';
        operator = '=';
        break;
      default:
        freeText.push(part.trim());
        continue;
    }

    if (field === 'b.likes' || field === 'b.timestamp') {
      const match = value.match(/^([><]=?|=)(.+)$/);
      if (match) {
        operator = match[1] as any;
        value = match[2].trim();
      }

      if (field === 'b.timestamp' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const date = new Date(value);
        if (!isNaN(date.getTime())) {
          const start = date.getTime();
          if (operator === '=') {
            conditions.push({ field, value: start, operator: '>=' });
            conditions.push({ field, value: start + 86400000, operator: '<' });
          } else {
            conditions.push({ field, value: start, operator });
          }
          continue;
        }
      }

      const numValue = parseInt(value, 10);
      if (!isNaN(numValue)) {
        conditions.push({ field, value: numValue, operator });
      }
    } else {
      conditions.push({ field, value: `%${value}%`, operator: 'LIKE' });
    }
  }

  return { conditions, freeText, hasOperator };
}

async function getBuildsInternal(
    env: Env,
    text?: string,
    tags?: string[],
    auteurId?: string,
    order: 'random' | 'likes' | 'recent' = 'random',
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
    const { conditions, freeText, hasOperator } = parseAdvancedSearch(text);

    if (hasOperator || freeText.length > 0) {
      // Handle advanced conditions
      for (const cond of conditions) {
        query += ` AND ${cond.field} ${cond.operator} ?`;
        params.push(cond.value);
      }

      // Handle free text
      for (const term of freeText) {
        query += ` AND (b.nom LIKE ? OR b.description LIKE ? OR b.auteur LIKE ?)`;
        const t = `%${term}%`;
        params.push(t, t, t);
      }
    } else {
      // Fallback to classic search if no operator found (though parseAdvancedSearch should handle it via freeText)
      query += ` AND (b.nom LIKE ? OR b.description LIKE ? OR b.auteur LIKE ?)`;
      const t = `%${text}%`;
      params.push(t, t, t);
    }
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

  if (order === 'random') {
    query += ` ORDER BY RANDOM()`;
  } else if (order === 'likes') {
    query += ` ORDER BY b.likes DESC`;
  } else {
    query += ` ORDER BY b.timestamp DESC`;
  }

  query += ` LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const { results } = await env.DB.prepare(query).bind(...params).all<{ [key: string]: any; tags_list: string | null }>();
  const builds = results.map(r => ({
    ...r,
    tags: r.tags_list ? r.tags_list.split(',') : []
  })) as unknown as Build[];

  return { builds, total };
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
  return getBuildsInternal(env, text, tags, auteurId, disableRandom ? 'likes' : 'random', limit, offset);
}

export async function getRecentBuilds(
    env: Env,
    text?: string,
    tags?: string[],
    auteurId?: string,
    limit = 50,
    offset = 0,
): Promise<{ builds: Build[]; total: number }> {
  return getBuildsInternal(env, text, tags, auteurId, 'recent', limit, offset);
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