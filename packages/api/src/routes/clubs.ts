import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type Redis from 'ioredis';
import type { Database } from '../db/database.js';
import { createAuthMiddleware } from '../middleware.js';
import { computePermissions } from '../permissions.js';
import { Permissions, hasPermission, DEFAULT_PERMISSIONS } from '@wazup/shared';
import { getPublicUrl, getPresignedPost } from '../storage.js';
import { config } from '../config.js';
import { nanoid } from 'nanoid';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
const RESERVED_SLUGS = new Set([
  'admin', 'api', 'auth', 'club', 'dm', 'invite', 'settings',
  'login', 'register', 'reset-password',
]);

const ADMIN_PERMS = (
  Permissions.ADMIN | Permissions.MANAGE_CLUB | Permissions.MANAGE_ROLES |
  Permissions.MANAGE_CHANNELS | Permissions.KICK_MEMBERS | Permissions.BAN_MEMBERS |
  Permissions.VIEW_AUDIT_LOG | Permissions.MANAGE_MESSAGES |
  Permissions.SEND_MESSAGES | Permissions.CONNECT_VOICE | Permissions.SPEAK |
  Permissions.STREAM | Permissions.CREATE_INVITE | Permissions.ATTACH_FILES
).toString();

function validateSlug(slug: string): string | null {
  if (slug.length < 2 || slug.length > 30) return 'slug must be 2-30 characters';
  if (!SLUG_RE.test(slug)) return 'slug must be lowercase alphanumeric with hyphens, cannot start/end with hyphen';
  if (RESERVED_SLUGS.has(slug)) return 'that url is reserved';
  return null;
}

async function resolveClub(db: Kysely<Database>, param: string) {
  if (UUID_RE.test(param)) {
    return db.selectFrom('clubs').selectAll().where('id', '=', param).executeTakeFirst();
  }
  return db.selectFrom('clubs').selectAll().where('slug', '=', param).executeTakeFirst();
}

export function clubRoutes(app: FastifyInstance, db: Kysely<Database>, redis: Redis) {
  const requireAuth = createAuthMiddleware(db);

  app.get('/api/club', { preHandler: requireAuth }, async (request) => {
    const clubs = await db
      .selectFrom('clubs')
      .innerJoin('memberships', 'memberships.club_id', 'clubs.id')
      .selectAll('clubs')
      .where('memberships.user_id', '=', request.userId!)
      .orderBy('clubs.name')
      .execute();

    return clubs.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      icon_url: c.icon_key ? getPublicUrl(c.icon_key) : null,
      owner_id: c.owner_id,
    }));
  });

  app.post('/api/club', { preHandler: requireAuth }, async (request, reply) => {
    const { name, slug, icon_key } = request.body as { name: string; slug?: string; icon_key?: string };
    const trimmedName = name?.trim();
    if (!trimmedName || trimmedName.length > 100) {
      return reply.status(400).send({ error: 'Name is required (max 100 chars)' });
    }

    let finalSlug: string;
    if (slug) {
      const slugLower = slug.toLowerCase();
      const err = validateSlug(slugLower);
      if (err) return reply.status(400).send({ error: err });
      const existing = await db.selectFrom('clubs').select('id').where('slug', '=', slugLower).executeTakeFirst();
      if (existing) return reply.status(409).send({ error: 'that url is already taken' });
      finalSlug = slugLower;
    } else {
      finalSlug = nanoid(8).toLowerCase();
    }

    const club = await db.transaction().execute(async (trx) => {
      const club = await trx
        .insertInto('clubs')
        .values({ name: trimmedName, slug: finalSlug, owner_id: request.userId!, icon_key: icon_key || null })
        .returningAll()
        .executeTakeFirstOrThrow();

      await trx
        .insertInto('memberships')
        .values({ user_id: request.userId!, club_id: club.id })
        .execute();

      await trx
        .insertInto('roles')
        .values({
          club_id: club.id,
          name: 'everyone',
          permissions: DEFAULT_PERMISSIONS.toString(),
          position: 0,
          is_default: true,
        })
        .execute();

      await trx
        .insertInto('roles')
        .values({
          club_id: club.id,
          name: 'admin',
          permissions: ADMIN_PERMS,
          position: 1,
          is_default: false,
        })
        .execute();

      const textSection = await trx
        .insertInto('sections')
        .values({ club_id: club.id, name: 'text channels', position: 0 })
        .returning('id')
        .executeTakeFirstOrThrow();

      const voiceSection = await trx
        .insertInto('sections')
        .values({ club_id: club.id, name: 'voice channels', position: 1 })
        .returning('id')
        .executeTakeFirstOrThrow();

      await trx
        .insertInto('channels')
        .values([
          { club_id: club.id, name: 'parlor', type: 'text', position: 0, section_id: textSection.id },
          { club_id: club.id, name: 'saloon', type: 'voice', position: 1, section_id: voiceSection.id },
        ])
        .execute();

      return club;
    });

    const result = {
      id: club.id,
      name: club.name,
      slug: club.slug,
      icon_url: club.icon_key ? getPublicUrl(club.icon_key) : null,
      owner_id: club.owner_id,
    };

    await redis.publish(`user:${request.userId}`, JSON.stringify({ op: 'club.add', d: result }));

    return reply.status(201).send(result);
  });

  app.get('/api/club/:clubId', { preHandler: requireAuth }, async (request, reply) => {
    const { clubId } = request.params as { clubId: string };
    const club = await resolveClub(db, clubId);
    if (!club) return reply.status(404).send({ error: 'Club not found' });

    const membership = await db
      .selectFrom('memberships')
      .select('id')
      .where('user_id', '=', request.userId!)
      .where('club_id', '=', club.id)
      .executeTakeFirst();

    if (!membership) {
      return reply.status(403).send({ error: 'Not a member of this club' });
    }

    const memberCount = await db
      .selectFrom('memberships')
      .select(db.fn.countAll().as('count'))
      .where('club_id', '=', club.id)
      .executeTakeFirstOrThrow();

    return {
      id: club.id,
      name: club.name,
      slug: club.slug,
      icon_url: club.icon_key ? getPublicUrl(club.icon_key) : null,
      owner_id: club.owner_id,
      member_count: Number(memberCount.count),
    };
  });

  app.patch('/api/club/:clubId', { preHandler: requireAuth }, async (request, reply) => {
    const { clubId } = request.params as { clubId: string };
    const body = request.body as { name?: string; icon_key?: string | null; slug?: string };

    const club = await resolveClub(db, clubId);
    if (!club) return reply.status(404).send({ error: 'Club not found' });

    const perms = await computePermissions(db, request.userId!, club.id);
    if (!hasPermission(perms, Permissions.MANAGE_CLUB)) {
      return reply.status(403).send({ error: 'Missing MANAGE_CLUB permission' });
    }

    const trimmedName = body.name?.trim();
    if (body.name !== undefined && (!trimmedName || trimmedName.length > 100)) {
      return reply.status(400).send({ error: 'Name is required (max 100 chars)' });
    }

    if (body.slug !== undefined) {
      const slugLower = body.slug.toLowerCase();
      const err = validateSlug(slugLower);
      if (err) return reply.status(400).send({ error: err });
      const existing = await db.selectFrom('clubs').select('id').where('slug', '=', slugLower).where('id', '!=', club.id).executeTakeFirst();
      if (existing) return reply.status(409).send({ error: 'that url is already taken' });
      body.slug = slugLower;
    }

    const updates: Record<string, unknown> = { updated_at: new Date() };
    if (trimmedName) updates.name = trimmedName;
    if (body.icon_key !== undefined) updates.icon_key = body.icon_key;
    if (body.slug !== undefined) updates.slug = body.slug;

    const updated = await db
      .updateTable('clubs')
      .set(updates)
      .where('id', '=', club.id)
      .returningAll()
      .executeTakeFirst();

    if (!updated) return reply.status(404).send({ error: 'Club not found' });

    await db.insertInto('audit_log').values({
      club_id: club.id,
      actor_id: request.userId!,
      action: 'club.update',
      target_type: 'club',
      target_id: club.id,
      metadata: JSON.stringify(body),
    }).execute();

    const result = {
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      icon_url: updated.icon_key ? getPublicUrl(updated.icon_key) : null,
      owner_id: updated.owner_id,
    };

    await redis.publish(`club:${club.id}`, JSON.stringify({ op: 'club.update', d: result }));

    return result;
  });

  app.delete('/api/club/:clubId', { preHandler: requireAuth }, async (request, reply) => {
    const { clubId } = request.params as { clubId: string };
    const club = await resolveClub(db, clubId);
    if (!club) return reply.status(404).send({ error: 'Club not found' });
    if (club.owner_id !== request.userId) {
      return reply.status(403).send({ error: 'Only the club owner can delete it' });
    }
    const members = await db.selectFrom('memberships').select('user_id').where('club_id', '=', club.id).execute();
    const deleted = await db.deleteFrom('clubs').where('id', '=', club.id).executeTakeFirst();
    if (!deleted.numDeletedRows) return reply.status(500).send({ error: 'Failed to delete club' });
    for (const m of members) {
      await redis.publish(`user:${m.user_id}`, JSON.stringify({ op: 'club.remove', d: { club_id: club.id } }));
    }
    return { ok: true };
  });

  app.post('/api/club/:clubId/transfer', { preHandler: requireAuth }, async (request, reply) => {
    const { clubId } = request.params as { clubId: string };
    const { new_owner_id } = request.body as { new_owner_id: string };
    const club = await resolveClub(db, clubId);
    if (!club) return reply.status(404).send({ error: 'Club not found' });
    if (club.owner_id !== request.userId) {
      return reply.status(403).send({ error: 'Only the owner can transfer ownership' });
    }
    if (!new_owner_id) return reply.status(400).send({ error: 'new_owner_id is required' });

    const targetMember = await db.selectFrom('memberships').select('id')
      .where('user_id', '=', new_owner_id).where('club_id', '=', club.id).executeTakeFirst();
    if (!targetMember) return reply.status(400).send({ error: 'Target user is not a member' });

    const updated = await db
      .updateTable('clubs')
      .set({ owner_id: new_owner_id, updated_at: new Date() })
      .where('id', '=', club.id)
      .returningAll()
      .executeTakeFirstOrThrow();

    await db.insertInto('audit_log').values({
      club_id: club.id,
      actor_id: request.userId!,
      action: 'club.transfer',
      target_type: 'user',
      target_id: new_owner_id,
    }).execute();

    await redis.publish(`club:${club.id}`, JSON.stringify({
      op: 'club.update',
      d: {
        id: updated.id,
        name: updated.name,
        slug: updated.slug,
        icon_url: updated.icon_key ? getPublicUrl(updated.icon_key) : null,
        owner_id: updated.owner_id,
      },
    }));

    return { ok: true };
  });

  app.post('/api/club/:clubId/presign-icon', { preHandler: requireAuth }, async (request, reply) => {
    const { clubId } = request.params as { clubId: string };
    const { filename, content_type, size } = request.body as { filename: string; content_type: string; size: number };
    const club = await resolveClub(db, clubId);
    if (!club) return reply.status(404).send({ error: 'Club not found' });

    const perms = await computePermissions(db, request.userId!, club.id);
    if (!hasPermission(perms, Permissions.MANAGE_CLUB)) {
      return reply.status(403).send({ error: 'Missing MANAGE_CLUB permission' });
    }

    if (!filename || !content_type || !size) {
      return reply.status(400).send({ error: 'filename, content_type, and size required' });
    }
    if (size > 10 * 1024 * 1024) return reply.status(413).send({ error: 'Max 10MB' });

    const safeName = filename.replace(/[/\\]/g, '_').replace(/\.\./g, '_');
    const key = `clubs/${club.id}/icon/${nanoid()}/${safeName}`;
    const post = await getPresignedPost(config.minioBucket, key, 10 * 1024 * 1024);
    return { post_url: post.url, fields: post.fields, key, public_url: getPublicUrl(key) };
  });

  app.post('/api/clubs/presign-icon', { preHandler: requireAuth }, async (request, reply) => {
    const { filename, content_type, size } = request.body as { filename: string; content_type: string; size: number };
    if (!filename || !content_type || !size) {
      return reply.status(400).send({ error: 'filename, content_type, and size required' });
    }
    if (size > 10 * 1024 * 1024) return reply.status(413).send({ error: 'Max 10MB' });

    const safeName = filename.replace(/[/\\]/g, '_').replace(/\.\./g, '_');
    const key = `clubs/pending/${nanoid()}/icon/${safeName}`;
    const post = await getPresignedPost(config.minioBucket, key, 10 * 1024 * 1024);
    return { post_url: post.url, fields: post.fields, key, public_url: getPublicUrl(key) };
  });
}
