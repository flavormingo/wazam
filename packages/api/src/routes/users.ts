import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database } from '../db/database.js';
import { createAuthMiddleware } from '../middleware.js';
import { getPresignedPost, getPublicUrl } from '../storage.js';
import { config } from '../config.js';
import { nanoid } from 'nanoid';
import { VALENTINO_ID } from '@wazam/shared';

const ALLOWED_CONNECTIONS = [
  'dribbble', 'facebook', 'github', 'instagram', 'linkedin', 'medium',
  'pinterest', 'snapchat', 'stackoverflow', 'telegram', 'threads',
  'tiktok', 'youtube', 'x',
] as const;

export function userRoutes(app: FastifyInstance, db: Kysely<Database>) {
  const requireAuth = createAuthMiddleware(db);

  app.get('/api/users/search', { preHandler: requireAuth }, async (request, reply) => {
    const { q } = request.query as { q?: string };
    if (!q || q.trim().length < 1) {
      return reply.status(400).send({ error: 'Query must be at least 1 character' });
    }

    const term = q.trim().toLowerCase().replace(/[%_\\]/g, '\\$&');
    const users = await db
      .selectFrom('users')
      .select(['id', 'username', 'avatar_key', 'email'])
      .where('username', 'ilike', `%${term}%`)
      .where('id', '!=', request.userId!)
      .where('email_verified', '=', true)
      .limit(20)
      .execute();

    return users.map((u) => ({
      id: u.id,
      name: u.username,
      avatar_url: u.avatar_key ? getPublicUrl(u.avatar_key) : null,
    }));
  });

  app.post('/api/users/me/profile-image', { preHandler: requireAuth }, async (request, reply) => {
    const { type, filename, content_type, size } = request.body as {
      type: 'avatar' | 'banner';
      filename: string;
      content_type: string;
      size: number;
    };

    if (!type || !filename || !content_type || !size) {
      return reply.status(400).send({ error: 'type, filename, content_type, and size are required' });
    }

    if (type !== 'avatar' && type !== 'banner') {
      return reply.status(400).send({ error: 'type must be avatar or banner' });
    }

    if (!content_type.startsWith('image/')) {
      return reply.status(400).send({ error: 'Only image files are allowed' });
    }

    if (size <= 0 || size > 10 * 1024 * 1024) {
      return reply.status(413).send({ error: 'Image must be under 10MB' });
    }

    const safeName = filename.replace(/[/\\]/g, '_').replace(/\.\./g, '_');
    const key = `profiles/${request.userId}/${type}/${nanoid()}/${safeName}`;
    const post = await getPresignedPost(config.minioBucket, key, 10 * 1024 * 1024);

    return {
      post_url: post.url,
      fields: post.fields,
      key,
      public_url: getPublicUrl(key),
    };
  });

  app.get('/api/users/:userId/profile', { preHandler: requireAuth }, async (request, reply) => {
    const { userId } = request.params as { userId: string };

    const user = await db
      .selectFrom('users')
      .select(['id', 'username', 'avatar_key', 'email', 'status_emoji', 'status_text', 'bio', 'location', 'banner_key', 'link', 'connections', 'created_at'])
      .where('id', '=', userId)
      .executeTakeFirst();

    if (!user) return reply.status(404).send({ error: 'User not found' });

    const { rows } = await db.executeQuery<{ n: string }>(
      db.selectFrom('users')
        .select(db.fn.count('id').as('n'))
        .where('created_at', '<=', user.created_at)
        .where('id', '<>', VALENTINO_ID)
        .compile()
    );
    const userNumber = user.id === VALENTINO_ID ? 0 : Number(rows[0]?.n ?? 0);

    return {
      id: user.id,
      name: user.username,
      avatar_url: user.avatar_key ? getPublicUrl(user.avatar_key) : null,
      status_emoji: user.status_emoji,
      status_text: user.status_text,
      bio: user.bio,
      location: user.location,
      banner_url: user.banner_key ? getPublicUrl(user.banner_key) : null,
      link: user.link,
      connections: user.connections,
      created_at: user.created_at,
      user_number: userNumber,
    };
  });

  app.patch('/api/users/me/profile', { preHandler: requireAuth }, async (request, reply) => {
    const body = request.body as {
      name?: string;
      avatar_key?: string;
      banner_key?: string;
      status_emoji?: string;
      status_text?: string;
      bio?: string;
      location?: string;
      link?: string;
      connections?: Record<string, string>;
      friend_privacy?: string;
    };

    const updates: Record<string, unknown> = {};

    if (body.name !== undefined) {
      const trimmed = body.name.trim();
      if (!trimmed || trimmed.length > 32) {
        return reply.status(400).send({ error: 'Name is required (max 32 chars)' });
      }
      const currentName = request.user!.username;
      if (currentName.toLowerCase() !== trimmed.toLowerCase()) {
        const taken = await db
          .selectFrom('users')
          .select('id')
          .where('id', '!=', request.userId!)
          .where((eb) => eb(eb.fn('lower', ['username']), '=', trimmed.toLowerCase()))
          .executeTakeFirst();
        if (taken) {
          return reply.status(409).send({ error: 'Name is already taken' });
        }
      }
      updates.username = trimmed;
      updates.displayUsername = trimmed;
      updates.display_name = trimmed;
    }
    if (body.avatar_key !== undefined) updates.avatar_key = body.avatar_key || null;
    if (body.banner_key !== undefined) updates.banner_key = body.banner_key || null;
    if (body.status_emoji !== undefined) {
      if (body.status_emoji && body.status_emoji.length > 8) {
        return reply.status(400).send({ error: 'Status emoji max 8 chars' });
      }
      updates.status_emoji = body.status_emoji || null;
    }
    if (body.status_text !== undefined) {
      if (body.status_text && body.status_text.length > 30) {
        return reply.status(400).send({ error: 'Status text max 30 chars' });
      }
      updates.status_text = body.status_text || null;
    }
    if (body.bio !== undefined) {
      if (body.bio && body.bio.length > 200) {
        return reply.status(400).send({ error: 'Bio max 200 chars' });
      }
      updates.bio = body.bio || null;
    }
    if (body.location !== undefined) {
      if (body.location && body.location.length > 100) {
        return reply.status(400).send({ error: 'Location max 100 chars' });
      }
      updates.location = body.location || null;
    }
    if (body.link !== undefined) {
      if (body.link && body.link.length > 256) {
        return reply.status(400).send({ error: 'Link max 256 chars' });
      }
      if (body.link && !body.link.match(/^https?:\/\//)) {
        return reply.status(400).send({ error: 'Link must start with http:// or https://' });
      }
      updates.link = body.link || null;
    }
    if (body.connections !== undefined) {
      if (body.connections && typeof body.connections === 'object') {
        const cleaned: Record<string, string> = {};
        for (const [key, val] of Object.entries(body.connections)) {
          if (!ALLOWED_CONNECTIONS.includes(key as any)) {
            return reply.status(400).send({ error: `Invalid connection platform: ${key}` });
          }
          if (typeof val !== 'string') {
            return reply.status(400).send({ error: 'Connection values must be strings' });
          }
          if (val.length > 64) {
            return reply.status(400).send({ error: `Username for ${key} max 64 chars` });
          }
          if (val.trim()) cleaned[key] = val.trim();
        }
        updates.connections = Object.keys(cleaned).length > 0 ? JSON.stringify(cleaned) : null;
      } else {
        updates.connections = null;
      }
    }

    if (body.friend_privacy !== undefined) {
      const allowed = ['everyone', 'friends-of-friends', 'club-members'];
      if (!allowed.includes(body.friend_privacy)) {
        return reply.status(400).send({ error: 'Invalid friend_privacy value' });
      }
      updates.friend_privacy = body.friend_privacy;
    }

    if (Object.keys(updates).length === 0) {
      return reply.status(400).send({ error: 'No fields to update' });
    }

    updates.updated_at = new Date();

    await db
      .updateTable('users')
      .set(updates)
      .where('id', '=', request.userId!)
      .execute();

    const user = await db
      .selectFrom('users')
      .select(['id', 'username', 'avatar_key', 'email', 'status_emoji', 'status_text', 'bio', 'location', 'banner_key', 'link', 'connections', 'friend_privacy'])
      .where('id', '=', request.userId!)
      .executeTakeFirstOrThrow();

    return {
      id: user.id,
      email: user.email,
      name: user.username,
      avatar_url: user.avatar_key ? getPublicUrl(user.avatar_key) : null,
      status_emoji: user.status_emoji,
      status_text: user.status_text,
      bio: user.bio,
      location: user.location,
      banner_url: user.banner_key ? getPublicUrl(user.banner_key) : null,
      link: user.link,
      connections: user.connections,
      friend_privacy: user.friend_privacy,
    };
  });
}
