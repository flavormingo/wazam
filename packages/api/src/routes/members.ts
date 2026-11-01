import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database } from '../db/database.js';
import { createAuthMiddleware } from '../middleware.js';
import { computePermissions } from '../permissions.js';
import { Permissions, hasPermission } from '@wazam/shared';
import { getPublicUrl } from '../storage.js';
import type Redis from 'ioredis';

export function memberRoutes(app: FastifyInstance, db: Kysely<Database>, redis: Redis) {
  const requireAuth = createAuthMiddleware(db);

  app.get('/api/club/:clubId/members', { preHandler: requireAuth }, async (request, reply) => {
    const { clubId } = request.params as { clubId: string };

    const membership = await db
      .selectFrom('memberships')
      .select('id')
      .where('user_id', '=', request.userId!)
      .where('club_id', '=', clubId)
      .executeTakeFirst();

    if (!membership) return reply.status(403).send({ error: 'Not a member' });

    const members = await db
      .selectFrom('memberships')
      .innerJoin('users', 'users.id', 'memberships.user_id')
      .select([
        'memberships.id as membership_id',
        'memberships.nickname',
        'memberships.joined_at',
        'users.id',
        'users.email',
        'users.username',
        'users.avatar_key',
      ])
      .where('memberships.club_id', '=', clubId)
      .orderBy('memberships.joined_at')
      .execute();

    const membershipIds = members.map((m) => m.membership_id);
    const memberRoles = membershipIds.length
      ? await db
          .selectFrom('member_roles')
          .innerJoin('roles', 'roles.id', 'member_roles.role_id')
          .select([
            'member_roles.membership_id',
            'roles.id as role_id',
            'roles.name',
            'roles.permissions',
            'roles.position',
            'roles.is_default',
            'roles.color',
          ])
          .where('member_roles.membership_id', 'in', membershipIds)
          .execute()
      : [];

    const rolesByMembership = new Map<string, typeof memberRoles>();
    for (const mr of memberRoles) {
      const list = rolesByMembership.get(mr.membership_id) || [];
      list.push(mr);
      rolesByMembership.set(mr.membership_id, list);
    }

    return members.map((m) => ({
      id: m.membership_id,
      user: {
        id: m.id,
        name: m.username,
        avatar_url: m.avatar_key ? getPublicUrl(m.avatar_key) : null,
      },
      nickname: m.nickname,
      roles: (rolesByMembership.get(m.membership_id) || []).map((r) => ({
        id: r.role_id,
        name: r.name,
        permissions: r.permissions,
        position: r.position,
        is_default: r.is_default,
        color: r.color,
      })),
      joined_at: m.joined_at.toISOString(),
    }));
  });

  app.get('/api/club/:clubId/presence', { preHandler: requireAuth }, async (request, reply) => {
    const { clubId } = request.params as { clubId: string };

    const membership = await db
      .selectFrom('memberships')
      .select('id')
      .where('user_id', '=', request.userId!)
      .where('club_id', '=', clubId)
      .executeTakeFirst();

    if (!membership) return reply.status(403).send({ error: 'Not a member' });

    const members = await db
      .selectFrom('memberships')
      .select('user_id')
      .where('club_id', '=', clubId)
      .execute();

    const userIds = members.map((m) => m.user_id);
    if (userIds.length === 0) return {};

    const keys = userIds.map((id) => `presence:${id}`);
    const values = await redis.mget(...keys);

    const result: Record<string, string> = {};
    for (let i = 0; i < userIds.length; i++) {
      result[userIds[i]] = values[i] || 'offline';
    }

    return result;
  });

  app.delete('/api/club/:clubId/members/:userId', { preHandler: requireAuth }, async (request, reply) => {
    const { clubId, userId } = request.params as { clubId: string; userId: string };

    if (userId === request.userId) {
      const club = await db.selectFrom('clubs').select('owner_id').where('id', '=', clubId).executeTakeFirst();
      if (club?.owner_id === userId) {
        return reply.status(403).send({ error: 'Club owner cannot leave. Transfer ownership or delete the club.' });
      }

      const left = await db
        .deleteFrom('memberships')
        .where('user_id', '=', userId)
        .where('club_id', '=', clubId)
        .executeTakeFirst();

      if (!left.numDeletedRows) return reply.status(404).send({ error: 'Not a member of this club' });

      const event = JSON.stringify({ op: 'member.leave', d: { club_id: clubId, user_id: userId } });
      await redis.publish(`club:${clubId}`, event);
      return { ok: true };
    }

    const perms = await computePermissions(db, request.userId!, clubId);
    if (!hasPermission(perms, Permissions.KICK_MEMBERS)) {
      return reply.status(403).send({ error: 'Missing KICK_MEMBERS permission' });
    }

    const club = await db.selectFrom('clubs').select('owner_id').where('id', '=', clubId).executeTakeFirst();
    if (club?.owner_id === userId) {
      return reply.status(403).send({ error: 'Cannot kick the club owner' });
    }

    const kicked = await db
      .deleteFrom('memberships')
      .where('user_id', '=', userId)
      .where('club_id', '=', clubId)
      .executeTakeFirst();

    if (!kicked.numDeletedRows) return reply.status(404).send({ error: 'User is not a member' });

    await db.insertInto('audit_log').values({
      club_id: clubId,
      actor_id: request.userId!,
      action: 'member.kick',
      target_type: 'user',
      target_id: userId,
    }).execute();

    const event = JSON.stringify({ op: 'member.leave', d: { club_id: clubId, user_id: userId } });
    await redis.publish(`club:${clubId}`, event);
    await redis.publish(`user:${userId}`, JSON.stringify({ op: 'club.remove', d: { club_id: clubId } }));

    return { ok: true };
  });

  app.post('/api/club/:clubId/bans', { preHandler: requireAuth }, async (request, reply) => {
    const { clubId } = request.params as { clubId: string };
    const { user_id, reason } = request.body as { user_id: string; reason?: string };

    const perms = await computePermissions(db, request.userId!, clubId);
    if (!hasPermission(perms, Permissions.BAN_MEMBERS)) {
      return reply.status(403).send({ error: 'Missing BAN_MEMBERS permission' });
    }

    if (!user_id) return reply.status(400).send({ error: 'user_id required' });
    if (user_id === request.userId) return reply.status(400).send({ error: 'Cannot ban yourself' });

    const targetUser = await db.selectFrom('users').select('id').where('id', '=', user_id).executeTakeFirst();
    if (!targetUser) return reply.status(404).send({ error: 'User not found' });

    const club = await db.selectFrom('clubs').select('owner_id').where('id', '=', clubId).executeTakeFirst();
    if (club?.owner_id === user_id) {
      return reply.status(403).send({ error: 'Cannot ban the club owner' });
    }

    const existingBan = await db.selectFrom('bans').select('id').where('club_id', '=', clubId).where('user_id', '=', user_id).executeTakeFirst();
    if (existingBan) return reply.status(409).send({ error: 'User is already banned' });

    await db.deleteFrom('memberships').where('user_id', '=', user_id).where('club_id', '=', clubId).execute();

    await db.insertInto('bans').values({
      club_id: clubId,
      user_id,
      reason: reason ?? null,
      banned_by: request.userId!,
    }).execute();

    await db.insertInto('audit_log').values({
      club_id: clubId,
      actor_id: request.userId!,
      action: 'member.ban',
      target_type: 'user',
      target_id: user_id,
      metadata: JSON.stringify({ reason }),
    }).execute();

    const event = JSON.stringify({ op: 'member.leave', d: { club_id: clubId, user_id } });
    await redis.publish(`club:${clubId}`, event);
    await redis.publish(`user:${user_id}`, JSON.stringify({ op: 'club.remove', d: { club_id: clubId } }));

    return reply.status(201).send({ ok: true });
  });

  app.delete('/api/club/:clubId/bans/:userId', { preHandler: requireAuth }, async (request, reply) => {
    const { clubId, userId } = request.params as { clubId: string; userId: string };

    const perms = await computePermissions(db, request.userId!, clubId);
    if (!hasPermission(perms, Permissions.BAN_MEMBERS)) {
      return reply.status(403).send({ error: 'Missing BAN_MEMBERS permission' });
    }

    const unbanned = await db.deleteFrom('bans').where('club_id', '=', clubId).where('user_id', '=', userId).executeTakeFirst();
    if (!unbanned.numDeletedRows) return reply.status(404).send({ error: 'Ban not found' });

    await db.insertInto('audit_log').values({
      club_id: clubId,
      actor_id: request.userId!,
      action: 'member.unban',
      target_type: 'user',
      target_id: userId,
    }).execute();

    return { ok: true };
  });

  app.get('/api/club/:clubId/bans', { preHandler: requireAuth }, async (request, reply) => {
    const { clubId } = request.params as { clubId: string };

    const perms = await computePermissions(db, request.userId!, clubId);
    if (!hasPermission(perms, Permissions.BAN_MEMBERS)) {
      return reply.status(403).send({ error: 'Missing BAN_MEMBERS permission' });
    }

    const bans = await db
      .selectFrom('bans')
      .innerJoin('users', 'users.id', 'bans.user_id')
      .select([
        'bans.id',
        'bans.reason',
        'bans.created_at',
        'users.id as user_id',
        'users.username as name',
      ])
      .where('bans.club_id', '=', clubId)
      .execute();

    return bans;
  });
}
