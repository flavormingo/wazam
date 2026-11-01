import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database } from '../db/database.js';
import { createAuthMiddleware } from '../middleware.js';
import { AccessToken, TrackSource } from 'livekit-server-sdk';
import { config } from '../config.js';
import { getPublicUrl } from '../storage.js';
import { sendPushForDmMessage, sendPushForIncomingCall } from '../push.js';
import { describeCall, type ApiDmMessage, type DmCallStatus } from '@wazam/shared';
import { nanoid } from 'nanoid';
import type Redis from 'ioredis';

const RING_TTL = 40;
const RING_TIMEOUT = 35000;

interface RingingCall {
  callId?: string;
  callerId: string;
  calleeId: string;
}

interface ActiveCall {
  callId?: string;
  callerId?: string;
  userIds: string[];
  startedAt?: number;
}

const ringTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearRingTimer(dmChannelId: string) {
  clearTimeout(ringTimers.get(dmChannelId));
  ringTimers.delete(dmChannelId);
}

async function takeKey<T>(redis: Redis, key: string): Promise<T | null> {
  const raw = await redis.getdel(key);
  return raw ? (JSON.parse(raw) as T) : null;
}

async function notifyCallEnded(db: Kysely<Database>, redis: Redis, dmChannelId: string, exceptUserId?: string) {
  const members = await db
    .selectFrom('dm_members')
    .select('user_id')
    .where('dm_channel_id', '=', dmChannelId)
    .execute();
  for (const m of members) {
    if (m.user_id === exceptUserId) continue;
    await redis.publish(`user:${m.user_id}`, JSON.stringify({ op: 'call.ended', d: { dm_channel_id: dmChannelId } }));
  }
}

async function recordCallMessage(
  db: Kysely<Database>,
  redis: Redis,
  dmChannelId: string,
  callerId: string,
  status: DmCallStatus,
  duration: number | null,
) {
  try {
    const channel = await db
      .selectFrom('dm_channels')
      .select('updated_at')
      .where('id', '=', dmChannelId)
      .executeTakeFirst();
    if (!channel) return;

    const call = { status, duration };
    const now = new Date();
    const message = await db
      .insertInto('dm_messages')
      .values({
        dm_channel_id: dmChannelId,
        author_id: callerId,
        content: describeCall(call, false),
        call_status: status,
        call_duration: duration,
        created_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await db.updateTable('dm_channels').set({ updated_at: now }).where('id', '=', dmChannelId).execute();
    await db
      .updateTable('dm_members')
      .set({ last_read_at: now })
      .where('dm_channel_id', '=', dmChannelId)
      .where((eb) =>
        status === 'missed'
          ? eb('user_id', '=', callerId)
          : eb.or([eb('user_id', '=', callerId), eb('last_read_at', '>=', channel.updated_at)]),
      )
      .execute();

    const author = await db
      .selectFrom('users')
      .select(['username', 'avatar_key'])
      .where('id', '=', callerId)
      .executeTakeFirst();

    const apiMessage: ApiDmMessage = {
      id: message.id,
      dm_channel_id: dmChannelId,
      author: {
        id: callerId,
        name: author?.username ?? 'deleted user',
        avatar_url: author?.avatar_key ? getPublicUrl(author.avatar_key) : null,
      },
      content: message.content,
      call,
      reactions: [],
      edited_at: null,
      deleted: false,
      created_at: message.created_at.toISOString(),
    };

    await redis.publish(`dm:${dmChannelId}`, JSON.stringify({ op: 'dm.message.create', d: apiMessage }));
    if (status === 'missed') void sendPushForDmMessage(db, redis, apiMessage);
  } catch (err) {
    console.error('recordCallMessage failed:', err);
  }
}

export async function endActiveDmCall(db: Kysely<Database>, redis: Redis, dmChannelId: string, exceptUserId?: string) {
  const active = await takeKey<ActiveCall>(redis, `call:active:${dmChannelId}`);
  if (!active) return false;
  await notifyCallEnded(db, redis, dmChannelId, exceptUserId);
  const duration = active.startedAt ? Math.round((Date.now() - active.startedAt) / 1000) : null;
  await recordCallMessage(db, redis, dmChannelId, active.callerId ?? active.userIds[0], 'completed', duration);
  return true;
}

export async function getPendingIncomingCall(db: Kysely<Database>, redis: Redis, userId: string) {
  const dmChannelId = await redis.get(`call:incoming:${userId}`);
  if (!dmChannelId) return null;
  const raw = await redis.get(`call:ringing:${dmChannelId}`);
  const ringing = raw ? (JSON.parse(raw) as RingingCall) : null;
  if (ringing?.calleeId !== userId) return null;
  const caller = await db
    .selectFrom('users')
    .select(['id', 'username', 'avatar_key'])
    .where('id', '=', ringing.callerId)
    .executeTakeFirst();
  if (!caller) return null;
  return {
    dm_channel_id: dmChannelId,
    caller: {
      id: caller.id,
      username: caller.username,
      display_name: caller.username,
      avatar_url: caller.avatar_key ? getPublicUrl(caller.avatar_key) : null,
    },
  };
}

async function expireRing(db: Kysely<Database>, redis: Redis, dmChannelId: string, callId: string) {
  try {
    const raw = await redis.get(`call:ringing:${dmChannelId}`);
    if (!raw || (JSON.parse(raw) as RingingCall).callId !== callId) return;
    const ringing = await takeKey<RingingCall>(redis, `call:ringing:${dmChannelId}`);
    if (!ringing) return;
    await notifyCallEnded(db, redis, dmChannelId);
    await recordCallMessage(db, redis, dmChannelId, ringing.callerId, 'missed', null);
  } catch (err) {
    console.error('expireRing failed:', err);
  }
}

export function callRoutes(app: FastifyInstance, db: Kysely<Database>, redis: Redis) {
  const requireAuth = createAuthMiddleware(db);

  async function validateDmMembership(dmChannelId: string, userId: string) {
    const channel = await db
      .selectFrom('dm_channels')
      .selectAll()
      .where('id', '=', dmChannelId)
      .executeTakeFirst();

    if (!channel) return null;

    const membership = await db
      .selectFrom('dm_members')
      .select('id')
      .where('dm_channel_id', '=', dmChannelId)
      .where('user_id', '=', userId)
      .executeTakeFirst();

    if (!membership) return null;
    return channel;
  }

  async function getOtherMemberId(dmChannelId: string, userId: string): Promise<string | null> {
    const other = await db
      .selectFrom('dm_members')
      .select('user_id')
      .where('dm_channel_id', '=', dmChannelId)
      .where('user_id', '!=', userId)
      .executeTakeFirst();

    return other?.user_id ?? null;
  }

  function createLiveKitToken(userId: string, username: string, roomName: string, avatarUrl: string | null) {
    const at = new AccessToken(config.livekitApiKey, config.livekitApiSecret, {
      identity: userId,
      name: username,
      metadata: JSON.stringify({ avatar_url: avatarUrl }),
      ttl: '1h',
    });

    at.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canPublishData: true,
      canSubscribe: true,
      canPublishSources: [
        TrackSource.MICROPHONE,
        TrackSource.CAMERA,
        TrackSource.SCREEN_SHARE,
        TrackSource.SCREEN_SHARE_AUDIO,
      ],
    });

    return at.toJwt();
  }

  app.post('/api/dm/:dmChannelId/call', { preHandler: requireAuth }, async (request, reply) => {
    const { dmChannelId } = request.params as { dmChannelId: string };
    const userId = request.userId!;

    const channel = await validateDmMembership(dmChannelId, userId);
    if (!channel) return reply.status(403).send({ error: 'Not a member' });
    if (channel.type !== 'direct') return reply.status(400).send({ error: 'Calls only supported in direct DMs' });

    await endActiveDmCall(db, redis, dmChannelId, userId);

    const calleeId = await getOtherMemberId(dmChannelId, userId);
    if (!calleeId) return reply.status(400).send({ error: 'No other member found' });

    const callId = nanoid();
    const ringSet = await redis.set(
      `call:ringing:${dmChannelId}`,
      JSON.stringify({ callId, callerId: userId, calleeId }),
      'EX',
      RING_TTL,
      'NX',
    );
    if (!ringSet) {
      return reply.status(409).send({ error: 'Call already in progress' });
    }

    clearRingTimer(dmChannelId);
    ringTimers.set(dmChannelId, setTimeout(() => {
      ringTimers.delete(dmChannelId);
      void expireRing(db, redis, dmChannelId, callId);
    }, RING_TIMEOUT));

    const user = request.user!;
    await redis.publish(
      `user:${calleeId}`,
      JSON.stringify({
        op: 'call.incoming',
        d: {
          dm_channel_id: dmChannelId,
          caller: {
            id: user.id,
            username: user.username,
            display_name: user.username,
            avatar_url: user.avatar_key ? getPublicUrl(user.avatar_key) : null,
          },
        },
      }),
    );
    await redis.set(`call:incoming:${calleeId}`, dmChannelId, 'EX', RING_TTL);
    void sendPushForIncomingCall(db, redis, dmChannelId, calleeId, user.username);

    return { ok: true };
  });

  app.post('/api/dm/:dmChannelId/call/accept', { preHandler: requireAuth }, async (request, reply) => {
    const { dmChannelId } = request.params as { dmChannelId: string };
    const userId = request.userId!;

    const channel = await validateDmMembership(dmChannelId, userId);
    if (!channel) return reply.status(403).send({ error: 'Not a member' });

    const ringingRaw = await redis.get(`call:ringing:${dmChannelId}`);
    if (!ringingRaw) return reply.status(404).send({ error: 'No incoming call' });

    const ringing = JSON.parse(ringingRaw) as RingingCall;
    if (ringing.calleeId !== userId) return reply.status(403).send({ error: 'You are not the callee' });

    const claimed = await takeKey<RingingCall>(redis, `call:ringing:${dmChannelId}`);
    if (!claimed) return reply.status(404).send({ error: 'No incoming call' });
    clearRingTimer(dmChannelId);
    await redis.set(
      `call:active:${dmChannelId}`,
      JSON.stringify({ callId: claimed.callId, callerId: claimed.callerId, userIds: [claimed.callerId, userId], startedAt: Date.now() }),
      'EX',
      7200,
    );

    const roomName = `dm-${dmChannelId}`;
    const token = await createLiveKitToken(userId, request.user!.username, roomName, request.user!.avatar_key ? getPublicUrl(request.user!.avatar_key) : null);

    for (const id of [ringing.callerId, userId]) {
      await redis.publish(`user:${id}`, JSON.stringify({ op: 'call.accepted', d: { dm_channel_id: dmChannelId } }));
    }

    return {
      token,
      url: config.livekitPublicUrl || config.livekitUrl,
      room: roomName,
    };
  });

  app.post('/api/dm/:dmChannelId/voice-token', { preHandler: requireAuth }, async (request, reply) => {
    const { dmChannelId } = request.params as { dmChannelId: string };
    const userId = request.userId!;

    const channel = await validateDmMembership(dmChannelId, userId);
    if (!channel) return reply.status(403).send({ error: 'Not a member' });

    const activeRaw = await redis.get(`call:active:${dmChannelId}`);
    if (!activeRaw) return reply.status(404).send({ error: 'No active call' });

    const active = JSON.parse(activeRaw);
    if (!active.userIds.includes(userId)) return reply.status(403).send({ error: 'Not in this call' });

    const roomName = `dm-${dmChannelId}`;
    const token = await createLiveKitToken(userId, request.user!.username, roomName, request.user!.avatar_key ? getPublicUrl(request.user!.avatar_key) : null);

    return {
      token,
      url: config.livekitPublicUrl || config.livekitUrl,
      room: roomName,
    };
  });

  app.post('/api/dm/:dmChannelId/call/reject', { preHandler: requireAuth }, async (request, reply) => {
    const { dmChannelId } = request.params as { dmChannelId: string };
    const userId = request.userId!;

    const channel = await validateDmMembership(dmChannelId, userId);
    if (!channel) return reply.status(403).send({ error: 'Not a member' });

    const ringingRaw = await redis.get(`call:ringing:${dmChannelId}`);
    if (!ringingRaw) return reply.status(404).send({ error: 'No incoming call' });

    const ringing = JSON.parse(ringingRaw) as RingingCall;
    if (ringing.calleeId !== userId) return reply.status(403).send({ error: 'You are not the callee' });

    const claimed = await takeKey<RingingCall>(redis, `call:ringing:${dmChannelId}`);
    if (!claimed) return reply.status(404).send({ error: 'No incoming call' });
    clearRingTimer(dmChannelId);

    await redis.publish(
      `user:${claimed.callerId}`,
      JSON.stringify({ op: 'call.rejected', d: { dm_channel_id: dmChannelId } }),
    );
    await recordCallMessage(db, redis, dmChannelId, claimed.callerId, 'declined', null);

    return { ok: true };
  });

  app.post('/api/dm/:dmChannelId/call/end', { preHandler: requireAuth }, async (request, reply) => {
    const { dmChannelId } = request.params as { dmChannelId: string };
    const userId = request.userId!;

    const channel = await validateDmMembership(dmChannelId, userId);
    if (!channel) return reply.status(403).send({ error: 'Not a member' });

    const otherId = await getOtherMemberId(dmChannelId, userId);

    const ringing = await takeKey<RingingCall>(redis, `call:ringing:${dmChannelId}`);
    if (ringing) clearRingTimer(dmChannelId);
    const endedActive = await endActiveDmCall(db, redis, dmChannelId, userId);

    if (otherId && !endedActive) {
      await redis.publish(
        `user:${otherId}`,
        JSON.stringify({ op: 'call.ended', d: { dm_channel_id: dmChannelId } }),
      );
    }
    if (ringing) await recordCallMessage(db, redis, dmChannelId, ringing.callerId, 'missed', null);

    return { ok: true };
  });
}
