import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { VALENTINO_ID, VALENTINO_USERNAME, VALENTINO_AVATAR_KEY } from '@wazam/shared';
import type { Database, FriendshipRow } from '../db/database.js';
import { createAuthMiddleware } from '../middleware.js';
import { getPublicUrl } from '../storage.js';
import { befriendValentino } from '../valentino.js';
import type Redis from 'ioredis';

function toApiUser(u: { id: string; email: string; username: string; avatar_key: string | null }) {
  return {
    id: u.id,
    name: u.username,
    avatar_url: u.avatar_key ? getPublicUrl(u.avatar_key) : null,
  };
}

export function friendRoutes(app: FastifyInstance, db: Kysely<Database>, redis: Redis) {
  const requireAuth = createAuthMiddleware(db);

  app.get('/api/friends', { preHandler: requireAuth }, async (request) => {
    const userId = request.userId!;

    const friendships = await db
      .selectFrom('friendships')
      .innerJoin('users', (join) =>
        join.on((eb) =>
          eb.or([
            eb.and([
              eb('friendships.requester_id', '=', userId),
              eb('users.id', '=', eb.ref('friendships.addressee_id')),
            ]),
            eb.and([
              eb('friendships.addressee_id', '=', userId),
              eb('users.id', '=', eb.ref('friendships.requester_id')),
            ]),
          ]),
        ),
      )
      .select([
        'friendships.id',
        'friendships.status',
        'friendships.created_at',
        'users.id as user_id',
        'users.email as user_email',
        'users.username as user_username',
        'users.avatar_key as user_avatar_key',
      ])
      .where('friendships.status', '=', 'accepted')
      .where((eb) =>
        eb.or([
          eb('friendships.requester_id', '=', userId),
          eb('friendships.addressee_id', '=', userId),
        ]),
      )
      .execute();

    return friendships.map((f) => ({
      id: f.id,
      user: toApiUser({
        id: f.user_id,
        email: f.user_email,
        username: f.user_username,
        avatar_key: f.user_avatar_key,
      }),
      status: f.status,
      created_at: f.created_at.toISOString(),
    }));
  });

  app.get('/api/friends/pending', { preHandler: requireAuth }, async (request) => {
    const userId = request.userId!;

    const pending = await db
      .selectFrom('friendships')
      .innerJoin('users', (join) =>
        join.on((eb) =>
          eb.or([
            eb.and([
              eb('friendships.requester_id', '=', userId),
              eb('users.id', '=', eb.ref('friendships.addressee_id')),
            ]),
            eb.and([
              eb('friendships.addressee_id', '=', userId),
              eb('users.id', '=', eb.ref('friendships.requester_id')),
            ]),
          ]),
        ),
      )
      .select([
        'friendships.id',
        'friendships.requester_id',
        'friendships.addressee_id',
        'friendships.status',
        'friendships.created_at',
        'users.id as user_id',
        'users.email as user_email',
        'users.username as user_username',
        'users.avatar_key as user_avatar_key',
      ])
      .where('friendships.status', '=', 'pending')
      .where((eb) =>
        eb.or([
          eb('friendships.requester_id', '=', userId),
          eb('friendships.addressee_id', '=', userId),
        ]),
      )
      .execute();

    const incoming = pending
      .filter((f) => f.addressee_id === userId)
      .map((f) => ({
        id: f.id,
        user: toApiUser({
          id: f.user_id,
          email: f.user_email,
          username: f.user_username,

          avatar_key: f.user_avatar_key,
        }),
        status: f.status,
        created_at: f.created_at.toISOString(),
      }));

    const outgoing = pending
      .filter((f) => f.requester_id === userId)
      .map((f) => ({
        id: f.id,
        user: toApiUser({
          id: f.user_id,
          email: f.user_email,
          username: f.user_username,

          avatar_key: f.user_avatar_key,
        }),
        status: f.status,
        created_at: f.created_at.toISOString(),
      }));

    return { incoming, outgoing };
  });

  app.post('/api/friends/request', { preHandler: requireAuth }, async (request, reply) => {
    const { name } = request.body as { name: string };
    if (!name || !name.trim()) {
      return reply.status(400).send({ error: 'Name is required' });
    }

    const target = await db
      .selectFrom('users')
      .selectAll()
      .where((eb) => eb(eb.fn('lower', ['username']), '=', name.trim().toLowerCase()))
      .executeTakeFirst();

    if (!target) return reply.status(404).send({ error: 'User not found' });
    if (target.id === request.userId) return reply.status(400).send({ error: 'Cannot add yourself' });

    const findExisting = () =>
      db
        .selectFrom('friendships')
        .selectAll()
        .where((eb) =>
          eb.or([
            eb.and([eb('requester_id', '=', request.userId!), eb('addressee_id', '=', target.id)]),
            eb.and([eb('requester_id', '=', target.id), eb('addressee_id', '=', request.userId!)]),
          ]),
        )
        .executeTakeFirst();

    const resolveExisting = async (existing: FriendshipRow) => {
      if (existing.status === 'accepted') return reply.status(400).send({ error: 'Already friends' });
      if (existing.requester_id === request.userId) return reply.status(400).send({ error: 'Request already sent' });
      await db
        .updateTable('friendships')
        .set({ status: 'accepted', updated_at: new Date() })
        .where('id', '=', existing.id)
        .execute();

      const friendship = await db.selectFrom('friendships').selectAll().where('id', '=', existing.id).executeTakeFirstOrThrow();
      const reqUser = request.user!;

      await redis.publish(`user:${target.id}`, JSON.stringify({
        op: 'friend.accept',
        d: {
          id: friendship.id,
          user: toApiUser(reqUser),
          status: 'accepted' as const,
          created_at: friendship.created_at.toISOString(),
        },
      }));
      await redis.publish(`user:${request.userId}`, JSON.stringify({
        op: 'friend.accept',
        d: {
          id: friendship.id,
          user: toApiUser(target),
          status: 'accepted' as const,
          created_at: friendship.created_at.toISOString(),
        },
      }));

      return {
        id: friendship.id,
        user: toApiUser(target),
        status: 'accepted' as const,
        created_at: friendship.created_at.toISOString(),
      };
    };

    const existing = await findExisting();
    if (existing) return resolveExisting(existing);

    const privacy = target.friend_privacy || 'everyone';
    if (privacy !== 'everyone') {
      let allowed = false;
      if (privacy === 'club-members') {
        const shared = await db
          .selectFrom('memberships as m1')
          .innerJoin('memberships as m2', 'm2.club_id', 'm1.club_id')
          .select('m1.id')
          .where('m1.user_id', '=', request.userId!)
          .where('m2.user_id', '=', target.id)
          .executeTakeFirst();
        allowed = !!shared;
      } else if (privacy === 'friends-of-friends') {
        const myRows = await db
          .selectFrom('friendships')
          .select(['requester_id', 'addressee_id'])
          .where('status', '=', 'accepted')
          .where((eb) => eb.or([eb('requester_id', '=', request.userId!), eb('addressee_id', '=', request.userId!)]))
          .execute();
        const myFriendIds = new Set(myRows.map((r) => (r.requester_id === request.userId ? r.addressee_id : r.requester_id)));
        const targetRows = await db
          .selectFrom('friendships')
          .select(['requester_id', 'addressee_id'])
          .where('status', '=', 'accepted')
          .where((eb) => eb.or([eb('requester_id', '=', target.id), eb('addressee_id', '=', target.id)]))
          .execute();
        allowed = targetRows.some((r) => myFriendIds.has(r.requester_id === target.id ? r.addressee_id : r.requester_id));
      }
      if (!allowed) {
        return reply.status(403).send({ error: 'This user is not accepting friend requests from you' });
      }
    }

    try {
      const friendship = await db
        .insertInto('friendships')
        .values({
          requester_id: request.userId!,
          addressee_id: target.id,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const reqUser = request.user!;
      const apiResult = {
        id: friendship.id,
        user: toApiUser(reqUser),
        status: friendship.status,
        created_at: friendship.created_at.toISOString(),
      };

      await redis.publish(`user:${target.id}`, JSON.stringify({ op: 'friend.request', d: apiResult }));

      return reply.status(201).send({
        id: friendship.id,
        user: toApiUser(target),
        status: friendship.status,
        created_at: friendship.created_at.toISOString(),
      });
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        const raced = await findExisting();
        if (raced) return resolveExisting(raced);
      }
      throw err;
    }
  });

  app.post('/api/friends/valentino', { preHandler: requireAuth }, async (request) => {
    const { friendship } = await befriendValentino(db, request.userId!);
    if (friendship) {
      await redis.publish(`user:${request.userId}`, JSON.stringify({
        op: 'friend.accept',
        d: {
          id: friendship.id,
          user: toApiUser({ id: VALENTINO_ID, email: '', username: VALENTINO_USERNAME, avatar_key: VALENTINO_AVATAR_KEY }),
          status: 'accepted' as const,
          created_at: friendship.created_at.toISOString(),
        },
      }));
    }
    return { added: !!friendship };
  });

  app.post('/api/friends/:friendshipId/accept', { preHandler: requireAuth }, async (request, reply) => {
    const { friendshipId } = request.params as { friendshipId: string };

    const friendship = await db
      .selectFrom('friendships')
      .selectAll()
      .where('id', '=', friendshipId)
      .executeTakeFirst();

    if (!friendship) return reply.status(404).send({ error: 'Request not found' });
    if (friendship.addressee_id !== request.userId) return reply.status(403).send({ error: 'Not your request' });
    if (friendship.status === 'accepted') return reply.status(400).send({ error: 'Already accepted' });

    await db
      .updateTable('friendships')
      .set({ status: 'accepted', updated_at: new Date() })
      .where('id', '=', friendshipId)
      .execute();

    const otherUser = await db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', friendship.requester_id)
      .executeTakeFirstOrThrow();

    const reqUser = request.user!;

    await redis.publish(`user:${friendship.requester_id}`, JSON.stringify({
      op: 'friend.accept',
      d: {
        id: friendship.id,
        user: toApiUser(reqUser),
        status: 'accepted',
        created_at: friendship.created_at.toISOString(),
      },
    }));

    return {
      id: friendship.id,
      user: toApiUser(otherUser),
      status: 'accepted' as const,
      created_at: friendship.created_at.toISOString(),
    };
  });

  app.delete('/api/friends/:friendshipId', { preHandler: requireAuth }, async (request, reply) => {
    const { friendshipId } = request.params as { friendshipId: string };

    const friendship = await db
      .selectFrom('friendships')
      .selectAll()
      .where('id', '=', friendshipId)
      .executeTakeFirst();

    if (!friendship) return reply.status(404).send({ error: 'Friendship not found' });

    if (friendship.requester_id !== request.userId && friendship.addressee_id !== request.userId) {
      return reply.status(403).send({ error: 'Not your friendship' });
    }

    const otherId = friendship.requester_id === request.userId ? friendship.addressee_id : friendship.requester_id;

    const deleted = await db.deleteFrom('friendships').where('id', '=', friendshipId).executeTakeFirst();
    if (!deleted.numDeletedRows) return reply.status(500).send({ error: 'Failed to remove friend' });

    await redis.publish(`user:${otherId}`, JSON.stringify({
      op: 'friend.remove',
      d: { friendship_id: friendshipId, user_id: request.userId },
    }));

    return { ok: true };
  });
}
