import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database } from '../db/database.js';
import { createAuthMiddleware } from '../middleware.js';
import { computePermissions } from '../permissions.js';
import { Permissions, hasPermission } from '@wazam/shared';
import type Redis from 'ioredis';

export function channelRoutes(app: FastifyInstance, db: Kysely<Database>, redis: Redis) {
  const requireAuth = createAuthMiddleware(db);

  app.get('/api/club/:clubId/channel', { preHandler: requireAuth }, async (request, reply) => {
    const { clubId } = request.params as { clubId: string };

    const membership = await db
      .selectFrom('memberships')
      .select('id')
      .where('user_id', '=', request.userId!)
      .where('club_id', '=', clubId)
      .executeTakeFirst();

    if (!membership) {
      return reply.status(403).send({ error: 'Not a member' });
    }

    const channels = await db
      .selectFrom('channels')
      .selectAll()
      .where('club_id', '=', clubId)
      .orderBy('position')
      .execute();

    const channelIds = channels.map(c => c.id);
    const reads = channelIds.length
      ? await db
          .selectFrom('channel_reads')
          .select(['channel_id', 'last_read_at'])
          .where('user_id', '=', request.userId!)
          .where('channel_id', 'in', channelIds)
          .execute()
      : [];
    const readMap = new Map(reads.map(r => [r.channel_id, r.last_read_at]));

    return channels.map((c) => ({
      id: c.id,
      club_id: c.club_id,
      name: c.name,
      type: c.type,
      position: c.position,
      section_id: c.section_id,
      last_message_at: c.last_message_at?.toISOString() ?? null,
      last_read_at: readMap.get(c.id)?.toISOString() ?? null,
    }));
  });

  app.post('/api/club/:clubId/channel', { preHandler: requireAuth }, async (request, reply) => {
    const { clubId } = request.params as { clubId: string };
    const { name, type = 'text', section_id } = request.body as { name: string; type?: 'text' | 'voice'; section_id?: string };

    const perms = await computePermissions(db, request.userId!, clubId);
    if (!hasPermission(perms, Permissions.MANAGE_CHANNELS)) {
      return reply.status(403).send({ error: 'Missing MANAGE_CHANNELS permission' });
    }

    const trimmedName = name?.trim();
    if (!trimmedName || trimmedName.length > 100) {
      return reply.status(400).send({ error: 'Name is required (max 100 chars)' });
    }

    if (type !== 'text' && type !== 'voice') {
      return reply.status(400).send({ error: 'Type must be text or voice' });
    }

    let validSectionId: string | null = null;
    if (section_id) {
      const section = await db.selectFrom('sections').select('id').where('id', '=', section_id).where('club_id', '=', clubId).executeTakeFirst();
      if (!section) return reply.status(400).send({ error: 'Section not found in this club' });
      validSectionId = section_id;
    }

    const last = await db
      .selectFrom('channels')
      .select('position')
      .where('club_id', '=', clubId)
      .orderBy('position', 'desc')
      .executeTakeFirst();

    const position = (last?.position ?? -1) + 1;

    const channel = await db
      .insertInto('channels')
      .values({ club_id: clubId, name: trimmedName, type, position, section_id: validSectionId })
      .returningAll()
      .executeTakeFirstOrThrow();

    await db.insertInto('audit_log').values({
      club_id: clubId,
      actor_id: request.userId!,
      action: 'channel.create',
      target_type: 'channel',
      target_id: channel.id,
      metadata: JSON.stringify({ name, type }),
    }).execute();

    const event = JSON.stringify({
      op: 'channel.create',
      d: { id: channel.id, club_id: clubId, name: channel.name, type: channel.type, position: channel.position, section_id: channel.section_id },
    });
    await redis.publish(`club:${clubId}`, event);

    return reply.status(201).send({
      id: channel.id,
      club_id: channel.club_id,
      name: channel.name,
      type: channel.type,
      position: channel.position,
      section_id: channel.section_id,
    });
  });

  app.patch('/api/club/:clubId/channel/:channelId', { preHandler: requireAuth }, async (request, reply) => {
    const { clubId, channelId } = request.params as { clubId: string; channelId: string };
    const body = request.body as { name?: string; position?: number; section_id?: string | null };

    const perms = await computePermissions(db, request.userId!, clubId);
    if (!hasPermission(perms, Permissions.MANAGE_CHANNELS)) {
      return reply.status(403).send({ error: 'Missing MANAGE_CHANNELS permission' });
    }

    const trimmedName = body.name?.trim();
    if (body.name !== undefined && (!trimmedName || trimmedName.length > 100)) {
      return reply.status(400).send({ error: 'Name is required (max 100 chars)' });
    }

    if (body.section_id !== undefined && body.section_id !== null) {
      const section = await db.selectFrom('sections').select('id').where('id', '=', body.section_id).where('club_id', '=', clubId).executeTakeFirst();
      if (!section) return reply.status(400).send({ error: 'Section not found in this club' });
    }

    const updates: Record<string, unknown> = { updated_at: new Date() };
    if (trimmedName) updates.name = trimmedName;
    if (body.position !== undefined) updates.position = body.position;
    if (body.section_id !== undefined) updates.section_id = body.section_id;

    const channel = await db
      .updateTable('channels')
      .set(updates)
      .where('id', '=', channelId)
      .where('club_id', '=', clubId)
      .returningAll()
      .executeTakeFirst();

    if (!channel) {
      return reply.status(404).send({ error: 'Channel not found' });
    }

    await db.insertInto('audit_log').values({
      club_id: clubId,
      actor_id: request.userId!,
      action: 'channel.update',
      target_type: 'channel',
      target_id: channelId,
      metadata: JSON.stringify(body),
    }).execute();

    const event = JSON.stringify({
      op: 'channel.update',
      d: { id: channel.id, club_id: clubId, name: channel.name, type: channel.type, position: channel.position, section_id: channel.section_id },
    });
    await redis.publish(`club:${clubId}`, event);

    return { id: channel.id, club_id: channel.club_id, name: channel.name, type: channel.type, position: channel.position, section_id: channel.section_id };
  });

  app.delete('/api/club/:clubId/channel/:channelId', { preHandler: requireAuth }, async (request, reply) => {
    const { clubId, channelId } = request.params as { clubId: string; channelId: string };

    const perms = await computePermissions(db, request.userId!, clubId);
    if (!hasPermission(perms, Permissions.MANAGE_CHANNELS)) {
      return reply.status(403).send({ error: 'Missing MANAGE_CHANNELS permission' });
    }

    const deleted = await db
      .deleteFrom('channels')
      .where('id', '=', channelId)
      .where('club_id', '=', clubId)
      .executeTakeFirst();

    if (!deleted.numDeletedRows) {
      return reply.status(404).send({ error: 'Channel not found' });
    }

    await db.insertInto('audit_log').values({
      club_id: clubId,
      actor_id: request.userId!,
      action: 'channel.delete',
      target_type: 'channel',
      target_id: channelId,
    }).execute();

    const event = JSON.stringify({ op: 'channel.delete', d: { id: channelId, club_id: clubId } });
    await redis.publish(`club:${clubId}`, event);

    return { ok: true };
  });
}
