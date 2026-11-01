import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { VALENTINO_ID, VALENTINO_USERNAME, VALENTINO_AVATAR_KEY, type ApiAttachment } from '@wazam/shared';
import type { Database } from '../db/database.js';
import { createAuthMiddleware } from '../middleware.js';
import { getPublicUrl, removeStoredObject } from '../storage.js';
import { sendPushForDmMessage } from '../push.js';
import type Redis from 'ioredis';

function toApiUser(u: { id: string; email: string; username: string; avatar_key: string | null }) {
  return {
    id: u.id,
    name: u.username,
    avatar_url: u.avatar_key ? getPublicUrl(u.avatar_key) : null,
  };
}

const meowTimers = new Map<string, ReturnType<typeof setTimeout>>();

function meowBack(db: Kysely<Database>, redis: Redis, dmChannelId: string) {
  clearTimeout(meowTimers.get(dmChannelId));
  meowTimers.set(dmChannelId, setTimeout(async () => {
    meowTimers.delete(dmChannelId);
    try {
      await redis.publish(`dm:${dmChannelId}`, JSON.stringify({
        op: 'dm.typing.start',
        d: { dm_channel_id: dmChannelId, user_id: VALENTINO_ID, name: VALENTINO_USERNAME },
      }));
      await new Promise((resolve) => setTimeout(resolve, 1100));

      const message = await db
        .insertInto('dm_messages')
        .values({ dm_channel_id: dmChannelId, author_id: VALENTINO_ID, content: 'meow' })
        .returningAll()
        .executeTakeFirstOrThrow();

      await db.updateTable('dm_channels').set({ updated_at: new Date() }).where('id', '=', dmChannelId).execute();
      await db.updateTable('dm_members')
        .set({ last_read_at: message.created_at })
        .where('dm_channel_id', '=', dmChannelId)
        .where('user_id', '=', VALENTINO_ID)
        .execute();

      const apiMessage = {
        id: message.id,
        dm_channel_id: message.dm_channel_id,
        author: toApiUser({ id: VALENTINO_ID, email: '', username: VALENTINO_USERNAME, avatar_key: VALENTINO_AVATAR_KEY }),
        content: message.content,
        reactions: [],
        edited_at: null,
        deleted: false,
        created_at: message.created_at.toISOString(),
      };

      await redis.publish(`dm:${dmChannelId}`, JSON.stringify({ op: 'dm.message.create', d: apiMessage }));
      void sendPushForDmMessage(db, redis, apiMessage);
    } catch (err) {
      console.error('Valentino meow failed:', err);
    }
  }, 700));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getDmAttachmentsByMessage(db: Kysely<Database>, messageIds: string[]) {
  const map = new Map<string, ApiAttachment[]>();
  if (!messageIds.length) return map;
  const rows = await db
    .selectFrom('attachments')
    .selectAll()
    .where('dm_message_id', 'in', messageIds)
    .orderBy('created_at')
    .execute();
  for (const a of rows) {
    const list = map.get(a.dm_message_id!) || [];
    list.push({ id: a.id, filename: a.filename, content_type: a.content_type, size: a.size, url: getPublicUrl(a.storage_key) });
    map.set(a.dm_message_id!, list);
  }
  return map;
}

async function getDmReactionsByMessage(
  db: Kysely<Database>,
  messageIds: string[],
  viewerId: string,
): Promise<Map<string, { emoji: string; count: number; me: boolean }[]>> {
  const map = new Map<string, { emoji: string; count: number; me: boolean }[]>();
  if (!messageIds.length) return map;

  const rows = await db
    .selectFrom('dm_message_reactions')
    .select([
      'dm_message_id',
      'emoji',
      sql<number>`count(*)::int`.as('count'),
      sql<boolean>`bool_or(user_id = ${viewerId})`.as('me'),
    ])
    .where('dm_message_id', 'in', messageIds)
    .groupBy(['dm_message_id', 'emoji'])
    .orderBy(sql`min(created_at)`)
    .execute();

  for (const r of rows) {
    const list = map.get(r.dm_message_id) || [];
    list.push({ emoji: r.emoji, count: Number(r.count), me: !!r.me });
    map.set(r.dm_message_id, list);
  }
  return map;
}

export function dmRoutes(app: FastifyInstance, db: Kysely<Database>, redis: Redis) {
  const requireAuth = createAuthMiddleware(db);

  app.get('/api/dm', { preHandler: requireAuth }, async (request) => {
    const userId = request.userId!;

    const channels = await db
      .selectFrom('dm_channels')
      .innerJoin('dm_members', 'dm_members.dm_channel_id', 'dm_channels.id')
      .select([
        'dm_channels.id',
        'dm_channels.type',
        'dm_channels.name',
        'dm_channels.owner_id',
        'dm_channels.created_at',
        'dm_channels.updated_at',
      ])
      .where('dm_members.user_id', '=', userId)
      .orderBy('dm_channels.updated_at', 'desc')
      .execute();

    const myDmReads = await db
      .selectFrom('dm_members')
      .select(['dm_channel_id', 'last_read_at'])
      .where('user_id', '=', userId)
      .execute();
    const dmReadMap = new Map(myDmReads.map(r => [r.dm_channel_id, r.last_read_at]));

    const result = [];
    for (const ch of channels) {
      const members = await db
        .selectFrom('dm_members')
        .innerJoin('users', 'users.id', 'dm_members.user_id')
        .select([
          'users.id',
          'users.email',
          'users.username',

          'users.avatar_key',
        ])
        .where('dm_members.dm_channel_id', '=', ch.id)
        .execute();

      if (ch.type === 'direct') {
        const otherId = members.find((m) => m.id !== userId)?.id;
        if (otherId) {
          const friendship = await db
            .selectFrom('friendships')
            .select('id')
            .where('status', '=', 'accepted')
            .where((eb) =>
              eb.or([
                eb.and([eb('requester_id', '=', userId), eb('addressee_id', '=', otherId)]),
                eb.and([eb('requester_id', '=', otherId), eb('addressee_id', '=', userId)]),
              ]),
            )
            .executeTakeFirst();

          if (!friendship) continue;
        }
      }

      const lastMsg = await db
        .selectFrom('dm_messages')
        .leftJoin('users', 'users.id', 'dm_messages.author_id')
        .select([
          'dm_messages.id',
          'dm_messages.dm_channel_id',
          'dm_messages.content',
          'dm_messages.call_status',
          'dm_messages.call_duration',
          'dm_messages.edited_at',
          'dm_messages.deleted',
          'dm_messages.created_at',
          'users.id as author_id',
          'users.email as author_email',
          'users.username as author_username',
  
          'users.avatar_key as author_avatar_key',
        ])
        .where('dm_messages.dm_channel_id', '=', ch.id)
        .orderBy('dm_messages.created_at', 'desc')
        .limit(1)
        .executeTakeFirst();

      result.push({
        id: ch.id,
        type: ch.type,
        name: ch.name,
        members: members.map(toApiUser),
        last_message: lastMsg
          ? {
              id: lastMsg.id,
              dm_channel_id: lastMsg.dm_channel_id,
              author: toApiUser({
                id: lastMsg.author_id ?? 'deleted',
                email: lastMsg.author_email ?? '',
                username: lastMsg.author_username ?? 'deleted user',
                avatar_key: lastMsg.author_avatar_key,
              }),
              content: lastMsg.content,
              call: lastMsg.call_status ? { status: lastMsg.call_status, duration: lastMsg.call_duration } : null,
              attachments: [] as ApiAttachment[],
              edited_at: lastMsg.edited_at?.toISOString() ?? null,
              deleted: lastMsg.deleted,
              created_at: lastMsg.created_at.toISOString(),
            }
          : null,
        updated_at: ch.updated_at.toISOString(),
        last_read_at: dmReadMap.get(ch.id)?.toISOString() ?? null,
      });
    }

    const lastAttachments = await getDmAttachmentsByMessage(db, result.flatMap((r) => (r.last_message ? [r.last_message.id] : [])));
    for (const r of result) {
      if (r.last_message) r.last_message.attachments = lastAttachments.get(r.last_message.id) || [];
    }

    return result;
  });

  app.post('/api/dm', { preHandler: requireAuth }, async (request, reply) => {
    const { user_ids } = request.body as { user_ids: string[] };
    const userId = request.userId!;

    if (!user_ids || !user_ids.length) {
      return reply.status(400).send({ error: 'user_ids required' });
    }

    const allUserIds = [...new Set([userId, ...user_ids])];

    for (const uid of user_ids) {
      if (uid === userId) continue;
      const friendship = await db
        .selectFrom('friendships')
        .select('id')
        .where('status', '=', 'accepted')
        .where((eb) =>
          eb.or([
            eb.and([eb('requester_id', '=', userId), eb('addressee_id', '=', uid)]),
            eb.and([eb('requester_id', '=', uid), eb('addressee_id', '=', userId)]),
          ]),
        )
        .executeTakeFirst();

      if (!friendship) {
        return reply.status(403).send({ error: 'Must be friends with all users' });
      }
    }

    if (user_ids.length === 1 && user_ids[0] !== userId) {
      const otherId = user_ids[0];
      const lockKey = [userId, otherId].sort().join(':');

      const outcome = await db.transaction().execute(async (trx) => {
        await sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`.execute(trx);

        const existing = await trx
          .selectFrom('dm_channels')
          .innerJoin('dm_members as m1', (join) =>
            join.onRef('m1.dm_channel_id', '=', 'dm_channels.id').on('m1.user_id', '=', userId),
          )
          .innerJoin('dm_members as m2', (join) =>
            join.onRef('m2.dm_channel_id', '=', 'dm_channels.id').on('m2.user_id', '=', otherId),
          )
          .select('dm_channels.id')
          .where('dm_channels.type', '=', 'direct')
          .executeTakeFirst();

        if (existing) return { channelId: existing.id, created: false };

        const channel = await trx
          .insertInto('dm_channels')
          .values({ type: 'direct', owner_id: null })
          .returning('id')
          .executeTakeFirstOrThrow();
        await trx.insertInto('dm_members').values({ dm_channel_id: channel.id, user_id: userId }).execute();
        await trx.insertInto('dm_members').values({ dm_channel_id: channel.id, user_id: otherId }).execute();
        return { channelId: channel.id, created: true };
      });

      const members = await db
        .selectFrom('dm_members')
        .innerJoin('users', 'users.id', 'dm_members.user_id')
        .select(['users.id', 'users.username', 'users.avatar_key'])
        .where('dm_members.dm_channel_id', '=', outcome.channelId)
        .execute();
      const ch = await db.selectFrom('dm_channels').selectAll().where('id', '=', outcome.channelId).executeTakeFirstOrThrow();

      const apiChannel = {
        id: ch.id,
        type: ch.type,
        name: ch.name,
        members: members.map((u) => ({
          id: u.id,
          name: u.username,
          avatar_url: u.avatar_key ? getPublicUrl(u.avatar_key) : null,
        })),
        last_message: null,
        updated_at: ch.updated_at.toISOString(),
      };

      if (outcome.created) {
        for (const uid of [userId, otherId]) {
          await redis.publish(`user:${uid}`, JSON.stringify({ op: 'dm.channel.create', d: apiChannel }));
        }
      }

      return reply.status(201).send(apiChannel);
    }

    const channelType = user_ids.length === 1 ? 'direct' : 'group';
    const channel = await db
      .insertInto('dm_channels')
      .values({
        type: channelType,
        owner_id: channelType === 'group' ? userId : null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    for (const uid of allUserIds) {
      await db
        .insertInto('dm_members')
        .values({ dm_channel_id: channel.id, user_id: uid })
        .execute();
    }

    const members = await db
      .selectFrom('dm_members')
      .innerJoin('users', 'users.id', 'dm_members.user_id')
      .select(['users.id', 'users.email', 'users.username', 'users.avatar_key'])
      .where('dm_members.dm_channel_id', '=', channel.id)
      .execute();

    const apiChannel = {
      id: channel.id,
      type: channel.type,
      name: channel.name,
      members: members.map(toApiUser),
      last_message: null,
      updated_at: channel.updated_at.toISOString(),
    };

    for (const uid of allUserIds) {
      await redis.publish(`user:${uid}`, JSON.stringify({ op: 'dm.channel.create', d: apiChannel }));
    }

    return reply.status(201).send(apiChannel);
  });

  app.get('/api/dm/:dmChannelId/messages', { preHandler: requireAuth }, async (request, reply) => {
    const { dmChannelId } = request.params as { dmChannelId: string };
    const { before, limit = '50' } = request.query as { before?: string; limit?: string };

    const membership = await db
      .selectFrom('dm_members')
      .select('id')
      .where('dm_channel_id', '=', dmChannelId)
      .where('user_id', '=', request.userId!)
      .executeTakeFirst();

    if (!membership) return reply.status(403).send({ error: 'Not a member' });

    let query = db
      .selectFrom('dm_messages')
      .leftJoin('users', 'users.id', 'dm_messages.author_id')
      .select([
        'dm_messages.id',
        'dm_messages.dm_channel_id',
        'dm_messages.content',
        'dm_messages.call_status',
        'dm_messages.call_duration',
        'dm_messages.edited_at',
        'dm_messages.deleted',
        'dm_messages.created_at',
        'users.id as author_id',
        'users.email as author_email',
        'users.username as author_username',

        'users.avatar_key as author_avatar_key',
      ])
      .where('dm_messages.dm_channel_id', '=', dmChannelId)
      .orderBy('dm_messages.created_at', 'desc')
      .limit(Math.max(1, Math.min(Number.isFinite(parseInt(limit)) ? parseInt(limit) : 50, 100)));

    if (before) {
      const beforeDate = new Date(before);
      if (isNaN(beforeDate.getTime())) return reply.status(400).send({ error: 'Invalid before date' });
      query = query.where('dm_messages.created_at', '<', beforeDate);
    }

    const messages = await query.execute();

    const reactionsByMessage = await getDmReactionsByMessage(db, messages.map((m) => m.id), request.userId!);
    const attachmentsByMessage = await getDmAttachmentsByMessage(db, messages.map((m) => m.id));

    return messages.reverse().map((m) => ({
      id: m.id,
      dm_channel_id: m.dm_channel_id,
      author: toApiUser({
        id: m.author_id ?? 'deleted',
        email: m.author_email ?? '',
        username: m.author_username ?? 'deleted user',
        avatar_key: m.author_avatar_key,
      }),
      content: m.content,
      call: m.call_status ? { status: m.call_status, duration: m.call_duration } : null,
      attachments: attachmentsByMessage.get(m.id) || [],
      reactions: reactionsByMessage.get(m.id) || [],
      edited_at: m.edited_at?.toISOString() ?? null,
      deleted: m.deleted,
      created_at: m.created_at.toISOString(),
    }));
  });

  app.post('/api/dm/:dmChannelId/messages', { preHandler: requireAuth }, async (request, reply) => {
    const { dmChannelId } = request.params as { dmChannelId: string };
    const { content, attachment_ids } = request.body as { content?: string; attachment_ids?: string[] };

    const hasAttachments = Array.isArray(attachment_ids) && attachment_ids.length > 0;
    if ((!content || !content.trim()) && !hasAttachments) {
      return reply.status(400).send({ error: 'Content or attachments required' });
    }
    if (content && content.length > 4000) {
      return reply.status(400).send({ error: 'Content max 4000 chars' });
    }
    if (hasAttachments && !attachment_ids.every((id) => typeof id === 'string' && UUID_RE.test(id))) {
      return reply.status(400).send({ error: 'Invalid attachments' });
    }

    const membership = await db
      .selectFrom('dm_members')
      .select('id')
      .where('dm_channel_id', '=', dmChannelId)
      .where('user_id', '=', request.userId!)
      .executeTakeFirst();

    if (!membership) return reply.status(403).send({ error: 'Not a member' });

    const message = await db
      .insertInto('dm_messages')
      .values({
        dm_channel_id: dmChannelId,
        author_id: request.userId!,
        content: (content || '').trim(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    if (hasAttachments) {
      await db
        .updateTable('attachments')
        .set({ dm_message_id: message.id })
        .where('id', 'in', attachment_ids)
        .where('message_id', 'is', null)
        .where('dm_message_id', 'is', null)
        .execute();
    }
    const attachments = hasAttachments ? (await getDmAttachmentsByMessage(db, [message.id])).get(message.id) || [] : [];

    await db
      .updateTable('dm_channels')
      .set({ updated_at: new Date() })
      .where('id', '=', dmChannelId)
      .execute();

    const user = request.user!;
    const apiMessage = {
      id: message.id,
      dm_channel_id: message.dm_channel_id,
      author: toApiUser(user),
      content: message.content,
      attachments,
      reactions: [],
      edited_at: null,
      deleted: false,
      created_at: message.created_at.toISOString(),
    };

    await db.updateTable('dm_members')
      .set({ last_read_at: message.created_at })
      .where('dm_channel_id', '=', dmChannelId)
      .where('user_id', '=', request.userId!)
      .execute();

    await redis.publish(`dm:${dmChannelId}`, JSON.stringify({ op: 'dm.message.create', d: apiMessage }));
    void sendPushForDmMessage(db, redis, apiMessage);

    const withValentino = await db
      .selectFrom('dm_members')
      .innerJoin('dm_channels', 'dm_channels.id', 'dm_members.dm_channel_id')
      .select('dm_members.id')
      .where('dm_members.dm_channel_id', '=', dmChannelId)
      .where('dm_members.user_id', '=', VALENTINO_ID)
      .where('dm_channels.type', '=', 'direct')
      .executeTakeFirst();
    if (withValentino) meowBack(db, redis, dmChannelId);

    return reply.status(201).send(apiMessage);
  });

  app.post('/api/dm/:dmChannelId/read', { preHandler: requireAuth }, async (request, reply) => {
    const { dmChannelId } = request.params as { dmChannelId: string };

    const membership = await db
      .selectFrom('dm_members')
      .select('id')
      .where('dm_channel_id', '=', dmChannelId)
      .where('user_id', '=', request.userId!)
      .executeTakeFirst();

    if (!membership) return reply.status(403).send({ error: 'Not a member' });

    await db.updateTable('dm_members')
      .set({ last_read_at: new Date() })
      .where('dm_channel_id', '=', dmChannelId)
      .where('user_id', '=', request.userId!)
      .execute();

    await redis.publish(`user:${request.userId}`, JSON.stringify({
      op: 'read.update',
      d: { scope_type: 'dm', scope_id: dmChannelId, last_read_at: new Date().toISOString() },
    }));

    return { ok: true };
  });

  app.patch('/api/dm/:dmChannelId/messages/:messageId', { preHandler: requireAuth }, async (request, reply) => {
    const { dmChannelId, messageId } = request.params as { dmChannelId: string; messageId: string };
    const { content } = request.body as { content: string };

    if (!content || !content.trim() || content.length > 4000) {
      return reply.status(400).send({ error: 'Content is required (max 4000 chars)' });
    }

    const message = await db
      .selectFrom('dm_messages')
      .selectAll()
      .where('id', '=', messageId)
      .where('dm_channel_id', '=', dmChannelId)
      .executeTakeFirst();

    if (!message) return reply.status(404).send({ error: 'Message not found' });
    if (message.deleted) return reply.status(400).send({ error: 'Cannot edit a deleted message' });
    if (message.call_status) return reply.status(400).send({ error: 'Cannot edit a call message' });
    if (message.author_id !== request.userId) return reply.status(403).send({ error: 'Can only edit your own messages' });

    const updated = await db
      .updateTable('dm_messages')
      .set({ content: content.trim(), edited_at: new Date() })
      .where('id', '=', messageId)
      .returningAll()
      .executeTakeFirstOrThrow();

    const user = request.user!;
    const reactions = (await getDmReactionsByMessage(db, [messageId], request.userId!)).get(messageId) || [];
    const attachments = (await getDmAttachmentsByMessage(db, [messageId])).get(messageId) || [];
    const apiMessage = {
      id: updated.id,
      dm_channel_id: updated.dm_channel_id,
      author: toApiUser(user),
      content: updated.content,
      attachments,
      reactions,
      edited_at: updated.edited_at?.toISOString() ?? null,
      deleted: updated.deleted,
      created_at: updated.created_at.toISOString(),
    };

    await redis.publish(`dm:${dmChannelId}`, JSON.stringify({ op: 'dm.message.update', d: apiMessage }));

    return apiMessage;
  });

  app.delete('/api/dm/:dmChannelId/messages/:messageId', { preHandler: requireAuth }, async (request, reply) => {
    const { dmChannelId, messageId } = request.params as { dmChannelId: string; messageId: string };

    const message = await db
      .selectFrom('dm_messages')
      .select(['author_id', 'dm_channel_id', 'call_status'])
      .where('id', '=', messageId)
      .where('dm_channel_id', '=', dmChannelId)
      .executeTakeFirst();

    if (!message) return reply.status(404).send({ error: 'Message not found' });
    if (message.call_status) return reply.status(400).send({ error: 'Cannot delete a call message' });
    if (message.author_id !== request.userId) return reply.status(403).send({ error: 'Can only delete your own messages' });

    const stored = await db
      .selectFrom('attachments')
      .select('storage_key')
      .where('dm_message_id', '=', messageId)
      .execute();
    for (const att of stored) {
      await removeStoredObject(att.storage_key).catch(() => {});
    }

    const deleted = await db
      .deleteFrom('dm_messages')
      .where('id', '=', messageId)
      .executeTakeFirst();

    if (!deleted.numDeletedRows) return reply.status(500).send({ error: 'Failed to delete message' });

    await redis.publish(`dm:${dmChannelId}`, JSON.stringify({
      op: 'dm.message.delete',
      d: { id: messageId, dm_channel_id: dmChannelId },
    }));

    return { ok: true };
  });

  app.post('/api/dm/:dmChannelId/messages/:messageId/react', { preHandler: requireAuth }, async (request, reply) => {
    const { dmChannelId, messageId } = request.params as { dmChannelId: string; messageId: string };
    const { emoji } = request.body as { emoji?: string };

    const trimmed = (emoji || '').trim();
    if (!trimmed || trimmed.length > 32 || !/\p{Extended_Pictographic}/u.test(trimmed)) {
      return reply.status(400).send({ error: 'Invalid emoji' });
    }

    const membership = await db
      .selectFrom('dm_members')
      .select('id')
      .where('dm_channel_id', '=', dmChannelId)
      .where('user_id', '=', request.userId!)
      .executeTakeFirst();
    if (!membership) return reply.status(403).send({ error: 'Not a member' });

    const message = await db
      .selectFrom('dm_messages')
      .select('id')
      .where('id', '=', messageId)
      .where('dm_channel_id', '=', dmChannelId)
      .executeTakeFirst();
    if (!message) return reply.status(404).send({ error: 'Message not found' });

    const existing = await db
      .selectFrom('dm_message_reactions')
      .select('id')
      .where('dm_message_id', '=', messageId)
      .where('user_id', '=', request.userId!)
      .where('emoji', '=', trimmed)
      .executeTakeFirst();

    let added: boolean;
    let mutated: boolean;
    if (existing) {
      const del = await db.deleteFrom('dm_message_reactions').where('id', '=', existing.id).executeTakeFirst();
      added = false;
      mutated = (del.numDeletedRows ?? 0n) > 0n;
    } else {
      const { rows } = await db.executeQuery<{ n: string }>(
        db.selectFrom('dm_message_reactions')
          .select(db.fn.countAll().as('n'))
          .where('dm_message_id', '=', messageId)
          .where('user_id', '=', request.userId!)
          .compile()
      );
      if (Number(rows[0]?.n ?? 0) >= 20) {
        return reply.status(400).send({ error: 'Too many reactions' });
      }
      const ins = await db
        .insertInto('dm_message_reactions')
        .values({ dm_message_id: messageId, user_id: request.userId!, emoji: trimmed })
        .onConflict((oc) => oc.columns(['dm_message_id', 'user_id', 'emoji']).doNothing())
        .executeTakeFirst();
      added = true;
      mutated = (ins.numInsertedOrUpdatedRows ?? 0n) > 0n;
    }

    if (mutated) {
      await redis.publish(`dm:${dmChannelId}`, JSON.stringify({
        op: added ? 'dm.reaction.add' : 'dm.reaction.remove',
        d: { dm_message_id: messageId, dm_channel_id: dmChannelId, emoji: trimmed, user_id: request.userId! },
      }));
    }

    return { reacted: added };
  });
}
