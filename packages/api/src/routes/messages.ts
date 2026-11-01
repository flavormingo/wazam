import type { FastifyInstance } from 'fastify';
import { Kysely, sql } from 'kysely';
import type { Database } from '../db/database.js';
import { createAuthMiddleware } from '../middleware.js';
import { computePermissions } from '../permissions.js';
import { Permissions, hasPermission } from '@wazam/shared';
import { getPublicUrl, removeStoredObject } from '../storage.js';
import { sendPushForChannelMessage } from '../push.js';
import type Redis from 'ioredis';

export async function afterChannelMessage(
  db: Kysely<Database>,
  redis: Redis,
  channelId: string,
  clubId: string,
  authorId: string,
  createdAt: Date,
) {
  await Promise.all([
    db.updateTable('channels')
      .set({ last_message_at: createdAt })
      .where('id', '=', channelId)
      .execute(),
    sql`
      INSERT INTO channel_reads (user_id, channel_id, last_read_at)
      VALUES (${authorId}, ${channelId}, ${createdAt.toISOString()})
      ON CONFLICT (user_id, channel_id)
      DO UPDATE SET last_read_at = EXCLUDED.last_read_at
    `.execute(db),
  ]);

  await redis.publish(`club:${clubId}`, JSON.stringify({
    op: 'message.notify',
    d: { channel_id: channelId, author_id: authorId, created_at: createdAt.toISOString() },
  }));
}

async function getReactionsByMessage(
  db: Kysely<Database>,
  messageIds: string[],
  viewerId: string,
): Promise<Map<string, { emoji: string; count: number; me: boolean }[]>> {
  const map = new Map<string, { emoji: string; count: number; me: boolean }[]>();
  if (!messageIds.length) return map;

  const rows = await db
    .selectFrom('message_reactions')
    .select([
      'message_id',
      'emoji',
      sql<number>`count(*)::int`.as('count'),
      sql<boolean>`bool_or(user_id = ${viewerId})`.as('me'),
    ])
    .where('message_id', 'in', messageIds)
    .groupBy(['message_id', 'emoji'])
    .orderBy(sql`min(created_at)`)
    .execute();

  for (const r of rows) {
    const list = map.get(r.message_id) || [];
    list.push({ emoji: r.emoji, count: Number(r.count), me: !!r.me });
    map.set(r.message_id, list);
  }
  return map;
}

export function messageRoutes(app: FastifyInstance, db: Kysely<Database>, redis: Redis) {
  const requireAuth = createAuthMiddleware(db);

  app.get('/api/channel/:channelId/messages', { preHandler: requireAuth }, async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const { before, limit = '50' } = request.query as { before?: string; limit?: string };

    const channel = await db
      .selectFrom('channels')
      .select(['club_id'])
      .where('id', '=', channelId)
      .executeTakeFirst();

    if (!channel) return reply.status(404).send({ error: 'Channel not found' });

    const membership = await db
      .selectFrom('memberships')
      .select('id')
      .where('user_id', '=', request.userId!)
      .where('club_id', '=', channel.club_id)
      .executeTakeFirst();

    if (!membership) return reply.status(403).send({ error: 'Not a member' });

    let query = db
      .selectFrom('messages')
      .leftJoin('users', 'users.id', 'messages.author_id')
      .select([
        'messages.id',
        'messages.channel_id',
        'messages.content',
        'messages.edited_at',
        'messages.deleted',
        'messages.created_at',
        'messages.author_id',
        'users.username',
        'users.avatar_key',
        'users.email',
      ])
      .where('messages.channel_id', '=', channelId)
      .orderBy('messages.created_at', 'desc')
      .limit(Math.max(1, Math.min(Number.isFinite(parseInt(limit)) ? parseInt(limit) : 50, 100)));

    if (before) {
      const beforeDate = new Date(before);
      if (isNaN(beforeDate.getTime())) return reply.status(400).send({ error: 'Invalid before date' });
      query = query.where('messages.created_at', '<', beforeDate);
    }

    const messages = await query.execute();

    const messageIds = messages.map((m) => m.id);
    const attachments = messageIds.length
      ? await db
          .selectFrom('attachments')
          .selectAll()
          .where('message_id', 'in', messageIds)
          .execute()
      : [];

    const attachmentsByMessage = new Map<string, typeof attachments>();
    for (const att of attachments) {
      const mid = att.message_id!;
      const list = attachmentsByMessage.get(mid) || [];
      list.push(att);
      attachmentsByMessage.set(mid, list);
    }

    const reactionsByMessage = await getReactionsByMessage(db, messageIds, request.userId!);

    return messages.reverse().map((m) => ({
      id: m.id,
      channel_id: m.channel_id,
      author: {
        id: m.author_id ?? 'deleted',
        name: m.username ?? 'deleted user',
        avatar_url: m.avatar_key ? getPublicUrl(m.avatar_key) : null,
      },
      content: m.content,
      attachments: (attachmentsByMessage.get(m.id) || []).map((a) => ({
        id: a.id,
        filename: a.filename,
        content_type: a.content_type,
        size: a.size,
        url: getPublicUrl(a.storage_key),
      })),
      reactions: reactionsByMessage.get(m.id) || [],
      edited_at: m.edited_at?.toISOString() ?? null,
      deleted: m.deleted,
      created_at: m.created_at.toISOString(),
    }));
  });

  app.post('/api/channel/:channelId/messages', { preHandler: requireAuth }, async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const { content, nonce, attachment_ids } = request.body as {
      content: string;
      nonce?: string;
      attachment_ids?: string[];
    };

    const hasAttachments = attachment_ids && attachment_ids.length > 0;
    if ((!content || !content.trim()) && !hasAttachments) {
      return reply.status(400).send({ error: 'Content or attachments required' });
    }
    if (content && content.length > 4000) {
      return reply.status(400).send({ error: 'Content max 4000 chars' });
    }

    const channel = await db
      .selectFrom('channels')
      .select(['club_id'])
      .where('id', '=', channelId)
      .executeTakeFirst();

    if (!channel) return reply.status(404).send({ error: 'Channel not found' });

    const perms = await computePermissions(db, request.userId!, channel.club_id);
    if (!hasPermission(perms, Permissions.SEND_MESSAGES)) {
      return reply.status(403).send({ error: 'Missing SEND_MESSAGES permission' });
    }

    if (attachment_ids?.length && !hasPermission(perms, Permissions.ATTACH_FILES)) {
      return reply.status(403).send({ error: 'Missing ATTACH_FILES permission' });
    }

    const message = await db
      .insertInto('messages')
      .values({
        channel_id: channelId,
        author_id: request.userId!,
        content: (content || '').trim(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    if (attachment_ids?.length) {
      await db
        .updateTable('attachments')
        .set({ message_id: message.id })
        .where('id', 'in', attachment_ids)
        .where('message_id', 'is', null)
        .where('dm_message_id', 'is', null)
        .execute();
    }

    const user = request.user!;
    const attachments = attachment_ids?.length
      ? await db.selectFrom('attachments').selectAll().where('message_id', '=', message.id).execute()
      : [];

    const apiMessage = {
      id: message.id,
      channel_id: message.channel_id,
      author: {
        id: user.id,
        name: user.username,
        avatar_url: user.avatar_key ? getPublicUrl(user.avatar_key) : null,
      },
      content: message.content,
      attachments: attachments.map((a) => ({
        id: a.id,
        filename: a.filename,
        content_type: a.content_type,
        size: a.size,
        url: getPublicUrl(a.storage_key),
      })),
      reactions: [],
      edited_at: null,
      deleted: false,
      created_at: message.created_at.toISOString(),
    };

    const event = JSON.stringify({ op: 'message.create', d: apiMessage });
    await redis.publish(`channel:${channelId}`, event);
    await afterChannelMessage(db, redis, channelId, channel.club_id, request.userId!, message.created_at);
    void sendPushForChannelMessage(db, redis, apiMessage, channel.club_id);

    return reply.status(201).send(apiMessage);
  });

  app.post('/api/channel/:channelId/read', { preHandler: requireAuth }, async (request, reply) => {
    const { channelId } = request.params as { channelId: string };

    const channel = await db
      .selectFrom('channels')
      .select('club_id')
      .where('id', '=', channelId)
      .executeTakeFirst();

    if (!channel) return reply.status(404).send({ error: 'Channel not found' });

    const membership = await db
      .selectFrom('memberships')
      .select('id')
      .where('user_id', '=', request.userId!)
      .where('club_id', '=', channel.club_id)
      .executeTakeFirst();

    if (!membership) return reply.status(403).send({ error: 'Not a member' });

    await sql`
      INSERT INTO channel_reads (user_id, channel_id, last_read_at)
      VALUES (${request.userId!}, ${channelId}, now())
      ON CONFLICT (user_id, channel_id)
      DO UPDATE SET last_read_at = now()
    `.execute(db);

    await redis.publish(`user:${request.userId}`, JSON.stringify({
      op: 'read.update',
      d: { scope_type: 'channel', scope_id: channelId, last_read_at: new Date().toISOString() },
    }));

    return { ok: true };
  });

  app.patch('/api/channel/:channelId/messages/:messageId', { preHandler: requireAuth }, async (request, reply) => {
    const { channelId, messageId } = request.params as { channelId: string; messageId: string };
    const { content } = request.body as { content: string };

    if (!content || !content.trim() || content.length > 4000) {
      return reply.status(400).send({ error: 'Content is required (max 4000 chars)' });
    }

    const message = await db
      .selectFrom('messages')
      .selectAll()
      .where('id', '=', messageId)
      .where('channel_id', '=', channelId)
      .executeTakeFirst();

    if (!message) return reply.status(404).send({ error: 'Message not found' });
    if (message.deleted) return reply.status(400).send({ error: 'Cannot edit a deleted message' });
    if (message.author_id !== request.userId) {
      return reply.status(403).send({ error: 'Can only edit your own messages' });
    }

    const updated = await db
      .updateTable('messages')
      .set({ content: content.trim(), edited_at: new Date() })
      .where('id', '=', messageId)
      .returningAll()
      .executeTakeFirstOrThrow();

    const user = request.user!;
    const attachments = await db.selectFrom('attachments').selectAll().where('message_id', '=', messageId).execute();
    const reactions = (await getReactionsByMessage(db, [messageId], request.userId!)).get(messageId) || [];

    const apiMessage = {
      id: updated.id,
      channel_id: updated.channel_id,
      author: {
        id: user.id,
        name: user.username,
        avatar_url: user.avatar_key ? getPublicUrl(user.avatar_key) : null,
      },
      content: updated.content,
      attachments: attachments.map((a) => ({
        id: a.id,
        filename: a.filename,
        content_type: a.content_type,
        size: a.size,
        url: getPublicUrl(a.storage_key),
      })),
      reactions,
      edited_at: updated.edited_at?.toISOString() ?? null,
      deleted: updated.deleted,
      created_at: updated.created_at.toISOString(),
    };

    const event = JSON.stringify({ op: 'message.update', d: apiMessage });
    await redis.publish(`channel:${channelId}`, event);

    return apiMessage;
  });

  app.delete('/api/channel/:channelId/messages/:messageId', { preHandler: requireAuth }, async (request, reply) => {
    const { channelId, messageId } = request.params as { channelId: string; messageId: string };

    const message = await db
      .selectFrom('messages')
      .select(['author_id', 'channel_id'])
      .where('id', '=', messageId)
      .where('channel_id', '=', channelId)
      .executeTakeFirst();

    if (!message) return reply.status(404).send({ error: 'Message not found' });

    const channel = await db
      .selectFrom('channels')
      .select('club_id')
      .where('id', '=', channelId)
      .executeTakeFirst();

    if (message.author_id !== request.userId) {
      if (!channel) return reply.status(404).send({ error: 'Channel not found' });
      const perms = await computePermissions(db, request.userId!, channel.club_id);
      if (!hasPermission(perms, Permissions.MANAGE_MESSAGES)) {
        return reply.status(403).send({ error: 'Missing MANAGE_MESSAGES permission' });
      }

      await db.insertInto('audit_log').values({
        club_id: channel.club_id,
        actor_id: request.userId!,
        action: 'message.delete',
        target_type: 'message',
        target_id: messageId,
      }).execute();
    }

    const attachments = await db
      .selectFrom('attachments')
      .select('storage_key')
      .where('message_id', '=', messageId)
      .execute();
    for (const att of attachments) {
      await removeStoredObject(att.storage_key).catch(() => {});
    }

    const deleted = await db
      .deleteFrom('messages')
      .where('id', '=', messageId)
      .executeTakeFirst();

    if (!deleted.numDeletedRows) return reply.status(500).send({ error: 'Failed to delete message' });

    const event = JSON.stringify({ op: 'message.delete', d: { id: messageId, channel_id: channelId } });
    await redis.publish(`channel:${channelId}`, event);

    return { ok: true };
  });

  app.post('/api/channel/:channelId/messages/:messageId/react', { preHandler: requireAuth }, async (request, reply) => {
    const { channelId, messageId } = request.params as { channelId: string; messageId: string };
    const { emoji } = request.body as { emoji?: string };

    const trimmed = (emoji || '').trim();
    if (!trimmed || trimmed.length > 32 || !/\p{Extended_Pictographic}/u.test(trimmed)) {
      return reply.status(400).send({ error: 'Invalid emoji' });
    }

    const message = await db
      .selectFrom('messages')
      .select('id')
      .where('id', '=', messageId)
      .where('channel_id', '=', channelId)
      .executeTakeFirst();
    if (!message) return reply.status(404).send({ error: 'Message not found' });

    const channel = await db
      .selectFrom('channels')
      .select('club_id')
      .where('id', '=', channelId)
      .executeTakeFirst();
    if (!channel) return reply.status(404).send({ error: 'Channel not found' });

    const perms = await computePermissions(db, request.userId!, channel.club_id);
    if (!hasPermission(perms, Permissions.SEND_MESSAGES)) {
      return reply.status(403).send({ error: 'Missing SEND_MESSAGES permission' });
    }

    const existing = await db
      .selectFrom('message_reactions')
      .select('id')
      .where('message_id', '=', messageId)
      .where('user_id', '=', request.userId!)
      .where('emoji', '=', trimmed)
      .executeTakeFirst();

    let added: boolean;
    let mutated: boolean;
    if (existing) {
      const del = await db.deleteFrom('message_reactions').where('id', '=', existing.id).executeTakeFirst();
      added = false;
      mutated = (del.numDeletedRows ?? 0n) > 0n;
    } else {
      const { rows } = await db.executeQuery<{ n: string }>(
        db.selectFrom('message_reactions')
          .select(db.fn.countAll().as('n'))
          .where('message_id', '=', messageId)
          .where('user_id', '=', request.userId!)
          .compile()
      );
      if (Number(rows[0]?.n ?? 0) >= 20) {
        return reply.status(400).send({ error: 'Too many reactions' });
      }
      const ins = await db
        .insertInto('message_reactions')
        .values({ message_id: messageId, user_id: request.userId!, emoji: trimmed })
        .onConflict((oc) => oc.columns(['message_id', 'user_id', 'emoji']).doNothing())
        .executeTakeFirst();
      added = true;
      mutated = (ins.numInsertedOrUpdatedRows ?? 0n) > 0n;
    }

    if (mutated) {
      await redis.publish(`channel:${channelId}`, JSON.stringify({
        op: added ? 'reaction.add' : 'reaction.remove',
        d: { message_id: messageId, channel_id: channelId, emoji: trimmed, user_id: request.userId! },
      }));
    }

    return { reacted: added };
  });
}
