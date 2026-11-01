import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database } from '../db/database.js';
import { createAuthMiddleware } from '../middleware.js';
import { computePermissions } from '../permissions.js';
import { Permissions, hasPermission } from '@wazam/shared';
import type Redis from 'ioredis';

export function sectionRoutes(app: FastifyInstance, db: Kysely<Database>, redis: Redis) {
  const requireAuth = createAuthMiddleware(db);

  app.get('/api/club/:clubId/section', { preHandler: requireAuth }, async (request, reply) => {
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

    const sections = await db
      .selectFrom('sections')
      .selectAll()
      .where('club_id', '=', clubId)
      .orderBy('position')
      .execute();

    return sections.map((s) => ({
      id: s.id,
      club_id: s.club_id,
      name: s.name,
      position: s.position,
    }));
  });

  app.post('/api/club/:clubId/section', { preHandler: requireAuth }, async (request, reply) => {
    const { clubId } = request.params as { clubId: string };
    const { name } = request.body as { name: string };

    const perms = await computePermissions(db, request.userId!, clubId);
    if (!hasPermission(perms, Permissions.MANAGE_CHANNELS)) {
      return reply.status(403).send({ error: 'Missing MANAGE_CHANNELS permission' });
    }

    const trimmedName = name?.trim();
    if (!trimmedName || trimmedName.length > 100) {
      return reply.status(400).send({ error: 'Name is required (max 100 chars)' });
    }

    const last = await db
      .selectFrom('sections')
      .select('position')
      .where('club_id', '=', clubId)
      .orderBy('position', 'desc')
      .executeTakeFirst();

    const position = (last?.position ?? -1) + 1;

    const section = await db
      .insertInto('sections')
      .values({ club_id: clubId, name: trimmedName, position })
      .returningAll()
      .executeTakeFirstOrThrow();

    await db.insertInto('audit_log').values({
      club_id: clubId,
      actor_id: request.userId!,
      action: 'section.create',
      target_type: 'section',
      target_id: section.id,
      metadata: JSON.stringify({ name: trimmedName }),
    }).execute();

    const event = JSON.stringify({
      op: 'section.create',
      d: { id: section.id, club_id: clubId, name: section.name, position: section.position },
    });
    await redis.publish(`club:${clubId}`, event);

    return reply.status(201).send({
      id: section.id,
      club_id: section.club_id,
      name: section.name,
      position: section.position,
    });
  });

  app.patch('/api/club/:clubId/section/:sectionId', { preHandler: requireAuth }, async (request, reply) => {
    const { clubId, sectionId } = request.params as { clubId: string; sectionId: string };
    const body = request.body as { name?: string; position?: number };

    const perms = await computePermissions(db, request.userId!, clubId);
    if (!hasPermission(perms, Permissions.MANAGE_CHANNELS)) {
      return reply.status(403).send({ error: 'Missing MANAGE_CHANNELS permission' });
    }

    const trimmedName = body.name?.trim();
    if (body.name !== undefined && (!trimmedName || trimmedName.length > 100)) {
      return reply.status(400).send({ error: 'Name is required (max 100 chars)' });
    }

    const updates: Record<string, unknown> = { updated_at: new Date() };
    if (trimmedName) updates.name = trimmedName;
    if (body.position !== undefined) updates.position = body.position;

    const section = await db
      .updateTable('sections')
      .set(updates)
      .where('id', '=', sectionId)
      .where('club_id', '=', clubId)
      .returningAll()
      .executeTakeFirst();

    if (!section) {
      return reply.status(404).send({ error: 'Section not found' });
    }

    await db.insertInto('audit_log').values({
      club_id: clubId,
      actor_id: request.userId!,
      action: 'section.update',
      target_type: 'section',
      target_id: sectionId,
      metadata: JSON.stringify(body),
    }).execute();

    const event = JSON.stringify({
      op: 'section.update',
      d: { id: section.id, club_id: clubId, name: section.name, position: section.position },
    });
    await redis.publish(`club:${clubId}`, event);

    return { id: section.id, club_id: section.club_id, name: section.name, position: section.position };
  });

  app.delete('/api/club/:clubId/section/:sectionId', { preHandler: requireAuth }, async (request, reply) => {
    const { clubId, sectionId } = request.params as { clubId: string; sectionId: string };

    const perms = await computePermissions(db, request.userId!, clubId);
    if (!hasPermission(perms, Permissions.MANAGE_CHANNELS)) {
      return reply.status(403).send({ error: 'Missing MANAGE_CHANNELS permission' });
    }

    await db
      .updateTable('channels')
      .set({ section_id: null, updated_at: new Date() })
      .where('section_id', '=', sectionId)
      .where('club_id', '=', clubId)
      .execute();

    const deleted = await db
      .deleteFrom('sections')
      .where('id', '=', sectionId)
      .where('club_id', '=', clubId)
      .executeTakeFirst();

    if (!deleted.numDeletedRows) {
      return reply.status(404).send({ error: 'Section not found' });
    }

    await db.insertInto('audit_log').values({
      club_id: clubId,
      actor_id: request.userId!,
      action: 'section.delete',
      target_type: 'section',
      target_id: sectionId,
    }).execute();

    const event = JSON.stringify({ op: 'section.delete', d: { id: sectionId, club_id: clubId } });
    await redis.publish(`club:${clubId}`, event);

    return { ok: true };
  });
}
