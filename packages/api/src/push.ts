import webpush from 'web-push';
import type { Kysely } from 'kysely';
import type Redis from 'ioredis';
import type { ApiMessage, ApiDmMessage } from '@wazam/shared';
import type { Database } from './db/database.js';
import { config } from './config.js';

let enabled = false;

export function initPush() {
  if (!config.vapidPublicKey || !config.vapidPrivateKey) {
    console.log('Web Push disabled (no VAPID keys configured)');
    return;
  }
  webpush.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey);
  enabled = true;
  console.log('Web Push enabled');
}

export function pushEnabled() {
  return enabled;
}

export async function retireOldOriginSubscriptions(db: Kysely<Database>, userId: string) {
  await db
    .deleteFrom('push_subscriptions')
    .where('user_id', '=', userId)
    .where('origin', '<>', config.webUrl)
    .execute();
}

interface PushPayload {
  type: string;
  title: string;
  body: string;
  tag: string;
  url: string;
}

function preview(content: string) {
  const t = (content || '').replace(/\s+/g, ' ').trim();
  if (!t) return 'New message';
  return t.length > 140 ? `${t.slice(0, 139)}…` : t;
}

async function filterActiveConversation(redis: Redis, userIds: string[], convId: string) {
  if (!userIds.length) return userIds;
  const pipe = redis.pipeline();
  for (const id of userIds) pipe.get(`fg:${id}`);
  const res = await pipe.exec();
  if (!res) return userIds;
  return userIds.filter((_, i) => !(res[i] && res[i][1] === convId));
}

async function filterMuted(
  db: Kysely<Database>,
  userIds: string[],
  scopes: [string, string][],
) {
  if (!userIds.length) return userIds;
  const rows = await db
    .selectFrom('notification_settings')
    .select('user_id')
    .where('muted', '=', true)
    .where('user_id', 'in', userIds)
    .where((eb) =>
      eb.or(scopes.map(([type, id]) => eb.and([eb('scope_type', '=', type), eb('scope_id', '=', id)]))),
    )
    .execute();
  const muted = new Set(rows.map((r) => r.user_id));
  return userIds.filter((id) => !muted.has(id));
}

function parseMentions(content: string) {
  const names = new Set<string>();
  let everyone = false;
  const re = /@([a-z0-9_]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const n = m[1].toLowerCase();
    if (n === 'everyone' || n === 'here') everyone = true;
    else names.add(n);
  }
  return { names: [...names], everyone };
}

async function resolveMentions(db: Kysely<Database>, content: string) {
  const { names, everyone } = parseMentions(content);
  if (everyone) return { everyone: true, ids: new Set<string>() };
  if (!names.length) return { everyone: false, ids: new Set<string>() };
  const rows = await db
    .selectFrom('users')
    .select('id')
    .where((eb) => eb(eb.fn('lower', ['username']), 'in', names))
    .execute();
  return { everyone: false, ids: new Set(rows.map((r) => r.id)) };
}

function inQuietHours(
  p: { quiet_start: number | null; quiet_end: number | null; quiet_tz: string | null },
  now: Date,
) {
  if (p.quiet_start == null || p.quiet_end == null || !p.quiet_tz) return false;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: p.quiet_tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const h = Number(parts.find((x) => x.type === 'hour')?.value) % 24;
    const mm = Number(parts.find((x) => x.type === 'minute')?.value);
    const cur = h * 60 + mm;
    const s = p.quiet_start;
    const e = p.quiet_end;
    if (s === e) return false;
    return s < e ? cur >= s && cur < e : cur >= s || cur < e;
  } catch {
    return false;
  }
}

async function filterPrefs(
  db: Kysely<Database>,
  userIds: string[],
  isDm: boolean,
  isMention: (uid: string) => boolean,
) {
  if (!userIds.length) return userIds;
  const rows = await db.selectFrom('notification_prefs').selectAll().where('user_id', 'in', userIds).execute();
  const map = new Map(rows.map((r) => [r.user_id, r]));
  const now = new Date();
  return userIds.filter((uid) => {
    const p = map.get(uid);
    if (!p) return true;
    if (p.dnd_until && new Date(p.dnd_until) > now) return false;
    if (inQuietHours(p, now)) return false;
    if (p.mode === 'mentions' && !isDm && !isMention(uid)) return false;
    return true;
  });
}

async function sendToUsers(
  db: Kysely<Database>,
  userIds: string[],
  payload: PushPayload,
  urgency: 'normal' | 'high',
) {
  if (!enabled || !userIds.length) return;
  const subs = await db
    .selectFrom('push_subscriptions')
    .selectAll()
    .where('user_id', 'in', userIds)
    .execute();
  if (!subs.length) return;
  const data = JSON.stringify(payload);
  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          data,
          { TTL: 172800, urgency },
        );
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {
          await db.deleteFrom('push_subscriptions').where('id', '=', sub.id).execute().catch(() => {});
        } else {
          await db
            .updateTable('push_subscriptions')
            .set({ failure_count: sub.failure_count + 1 })
            .where('id', '=', sub.id)
            .execute()
            .catch(() => {});
        }
      }
    }),
  );
}

export async function sendPushForChannelMessage(
  db: Kysely<Database>,
  redis: Redis,
  msg: ApiMessage,
  clubId: string,
) {
  if (!enabled) return;
  try {
    const members = await db
      .selectFrom('memberships')
      .select('user_id')
      .where('club_id', '=', clubId)
      .execute();
    let recipients = members.map((m) => m.user_id).filter((id) => id !== msg.author.id);
    recipients = await filterActiveConversation(redis, recipients, `channel:${msg.channel_id}`);
    if (!recipients.length) return;
    recipients = await filterMuted(db, recipients, [
      ['channel', msg.channel_id],
      ['club', clubId],
    ]);
    if (!recipients.length) return;
    const men = await resolveMentions(db, msg.content);
    recipients = await filterPrefs(db, recipients, false, (uid) => men.everyone || men.ids.has(uid));
    if (!recipients.length) return;

    const meta = await db
      .selectFrom('channels')
      .innerJoin('clubs', 'clubs.id', 'channels.club_id')
      .select(['channels.name as channel_name', 'clubs.name as club_name', 'clubs.slug as club_slug'])
      .where('channels.id', '=', msg.channel_id)
      .executeTakeFirst();
    const channelName = meta?.channel_name ?? 'channel';
    const clubName = meta?.club_name ?? '';
    const slug = meta?.club_slug ?? clubId;

    await sendToUsers(
      db,
      recipients,
      {
        type: 'channel',
        title: `${msg.author.name} · #${channelName}${clubName ? ` · ${clubName}` : ''}`,
        body: preview(msg.content),
        tag: `channel:${msg.channel_id}`,
        url: `/club/${slug}/channel/${msg.channel_id}`,
      },
      'normal',
    );
  } catch (err) {
    console.error('sendPushForChannelMessage failed:', err);
  }
}

export async function sendPushForDmMessage(
  db: Kysely<Database>,
  redis: Redis,
  msg: ApiDmMessage,
) {
  if (!enabled) return;
  try {
    const members = await db
      .selectFrom('dm_members')
      .select('user_id')
      .where('dm_channel_id', '=', msg.dm_channel_id)
      .execute();
    let recipients = members.map((m) => m.user_id).filter((id) => id !== msg.author.id);
    recipients = await filterActiveConversation(redis, recipients, `dm:${msg.dm_channel_id}`);
    if (!recipients.length) return;
    recipients = await filterMuted(db, recipients, [['dm', msg.dm_channel_id]]);
    if (!recipients.length) return;
    recipients = await filterPrefs(db, recipients, true, () => false);
    if (!recipients.length) return;

    await sendToUsers(
      db,
      recipients,
      {
        type: 'dm',
        title: msg.author.name,
        body: preview(msg.content),
        tag: `dm:${msg.dm_channel_id}`,
        url: `/dm/${msg.dm_channel_id}`,
      },
      'high',
    );
  } catch (err) {
    console.error('sendPushForDmMessage failed:', err);
  }
}
