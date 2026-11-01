import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database } from '../db/database.js';
import { createAuthMiddleware } from '../middleware.js';
import { AccessToken, TrackSource } from 'livekit-server-sdk';
import { config } from '../config.js';
import { getPublicUrl } from '../storage.js';
import type Redis from 'ioredis';

const RING_TTL = 35;

export async function endActiveDmCall(db: Kysely<Database>, redis: Redis, dmChannelId: string, exceptUserId?: string) {
  const removed = await redis.del(`call:active:${dmChannelId}`);
  if (!removed) return;
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

    const ringSet = await redis.set(
      `call:ringing:${dmChannelId}`,
      JSON.stringify({ callerId: userId, calleeId }),
      'EX',
      RING_TTL,
      'NX',
    );
    if (!ringSet) {
      return reply.status(409).send({ error: 'Call already in progress' });
    }

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

    return { ok: true };
  });

  app.post('/api/dm/:dmChannelId/call/accept', { preHandler: requireAuth }, async (request, reply) => {
    const { dmChannelId } = request.params as { dmChannelId: string };
    const userId = request.userId!;

    const channel = await validateDmMembership(dmChannelId, userId);
    if (!channel) return reply.status(403).send({ error: 'Not a member' });

    const ringingRaw = await redis.get(`call:ringing:${dmChannelId}`);
    if (!ringingRaw) return reply.status(404).send({ error: 'No incoming call' });

    const ringing = JSON.parse(ringingRaw);
    if (ringing.calleeId !== userId) return reply.status(403).send({ error: 'You are not the callee' });

    await redis.del(`call:ringing:${dmChannelId}`);
    await redis.set(
      `call:active:${dmChannelId}`,
      JSON.stringify({ userIds: [ringing.callerId, userId] }),
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

    const ringing = JSON.parse(ringingRaw);
    if (ringing.calleeId !== userId) return reply.status(403).send({ error: 'You are not the callee' });

    await redis.del(`call:ringing:${dmChannelId}`);

    await redis.publish(
      `user:${ringing.callerId}`,
      JSON.stringify({ op: 'call.rejected', d: { dm_channel_id: dmChannelId } }),
    );

    return { ok: true };
  });

  app.post('/api/dm/:dmChannelId/call/end', { preHandler: requireAuth }, async (request, reply) => {
    const { dmChannelId } = request.params as { dmChannelId: string };
    const userId = request.userId!;

    const channel = await validateDmMembership(dmChannelId, userId);
    if (!channel) return reply.status(403).send({ error: 'Not a member' });

    const otherId = await getOtherMemberId(dmChannelId, userId);

    await redis.del(`call:ringing:${dmChannelId}`);
    await redis.del(`call:active:${dmChannelId}`);

    if (otherId) {
      await redis.publish(
        `user:${otherId}`,
        JSON.stringify({ op: 'call.ended', d: { dm_channel_id: dmChannelId } }),
      );
    }

    return { ok: true };
  });
}
