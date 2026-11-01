import { sql, type Kysely } from 'kysely';
import { VALENTINO_ID, VALENTINO_WELCOME } from '@wazam/shared';
import type { Database } from './db/database.js';

export async function befriendValentino(db: Kysely<Database>, userId: string) {
  return db.transaction().execute(async (trx) => {
    const lockKey = [userId, VALENTINO_ID].sort().join(':');
    await sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`.execute(trx);

    const friendship = await trx
      .insertInto('friendships')
      .values({ requester_id: VALENTINO_ID, addressee_id: userId, status: 'accepted' })
      .onConflict((oc) => oc.doNothing())
      .returningAll()
      .executeTakeFirst();

    const existing = await trx
      .selectFrom('dm_channels')
      .innerJoin('dm_members as m1', (join) =>
        join.onRef('m1.dm_channel_id', '=', 'dm_channels.id').on('m1.user_id', '=', VALENTINO_ID),
      )
      .innerJoin('dm_members as m2', (join) =>
        join.onRef('m2.dm_channel_id', '=', 'dm_channels.id').on('m2.user_id', '=', userId),
      )
      .select('dm_channels.id')
      .where('dm_channels.type', '=', 'direct')
      .executeTakeFirst();

    let dmChannelId = existing?.id;
    if (!dmChannelId) {
      const created = await trx
        .insertInto('dm_channels')
        .values({ type: 'direct', owner_id: null })
        .returning('id')
        .executeTakeFirstOrThrow();
      dmChannelId = created.id;
      await trx
        .insertInto('dm_members')
        .values([
          { dm_channel_id: dmChannelId, user_id: VALENTINO_ID },
          { dm_channel_id: dmChannelId, user_id: userId },
        ])
        .onConflict((oc) => oc.doNothing())
        .execute();
    }

    const hasWelcome = await trx
      .selectFrom('dm_messages')
      .select('id')
      .where('dm_channel_id', '=', dmChannelId)
      .where('author_id', '=', VALENTINO_ID)
      .executeTakeFirst();
    if (!hasWelcome) {
      await trx
        .insertInto('dm_messages')
        .values({ dm_channel_id: dmChannelId, author_id: VALENTINO_ID, content: VALENTINO_WELCOME })
        .execute();
      await trx.updateTable('dm_channels').set({ updated_at: new Date() }).where('id', '=', dmChannelId).execute();
      await trx
        .updateTable('dm_members')
        .set({ last_read_at: new Date() })
        .where('dm_channel_id', '=', dmChannelId)
        .where('user_id', '=', VALENTINO_ID)
        .execute();
    }

    return { friendship: friendship ?? null, dmChannelId };
  });
}
