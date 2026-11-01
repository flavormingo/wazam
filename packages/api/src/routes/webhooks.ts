import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database } from '../db/database.js';
import type Redis from 'ioredis';
import { WebhookReceiver } from 'livekit-server-sdk';
import { config } from '../config.js';
import { endActiveDmCall } from './calls.js';

const ROOM_PREFIX = 'channel-';
const DM_ROOM_PREFIX = 'dm-';
const DUPLICATE_IDENTITY = 2;
const MIGRATION = 8;

export function webhookRoutes(app: FastifyInstance, db: Kysely<Database>, redis: Redis) {
  const receiver = new WebhookReceiver(config.livekitApiKey, config.livekitApiSecret);

  app.addContentTypeParser('application/webhook+json', { parseAs: 'string' }, (_req, body, done) => {
    done(null, body);
  });

  app.post('/api/livekit/webhook', async (request, reply) => {
    let event;
    try {
      event = await receiver.receive(request.body as string, request.headers.authorization);
    } catch {
      return reply.status(401).send({ error: 'Invalid webhook signature' });
    }

    let joined: boolean;
    if (event.event === 'participant_joined') joined = true;
    else if (event.event === 'participant_left') joined = false;
    else return { ok: true };

    const roomName = event.room?.name;
    const userId = event.participant?.identity;

    if (roomName?.startsWith(DM_ROOM_PREFIX) && userId && !joined) {
      const reason = event.participant?.disconnectReason;
      if (reason === DUPLICATE_IDENTITY || reason === MIGRATION) return { ok: true };
      const dmChannelId = roomName.slice(DM_ROOM_PREFIX.length);
      const activeRaw = await redis.get(`call:active:${dmChannelId}`);
      if (activeRaw && JSON.parse(activeRaw).userIds?.includes(userId)) {
        await endActiveDmCall(db, redis, dmChannelId);
      }
      return { ok: true };
    }

    if (!roomName || !roomName.startsWith(ROOM_PREFIX) || !userId) return { ok: true };
    const channelId = roomName.slice(ROOM_PREFIX.length);

    const channel = await db
      .selectFrom('channels')
      .select('club_id')
      .where('id', '=', channelId)
      .executeTakeFirst();
    if (!channel) return { ok: true };

    if (joined) await redis.sadd(`voice:${channelId}`, userId);
    else await redis.srem(`voice:${channelId}`, userId);

    await redis.publish(
      `club:${channel.club_id}`,
      JSON.stringify({
        op: 'voice.state',
        d: { channel_id: channelId, user_id: userId, muted: false, deafened: false, streaming: false, joined },
      }),
    );

    return { ok: true };
  });
}
