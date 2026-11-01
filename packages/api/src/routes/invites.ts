import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Database } from '../db/database.js';
import { createAuthMiddleware } from '../middleware.js';
import { createOptionalAuthMiddleware } from '../middleware.js';
import { computePermissions } from '../permissions.js';
import { Permissions, hasPermission } from '@wazam/shared';
import { nanoid } from 'nanoid';
import { getPublicUrl } from '../storage.js';
import { DEFAULT_PERMISSIONS } from '@wazam/shared';
import { config } from '../config.js';
import type Redis from 'ioredis';

export function inviteRoutes(app: FastifyInstance, db: Kysely<Database>, redis: Redis) {
  const requireAuth = createAuthMiddleware(db);

  app.post('/api/club/:clubId/invites', { preHandler: requireAuth }, async (request, reply) => {
    const { clubId } = request.params as { clubId: string };
    const { max_uses, expires_in_hours } = request.body as {
      max_uses?: number;
      expires_in_hours?: number;
    };

    const perms = await computePermissions(db, request.userId!, clubId);
    if (!hasPermission(perms, Permissions.CREATE_INVITE)) {
      return reply.status(403).send({ error: 'Missing CREATE_INVITE permission' });
    }

    if (max_uses !== undefined && (max_uses < 1 || !Number.isInteger(max_uses))) {
      return reply.status(400).send({ error: 'max_uses must be a positive integer' });
    }
    if (expires_in_hours !== undefined && (expires_in_hours < 1 || expires_in_hours > 720)) {
      return reply.status(400).send({ error: 'expires_in_hours must be between 1 and 720' });
    }

    const code = nanoid(8);
    const expiresAt = expires_in_hours
      ? new Date(Date.now() + expires_in_hours * 60 * 60 * 1000)
      : null;

    const invite = await db
      .insertInto('invites')
      .values({
        club_id: clubId,
        creator_id: request.userId!,
        code,
        max_uses: max_uses ?? null,
        expires_at: expiresAt,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await db.insertInto('audit_log').values({
      club_id: clubId,
      actor_id: request.userId!,
      action: 'invite.create',
      target_type: 'invite',
      target_id: invite.id,
      metadata: JSON.stringify({ code, max_uses, expires_in_hours }),
    }).execute();

    const club = await db.selectFrom('clubs').selectAll().where('id', '=', clubId).executeTakeFirst();

    return reply.status(201).send({
      id: invite.id,
      code: invite.code,
      club: club ? { id: club.id, name: club.name, icon_url: club.icon_key ? getPublicUrl(club.icon_key) : null } : null,
      max_uses: invite.max_uses,
      uses: invite.uses,
      expires_at: invite.expires_at?.toISOString() ?? null,
      created_at: invite.created_at.toISOString(),
    });
  });

  app.get('/api/club/:clubId/invites', { preHandler: requireAuth }, async (request, reply) => {
    const { clubId } = request.params as { clubId: string };

    const perms = await computePermissions(db, request.userId!, clubId);
    if (!hasPermission(perms, Permissions.MANAGE_CLUB)) {
      return reply.status(403).send({ error: 'Missing MANAGE_CLUB permission' });
    }

    const invites = await db
      .selectFrom('invites')
      .leftJoin('users', 'users.id', 'invites.creator_id')
      .select([
        'invites.id',
        'invites.code',
        'invites.max_uses',
        'invites.uses',
        'invites.expires_at',
        'invites.created_at',
        'users.id as creator_id',
        'users.username',
      ])
      .where('invites.club_id', '=', clubId)
      .orderBy('invites.created_at', 'desc')
      .execute();

    return invites.map((i) => ({
      id: i.id,
      code: i.code,
      creator: { id: i.creator_id ?? 'deleted', name: i.username ?? 'deleted user' },
      max_uses: i.max_uses,
      uses: i.uses,
      expires_at: i.expires_at?.toISOString() ?? null,
      created_at: i.created_at.toISOString(),
    }));
  });

  app.delete('/api/club/:clubId/invites/:inviteId', { preHandler: requireAuth }, async (request, reply) => {
    const { clubId, inviteId } = request.params as { clubId: string; inviteId: string };

    const perms = await computePermissions(db, request.userId!, clubId);
    if (!hasPermission(perms, Permissions.MANAGE_CLUB)) {
      return reply.status(403).send({ error: 'Missing MANAGE_CLUB permission' });
    }

    const deleted = await db.deleteFrom('invites').where('id', '=', inviteId).where('club_id', '=', clubId).executeTakeFirst();
    if (!deleted.numDeletedRows) return reply.status(404).send({ error: 'Invite not found' });

    await db.insertInto('audit_log').values({
      club_id: clubId,
      actor_id: request.userId!,
      action: 'invite.revoke',
      target_type: 'invite',
      target_id: inviteId,
    }).execute();

    return { ok: true };
  });

  app.post('/api/invites/:code/accept', { preHandler: requireAuth }, async (request, reply) => {
    const { code } = request.params as { code: string };

    const invite = await db
      .selectFrom('invites')
      .selectAll()
      .where('code', '=', code)
      .executeTakeFirst();

    if (!invite) return reply.status(404).send({ error: 'Invite not found' });

    if (invite.expires_at && invite.expires_at < new Date()) {
      return reply.status(410).send({ error: 'Invite has expired' });
    }

    const ban = await db
      .selectFrom('bans')
      .select('id')
      .where('club_id', '=', invite.club_id)
      .where('user_id', '=', request.userId!)
      .executeTakeFirst();

    if (ban) return reply.status(403).send({ error: 'You are banned from this club' });

    let newMembership: { id: string };
    try {
      newMembership = await db.transaction().execute(async (trx) => {
        const existing = await trx
          .selectFrom('memberships')
          .select('id')
          .where('user_id', '=', request.userId!)
          .where('club_id', '=', invite.club_id)
          .executeTakeFirst();
        if (existing) throw new Error('ALREADY_MEMBER');

        const usedUpdate = await trx
          .updateTable('invites')
          .set((eb) => ({ uses: eb('uses', '+', 1) }))
          .where('id', '=', invite.id)
          .where((eb) => eb.or([eb('max_uses', 'is', null), eb('uses', '<', eb.ref('max_uses'))]))
          .executeTakeFirst();
        if (!usedUpdate.numUpdatedRows) throw new Error('EXHAUSTED');

        const membership = await trx
          .insertInto('memberships')
          .values({ user_id: request.userId!, club_id: invite.club_id })
          .onConflict((oc) => oc.columns(['user_id', 'club_id']).doNothing())
          .returningAll()
          .executeTakeFirst();
        if (!membership) throw new Error('ALREADY_MEMBER');

        const clubChannels = await trx
          .selectFrom('channels')
          .select('id')
          .where('club_id', '=', invite.club_id)
          .execute();
        if (clubChannels.length > 0) {
          await trx.insertInto('channel_reads')
            .values(clubChannels.map((c) => ({
              user_id: request.userId!,
              channel_id: c.id,
              last_read_at: new Date(),
            })))
            .onConflict((oc) => oc.doNothing())
            .execute();
        }

        return membership;
      });
    } catch (e: any) {
      if (e?.message === 'EXHAUSTED') return reply.status(410).send({ error: 'Invite has reached max uses' });
      if (e?.message === 'ALREADY_MEMBER') return reply.status(409).send({ error: 'Already a member' });
      throw e;
    }

    const user = request.user!;
    const event = JSON.stringify({
      op: 'member.join',
      d: {
        club_id: invite.club_id,
        member: {
          id: newMembership.id,
          user: {
            id: user.id,
            name: user.username,
            avatar_url: user.avatar_key ? getPublicUrl(user.avatar_key) : null,
          },
          nickname: null,
          roles: [],
          joined_at: new Date().toISOString(),
        },
      },
    });
    await redis.publish(`club:${invite.club_id}`, event);

    const club = await db.selectFrom('clubs').selectAll().where('id', '=', invite.club_id).executeTakeFirst();

    if (club) {
      await redis.publish(`user:${request.userId}`, JSON.stringify({
        op: 'club.add',
        d: {
          id: club.id,
          name: club.name,
          slug: club.slug,
          icon_url: club.icon_key ? getPublicUrl(club.icon_key) : null,
          owner_id: club.owner_id,
        },
      }));
    }

    return {
      club: club ? { id: club.id, name: club.name, icon_url: club.icon_key ? getPublicUrl(club.icon_key) : null } : null,
    };
  });

  app.post('/api/club/:clubId/invites/dm', { preHandler: requireAuth }, async (request, reply) => {
    const { clubId } = request.params as { clubId: string };
    const { user_id } = request.body as { user_id: string };

    if (!user_id) return reply.status(400).send({ error: 'user_id required' });

    const perms = await computePermissions(db, request.userId!, clubId);
    if (!hasPermission(perms, Permissions.CREATE_INVITE)) {
      return reply.status(403).send({ error: 'Missing CREATE_INVITE permission' });
    }

    const targetUser = await db
      .selectFrom('users')
      .select('id')
      .where('id', '=', user_id)
      .executeTakeFirst();
    if (!targetUser) return reply.status(404).send({ error: 'User not found' });

    const existingMember = await db
      .selectFrom('memberships')
      .select('id')
      .where('user_id', '=', user_id)
      .where('club_id', '=', clubId)
      .executeTakeFirst();
    if (existingMember) return reply.status(409).send({ error: 'User is already a member' });

    const code = nanoid(8);
    await db
      .insertInto('invites')
      .values({
        club_id: clubId,
        creator_id: request.userId!,
        code,
        max_uses: 1,
      })
      .execute();

    const club = await db
      .selectFrom('clubs')
      .select('name')
      .where('id', '=', clubId)
      .executeTakeFirstOrThrow();

    const lockKey = [request.userId!, user_id].sort().join(':');
    const dmOutcome = await db.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`.execute(trx);
      const existingDm = await trx
        .selectFrom('dm_channels')
        .innerJoin('dm_members as m1', (join) =>
          join.onRef('m1.dm_channel_id', '=', 'dm_channels.id').on('m1.user_id', '=', request.userId!),
        )
        .innerJoin('dm_members as m2', (join) =>
          join.onRef('m2.dm_channel_id', '=', 'dm_channels.id').on('m2.user_id', '=', user_id),
        )
        .select('dm_channels.id')
        .where('dm_channels.type', '=', 'direct')
        .executeTakeFirst();
      if (existingDm) return { dmChannelId: existingDm.id, created: false };
      const channel = await trx
        .insertInto('dm_channels')
        .values({ type: 'direct', owner_id: null })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx.insertInto('dm_members').values({ dm_channel_id: channel.id, user_id: request.userId! }).execute();
      await trx.insertInto('dm_members').values({ dm_channel_id: channel.id, user_id }).execute();
      return { dmChannelId: channel.id, created: true };
    });
    const dmChannelId = dmOutcome.dmChannelId;

    if (dmOutcome.created) {
      const members = await db
        .selectFrom('dm_members')
        .innerJoin('users', 'users.id', 'dm_members.user_id')
        .select(['users.id', 'users.username', 'users.avatar_key'])
        .where('dm_members.dm_channel_id', '=', dmChannelId)
        .execute();
      const ch = await db.selectFrom('dm_channels').selectAll().where('id', '=', dmChannelId).executeTakeFirstOrThrow();
      const apiChannel = {
        id: dmChannelId,
        type: 'direct',
        name: null,
        members: members.map((u) => ({
          id: u.id,
          name: u.username,
          avatar_url: u.avatar_key ? getPublicUrl(u.avatar_key) : null,
        })),
        last_message: null,
        updated_at: ch.updated_at.toISOString(),
      };
      for (const uid of [request.userId!, user_id]) {
        await redis.publish(`user:${uid}`, JSON.stringify({ op: 'dm.channel.create', d: apiChannel }));
      }
    }

    const inviteUrl = `${config.webUrl}/invite/${code}`;
    const content = `join ${club.name}! ${inviteUrl}`;

    const message = await db
      .insertInto('dm_messages')
      .values({
        dm_channel_id: dmChannelId,
        author_id: request.userId!,
        content,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await Promise.all([
      db.updateTable('dm_channels')
        .set({ updated_at: new Date() })
        .where('id', '=', dmChannelId)
        .execute(),
      db.updateTable('dm_members')
        .set({ last_read_at: message.created_at })
        .where('dm_channel_id', '=', dmChannelId)
        .where('user_id', '=', request.userId!)
        .execute(),
    ]);

    const user = request.user!;
    const apiMessage = {
      id: message.id,
      dm_channel_id: message.dm_channel_id,
      author: {
        id: user.id,
        name: user.username,
        avatar_url: user.avatar_key ? getPublicUrl(user.avatar_key) : null,
      },
      content: message.content,
      edited_at: null,
      deleted: false,
      created_at: message.created_at.toISOString(),
    };

    await redis.publish(`dm:${dmChannelId}`, JSON.stringify({ op: 'dm.message.create', d: apiMessage }));

    return { ok: true };
  });

  app.get('/api/invites/:code', { preHandler: createOptionalAuthMiddleware(db) }, async (request, reply) => {
    const { code } = request.params as { code: string };

    const invite = await db
      .selectFrom('invites')
      .innerJoin('clubs', 'clubs.id', 'invites.club_id')
      .select([
        'invites.id',
        'invites.code',
        'invites.expires_at',
        'clubs.id as club_id',
        'clubs.name as club_name',
        'clubs.icon_key',
      ])
      .where('invites.code', '=', code)
      .executeTakeFirst();

    if (!invite) return reply.status(404).send({ error: 'Invite not found' });

    if (invite.expires_at && invite.expires_at < new Date()) {
      return reply.status(410).send({ error: 'Invite has expired' });
    }

    const memberCount = await db
      .selectFrom('memberships')
      .select(db.fn.countAll().as('count'))
      .where('club_id', '=', invite.club_id)
      .executeTakeFirstOrThrow();

    return {
      code: invite.code,
      club: {
        id: invite.club_id,
        name: invite.club_name,
        icon_url: invite.icon_key ? getPublicUrl(invite.icon_key) : null,
        member_count: Number(memberCount.count),
      },
    };
  });
}
