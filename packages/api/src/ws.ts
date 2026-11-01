import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database } from './db/database.js';
import type Redis from 'ioredis';
import { auth } from './auth.js';
import { fromNodeHeaders } from 'better-auth/node';
import { computePermissions } from './permissions.js';
import { Permissions, hasPermission } from '@wazup/shared';
import type { ClientOp, ServerOp, PresenceStatus } from '@wazup/shared';
import { getPublicUrl } from './storage.js';
import { afterChannelMessage } from './routes/messages.js';
import { sendPushForChannelMessage } from './push.js';
import type { WebSocket } from 'ws';
import { nanoid } from 'nanoid';

interface WsClient {
  ws: WebSocket;
  userId: string;
  sessionId: string;
  subscribedChannels: Set<string>;
  subscribedClubs: Set<string>;
  subscribedDms: Set<string>;
}

const clients = new Map<string, WsClient>();
const userSessions = new Map<string, Set<string>>();

const channelSubCounts = new Map<string, number>();
const clubSubCounts = new Map<string, number>();
const dmSubCounts = new Map<string, number>();
const userSubCounts = new Map<string, number>();

function send(ws: WebSocket, op: ServerOp) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(op));
  }
}

function broadcast(channelId: string, op: ServerOp, excludeSession?: string) {
  const data = JSON.stringify(op);
  for (const client of clients.values()) {
    if (client.subscribedChannels.has(channelId) && client.sessionId !== excludeSession) {
      if (client.ws.readyState === client.ws.OPEN) {
        client.ws.send(data);
      }
    }
  }
}

function broadcastClub(clubId: string, op: ServerOp) {
  const data = JSON.stringify(op);
  for (const client of clients.values()) {
    if (client.subscribedClubs.has(clubId)) {
      if (client.ws.readyState === client.ws.OPEN) {
        client.ws.send(data);
      }
    }
  }
}

function broadcastDm(dmChannelId: string, op: ServerOp) {
  const data = JSON.stringify(op);
  for (const client of clients.values()) {
    if (client.subscribedDms.has(dmChannelId)) {
      if (client.ws.readyState === client.ws.OPEN) {
        client.ws.send(data);
      }
    }
  }
}

function broadcastUser(userId: string, op: ServerOp) {
  const sessions = userSessions.get(userId);
  if (!sessions) return;
  const data = JSON.stringify(op);
  for (const sessionId of sessions) {
    const client = clients.get(sessionId);
    if (client && client.ws.readyState === client.ws.OPEN) {
      client.ws.send(data);
    }
  }
}

async function refCountSubscribe(redisSub: Redis, key: string, counts: Map<string, number>) {
  const current = counts.get(key) || 0;
  counts.set(key, current + 1);
  if (current === 0) {
    await redisSub.subscribe(key);
  }
}

async function refCountUnsubscribe(redisSub: Redis, key: string, counts: Map<string, number>) {
  const current = counts.get(key) || 0;
  if (current <= 1) {
    counts.delete(key);
    await redisSub.unsubscribe(key);
  } else {
    counts.set(key, current - 1);
  }
}

const VALID_PRESENCE: Set<string> = new Set(['online', 'idle', 'dnd', 'offline']);

export function setupWebSocket(app: FastifyInstance, db: Kysely<Database>, redis: Redis, redisSub: Redis) {
  redisSub.on('message', (channel, message) => {
    try {
      const op = JSON.parse(message) as ServerOp;

      if (channel.startsWith('channel:')) {
        const channelId = channel.slice(8);
        broadcast(channelId, op);
      } else if (channel.startsWith('club:')) {
        const clubId = channel.slice(5);
        broadcastClub(clubId, op);
      } else if (channel.startsWith('dm:')) {
        const dmChannelId = channel.slice(3);
        broadcastDm(dmChannelId, op);
      } else if (channel.startsWith('user:')) {
        const userId = channel.slice(5);
        broadcastUser(userId, op);

        if (op.op === 'dm.channel.create') {
          const dmChannelId = (op.d as any).id;
          const sessions = userSessions.get(userId);
          if (sessions) {
            for (const sessionId of sessions) {
              const client = clients.get(sessionId);
              if (client && !client.subscribedDms.has(dmChannelId)) {
                client.subscribedDms.add(dmChannelId);
                refCountSubscribe(redisSub, `dm:${dmChannelId}`, dmSubCounts).catch(() => {});
              }
            }
          }
        }

        if (op.op === 'club.add') {
          const addedClubId = op.d.id;
          const sessions = userSessions.get(userId);
          if (sessions) {
            for (const sessionId of sessions) {
              const client = clients.get(sessionId);
              if (client && !client.subscribedClubs.has(addedClubId)) {
                client.subscribedClubs.add(addedClubId);
                refCountSubscribe(redisSub, `club:${addedClubId}`, clubSubCounts).catch(() => {});
              }
            }
          }
        }

        if (op.op === 'club.remove') {
          const removedClubId = (op.d as { club_id: string }).club_id;
          const sessions = userSessions.get(userId);
          if (sessions) {
            (async () => {
              const channelsInClub = await db
                .selectFrom('channels')
                .select('id')
                .where('club_id', '=', removedClubId)
                .execute();
              const clubChannelIds = new Set(channelsInClub.map((c) => c.id));
              for (const sessionId of sessions) {
                const client = clients.get(sessionId);
                if (!client) continue;
                if (client.subscribedClubs.delete(removedClubId)) {
                  await refCountUnsubscribe(redisSub, `club:${removedClubId}`, clubSubCounts);
                }
                for (const chId of Array.from(client.subscribedChannels)) {
                  if (clubChannelIds.has(chId) && client.subscribedChannels.delete(chId)) {
                    await refCountUnsubscribe(redisSub, `channel:${chId}`, channelSubCounts);
                  }
                }
              }
            })().catch(() => {});
          }
        }
      }
    } catch {
    }
  });

  app.get('/ws', { websocket: true }, async (socket, request) => {
    const ws = socket;

    const session = await auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });
    if (!session) {
      send(ws, { op: 'error', d: { message: 'Not authenticated', code: 4001 } });
      ws.close(4001, 'Not authenticated');
      return;
    }

    const user = await db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', session.user.id)
      .executeTakeFirst();

    if (!user) {
      send(ws, { op: 'error', d: { message: 'User not found', code: 4002 } });
      ws.close(4002, 'User not found');
      return;
    }

    const sessionId = nanoid();
    const client: WsClient = {
      ws,
      userId: user.id,
      sessionId,
      subscribedChannels: new Set(),
      subscribedClubs: new Set(),
      subscribedDms: new Set(),
    };

    clients.set(sessionId, client);
    const sessions = userSessions.get(user.id) || new Set();
    sessions.add(sessionId);
    userSessions.set(user.id, sessions);

    send(ws, { op: 'ready', d: { user_id: user.id, session_id: sessionId } });

    const memberships = await db
      .selectFrom('memberships')
      .select('club_id')
      .where('user_id', '=', user.id)
      .execute();

    for (const m of memberships) {
      client.subscribedClubs.add(m.club_id);
      await refCountSubscribe(redisSub, `club:${m.club_id}`, clubSubCounts);
    }

    await refCountSubscribe(redisSub, `user:${user.id}`, userSubCounts);

    const dmMemberships = await db
      .selectFrom('dm_members')
      .select('dm_channel_id')
      .where('user_id', '=', user.id)
      .execute();

    for (const dm of dmMemberships) {
      client.subscribedDms.add(dm.dm_channel_id);
      await refCountSubscribe(redisSub, `dm:${dm.dm_channel_id}`, dmSubCounts);
    }

    await redis.set(`presence:${user.id}`, 'online', 'EX', 300);

    for (const clubId of client.subscribedClubs) {
      await redis.publish(`club:${clubId}`, JSON.stringify({ op: 'presence.update', d: { user_id: user.id, status: 'online' } }));
    }

    ws.on('message', async (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString()) as ClientOp;
        await handleClientOp(client, msg, db, redis, redisSub);
      } catch {
        send(ws, { op: 'error', d: { message: 'Invalid message' } });
      }
    });

    ws.on('close', async () => {
      const clubsToNotify = Array.from(client.subscribedClubs);
      try {
        for (const channelId of Array.from(client.subscribedChannels)) {
          if (client.subscribedChannels.delete(channelId)) {
            await refCountUnsubscribe(redisSub, `channel:${channelId}`, channelSubCounts);
          }
        }

        for (const clubId of Array.from(client.subscribedClubs)) {
          if (client.subscribedClubs.delete(clubId)) {
            await refCountUnsubscribe(redisSub, `club:${clubId}`, clubSubCounts);
          }
        }

        for (const dmId of Array.from(client.subscribedDms)) {
          if (client.subscribedDms.delete(dmId)) {
            await refCountUnsubscribe(redisSub, `dm:${dmId}`, dmSubCounts);
          }
        }

        await refCountUnsubscribe(redisSub, `user:${user.id}`, userSubCounts);
      } catch (err) {
        app.log.warn('WebSocket cleanup error: %s', err);
      }

      clients.delete(sessionId);
      const sessions = userSessions.get(user.id);
      if (sessions) {
        sessions.delete(sessionId);
        if (sessions.size === 0) {
          userSessions.delete(user.id);
          await redis.del(`presence:${user.id}`).catch(() => {});
          await redis.del(`fg:${user.id}`).catch(() => {});
          for (const clubId of clubsToNotify) {
            await redis.publish(`club:${clubId}`, JSON.stringify({ op: 'presence.update', d: { user_id: user.id, status: 'offline' } })).catch(() => {});
          }
        }
      }
    });

    const pingInterval = setInterval(() => {
      if (ws.readyState === ws.OPEN) {
        redis.set(`presence:${user.id}`, 'online', 'EX', 300).catch(() => {});
      } else {
        clearInterval(pingInterval);
      }
    }, 30000);

    ws.on('close', () => clearInterval(pingInterval));
  });
}

async function handleClientOp(
  client: WsClient,
  msg: ClientOp,
  db: Kysely<Database>,
  redis: Redis,
  redisSub: Redis,
) {
  switch (msg.op) {
    case 'ping':
      send(client.ws, { op: 'pong' });
      break;

    case 'subscribe': {
      const { channel_id } = msg.d;

      const channel = await db
        .selectFrom('channels')
        .select('club_id')
        .where('id', '=', channel_id)
        .executeTakeFirst();

      if (!channel) {
        send(client.ws, { op: 'error', d: { message: 'Channel not found' } });
        return;
      }

      const membership = await db
        .selectFrom('memberships')
        .select('id')
        .where('user_id', '=', client.userId)
        .where('club_id', '=', channel.club_id)
        .executeTakeFirst();

      if (!membership) {
        send(client.ws, { op: 'error', d: { message: 'Not a member' } });
        return;
      }

      if (!client.subscribedChannels.has(channel_id)) {
        client.subscribedChannels.add(channel_id);
        await refCountSubscribe(redisSub, `channel:${channel_id}`, channelSubCounts);
      }
      break;
    }

    case 'unsubscribe': {
      const { channel_id } = msg.d;
      if (client.subscribedChannels.has(channel_id)) {
        client.subscribedChannels.delete(channel_id);
        await refCountUnsubscribe(redisSub, `channel:${channel_id}`, channelSubCounts);
      }
      break;
    }

    case 'message.send': {
      const { channel_id, content, nonce } = msg.d;

      if (!content || !content.trim() || content.length > 4000) {
        send(client.ws, { op: 'error', d: { message: 'Invalid content' } });
        return;
      }

      const channel = await db
        .selectFrom('channels')
        .select('club_id')
        .where('id', '=', channel_id)
        .executeTakeFirst();

      if (!channel) return;

      const perms = await computePermissions(db, client.userId, channel.club_id);
      if (!hasPermission(perms, Permissions.SEND_MESSAGES)) {
        send(client.ws, { op: 'error', d: { message: 'Missing permission' } });
        return;
      }

      const message = await db
        .insertInto('messages')
        .values({ channel_id, author_id: client.userId, content })
        .returningAll()
        .executeTakeFirstOrThrow();

      const user = await db
        .selectFrom('users')
        .selectAll()
        .where('id', '=', client.userId)
        .executeTakeFirstOrThrow();

      const apiMessage = {
        id: message.id,
        channel_id: message.channel_id,
        nonce,
        author: {
          id: user.id,
          name: user.username,
          avatar_url: user.avatar_key ? getPublicUrl(user.avatar_key) : null,
        },
        content: message.content,
        attachments: [],
        reactions: [],
        edited_at: null,
        deleted: false,
        created_at: message.created_at.toISOString(),
      };

      await redis.publish(`channel:${channel_id}`, JSON.stringify({ op: 'message.create', d: apiMessage }));
      await afterChannelMessage(db, redis, channel_id, channel.club_id, client.userId, message.created_at);
      void sendPushForChannelMessage(db, redis, apiMessage, channel.club_id);
      break;
    }

    case 'typing.start': {
      const { channel_id } = msg.d;

      if (!client.subscribedChannels.has(channel_id)) return;

      const user = await db
        .selectFrom('users')
        .select('username')
        .where('id', '=', client.userId)
        .executeTakeFirst();

      if (user) {
        await redis.publish(
          `channel:${channel_id}`,
          JSON.stringify({
            op: 'typing.start',
            d: { channel_id, user_id: client.userId, name: user.username },
          }),
        );
      }
      break;
    }

    case 'dm.typing.start': {
      const { dm_channel_id } = msg.d;

      if (!client.subscribedDms.has(dm_channel_id)) return;

      const user = await db
        .selectFrom('users')
        .select('username')
        .where('id', '=', client.userId)
        .executeTakeFirst();

      if (user) {
        await redis.publish(
          `dm:${dm_channel_id}`,
          JSON.stringify({
            op: 'dm.typing.start',
            d: { dm_channel_id, user_id: client.userId, name: user.username },
          }),
        );
      }
      break;
    }

    case 'focus': {
      const { conversation_id } = msg.d;
      if (conversation_id) {
        await redis.set(`fg:${client.userId}`, conversation_id, 'EX', 60);
      } else {
        await redis.del(`fg:${client.userId}`);
      }
      break;
    }

    case 'presence.update': {
      const { status } = msg.d;
      if (!VALID_PRESENCE.has(status)) return;
      await redis.set(`presence:${client.userId}`, status, 'EX', 300);
      for (const clubId of client.subscribedClubs) {
        await redis.publish(
          `club:${clubId}`,
          JSON.stringify({
            op: 'presence.update',
            d: { user_id: client.userId, status },
          }),
        );
      }
      break;
    }
  }
}
