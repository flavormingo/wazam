import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database } from '../db/database.js';
import { createAuthMiddleware } from '../middleware.js';
import { computePermissions } from '../permissions.js';
import { Permissions, hasPermission } from '@wazam/shared';
import { getPublicUrl } from '../storage.js';

export function auditRoutes(app: FastifyInstance, db: Kysely<Database>) {
  const requireAuth = createAuthMiddleware(db);

  app.get('/api/club/:clubId/audit-log', { preHandler: requireAuth }, async (request, reply) => {
    const { clubId } = request.params as { clubId: string };
    const { before, limit = '50' } = request.query as { before?: string; limit?: string };

    const perms = await computePermissions(db, request.userId!, clubId);
    if (!hasPermission(perms, Permissions.VIEW_AUDIT_LOG)) {
      return reply.status(403).send({ error: 'Missing VIEW_AUDIT_LOG permission' });
    }

    let query = db
      .selectFrom('audit_log')
      .leftJoin('users', 'users.id', 'audit_log.actor_id')
      .select([
        'audit_log.id',
        'audit_log.action',
        'audit_log.target_type',
        'audit_log.target_id',
        'audit_log.metadata',
        'audit_log.created_at',
        'users.id as actor_id',
        'users.email',
        'users.username',
        'users.avatar_key',
      ])
      .where('audit_log.club_id', '=', clubId)
      .orderBy('audit_log.created_at', 'desc')
      .limit(Math.max(1, Math.min(Number.isFinite(parseInt(limit)) ? parseInt(limit) : 50, 100)));

    if (before) {
      const beforeDate = new Date(before);
      if (isNaN(beforeDate.getTime())) return reply.status(400).send({ error: 'Invalid before date' });
      query = query.where('audit_log.created_at', '<', beforeDate);
    }

    const entries = await query.execute();

    return entries.map((e) => ({
      id: e.id,
      actor: {
        id: e.actor_id ?? 'deleted',
        name: e.username ?? 'deleted user',
        avatar_url: e.avatar_key ? getPublicUrl(e.avatar_key) : null,
      },
      action: e.action,
      target_type: e.target_type,
      target_id: e.target_id,
      metadata: e.metadata,
      created_at: e.created_at.toISOString(),
    }));
  });
}
