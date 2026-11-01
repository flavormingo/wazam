import 'dotenv/config';
import pg from 'pg';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { nanoid } from 'nanoid';
import { VALENTINO_ID, VALENTINO_USERNAME, VALENTINO_DISPLAY_NAME, VALENTINO_AVATAR_KEY } from '@wazup/shared';
import type { Database } from './database.js';
import { befriendValentino } from '../valentino.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new pg.Pool({ connectionString }),
  }),
});

async function migrate() {
  console.log('Running migrations...');

  await sql`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`.execute(db);

  await db.schema
    .createTable('users')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('email', 'varchar(255)', (col) => col.notNull().unique())
    .addColumn('email_verified', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('display_name', 'varchar(64)')
    .addColumn('image', 'varchar(512)')
    .addColumn('username', 'varchar(32)', (col) => col.unique())
    .addColumn('displayUsername', 'varchar(32)')
    .addColumn('avatar_key', 'varchar(512)')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable('sessions')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('token', 'text', (col) => col.notNull().unique())
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('ip_address', 'varchar(255)')
    .addColumn('user_agent', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable('accounts')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('account_id', 'varchar(255)', (col) => col.notNull())
    .addColumn('provider_id', 'varchar(255)', (col) => col.notNull())
    .addColumn('access_token', 'text')
    .addColumn('refresh_token', 'text')
    .addColumn('access_token_expires_at', 'timestamptz')
    .addColumn('refresh_token_expires_at', 'timestamptz')
    .addColumn('scope', 'text')
    .addColumn('id_token', 'text')
    .addColumn('password', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable('verifications')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('identifier', 'varchar(255)', (col) => col.notNull())
    .addColumn('value', 'text', (col) => col.notNull())
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable('clubs')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('name', 'varchar(100)', (col) => col.notNull())
    .addColumn('icon_key', 'varchar(512)')
    .addColumn('owner_id', 'uuid', (col) => col.notNull().references('users.id'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable('channels')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('club_id', 'uuid', (col) => col.notNull().references('clubs.id').onDelete('cascade'))
    .addColumn('name', 'varchar(100)', (col) => col.notNull())
    .addColumn('type', 'varchar(10)', (col) => col.notNull().defaultTo('text'))
    .addColumn('position', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable('messages')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('channel_id', 'uuid', (col) => col.notNull().references('channels.id').onDelete('cascade'))
    .addColumn('author_id', 'uuid', (col) => col.notNull().references('users.id'))
    .addColumn('content', 'text', (col) => col.notNull())
    .addColumn('edited_at', 'timestamptz')
    .addColumn('deleted', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('idx_messages_channel_created')
    .ifNotExists()
    .on('messages')
    .columns(['channel_id', 'created_at'])
    .execute();

  await db.schema
    .createTable('attachments')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('message_id', 'uuid', (col) => col.references('messages.id').onDelete('cascade'))
    .addColumn('filename', 'varchar(512)', (col) => col.notNull())
    .addColumn('content_type', 'varchar(255)', (col) => col.notNull())
    .addColumn('size', 'integer', (col) => col.notNull())
    .addColumn('storage_key', 'varchar(512)', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable('message_reactions')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('message_id', 'uuid', (col) => col.notNull().references('messages.id').onDelete('cascade'))
    .addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('emoji', 'varchar(32)', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('idx_message_reactions_unique')
    .ifNotExists()
    .on('message_reactions')
    .columns(['message_id', 'user_id', 'emoji'])
    .unique()
    .execute();

  await db.schema
    .createIndex('idx_message_reactions_message')
    .ifNotExists()
    .on('message_reactions')
    .column('message_id')
    .execute();

  await db.schema
    .createTable('memberships')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id'))
    .addColumn('club_id', 'uuid', (col) => col.notNull().references('clubs.id').onDelete('cascade'))
    .addColumn('nickname', 'varchar(64)')
    .addColumn('joined_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('idx_memberships_user_club')
    .ifNotExists()
    .on('memberships')
    .columns(['user_id', 'club_id'])
    .unique()
    .execute();

  await db.schema
    .createTable('roles')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('club_id', 'uuid', (col) => col.notNull().references('clubs.id').onDelete('cascade'))
    .addColumn('name', 'varchar(64)', (col) => col.notNull())
    .addColumn('permissions', 'varchar(64)', (col) => col.notNull().defaultTo('0'))
    .addColumn('position', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('is_default', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('color', 'varchar(7)')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable('member_roles')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('membership_id', 'uuid', (col) => col.notNull().references('memberships.id').onDelete('cascade'))
    .addColumn('role_id', 'uuid', (col) => col.notNull().references('roles.id').onDelete('cascade'))
    .execute();

  await db.schema
    .createIndex('idx_member_roles_unique')
    .ifNotExists()
    .on('member_roles')
    .columns(['membership_id', 'role_id'])
    .unique()
    .execute();

  await db.schema
    .createTable('invites')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('club_id', 'uuid', (col) => col.notNull().references('clubs.id').onDelete('cascade'))
    .addColumn('creator_id', 'uuid', (col) => col.notNull().references('users.id'))
    .addColumn('code', 'varchar(20)', (col) => col.notNull().unique())
    .addColumn('max_uses', 'integer')
    .addColumn('uses', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('expires_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable('bans')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('club_id', 'uuid', (col) => col.notNull().references('clubs.id').onDelete('cascade'))
    .addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id'))
    .addColumn('reason', 'text')
    .addColumn('banned_by', 'uuid', (col) => col.notNull().references('users.id'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('idx_bans_club_user')
    .ifNotExists()
    .on('bans')
    .columns(['club_id', 'user_id'])
    .unique()
    .execute();

  await db.schema
    .createTable('audit_log')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('club_id', 'uuid', (col) => col.notNull().references('clubs.id').onDelete('cascade'))
    .addColumn('actor_id', 'uuid', (col) => col.notNull().references('users.id'))
    .addColumn('action', 'varchar(50)', (col) => col.notNull())
    .addColumn('target_type', 'varchar(50)', (col) => col.notNull())
    .addColumn('target_id', 'varchar(255)', (col) => col.notNull())
    .addColumn('metadata', 'jsonb')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('idx_audit_log_club_created')
    .ifNotExists()
    .on('audit_log')
    .columns(['club_id', 'created_at'])
    .execute();

  await db.schema
    .createIndex('idx_channels_club_id')
    .ifNotExists()
    .on('channels')
    .column('club_id')
    .execute();

  await db.schema
    .createIndex('idx_roles_club_id')
    .ifNotExists()
    .on('roles')
    .column('club_id')
    .execute();

  await db.schema
    .createIndex('idx_memberships_club_id')
    .ifNotExists()
    .on('memberships')
    .column('club_id')
    .execute();

  await db.schema
    .createIndex('idx_messages_author_id')
    .ifNotExists()
    .on('messages')
    .column('author_id')
    .execute();

  await sql`ALTER TABLE attachments ALTER COLUMN message_id DROP NOT NULL`.execute(db).catch(() => {});

  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS status_emoji varchar(8)`.execute(db).catch(() => {});
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS status_text varchar(30)`.execute(db).catch(() => {});
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS bio varchar(190)`.execute(db).catch(() => {});
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS location varchar(100)`.execute(db).catch(() => {});
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS banner_key varchar(512)`.execute(db).catch(() => {});
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS link varchar(256)`.execute(db).catch(() => {});
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS connections jsonb`.execute(db).catch(() => {});
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS friend_privacy varchar(24) NOT NULL DEFAULT 'everyone'`.execute(db).catch(() => {});
  await sql`ALTER TABLE users ALTER COLUMN bio TYPE varchar(200)`.execute(db).catch(() => {});

  await db.schema
    .createTable('friendships')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('requester_id', 'uuid', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('addressee_id', 'uuid', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('status', 'varchar(10)', (col) => col.notNull().defaultTo('pending'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('idx_friendships_unique')
    .ifNotExists()
    .on('friendships')
    .columns(['requester_id', 'addressee_id'])
    .unique()
    .execute();

  await sql`
    DELETE FROM friendships f
    USING friendships g
    WHERE LEAST(f.requester_id, f.addressee_id) = LEAST(g.requester_id, g.addressee_id)
      AND GREATEST(f.requester_id, f.addressee_id) = GREATEST(g.requester_id, g.addressee_id)
      AND f.id <> g.id
      AND (
        (g.status = 'accepted' AND f.status <> 'accepted')
        OR (g.status = f.status AND g.created_at < f.created_at)
        OR (g.status = f.status AND g.created_at = f.created_at AND g.id < f.id)
      )
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_friendships_pair
    ON friendships (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id))
  `.execute(db);

  await db.schema
    .createIndex('idx_friendships_addressee')
    .ifNotExists()
    .on('friendships')
    .column('addressee_id')
    .execute();

  await db.schema
    .createTable('dm_channels')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('type', 'varchar(10)', (col) => col.notNull().defaultTo('direct'))
    .addColumn('name', 'varchar(64)')
    .addColumn('owner_id', 'uuid', (col) => col.references('users.id'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable('dm_members')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('dm_channel_id', 'uuid', (col) => col.notNull().references('dm_channels.id').onDelete('cascade'))
    .addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('joined_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('idx_dm_members_unique')
    .ifNotExists()
    .on('dm_members')
    .columns(['dm_channel_id', 'user_id'])
    .unique()
    .execute();

  await db.schema
    .createIndex('idx_dm_members_user')
    .ifNotExists()
    .on('dm_members')
    .column('user_id')
    .execute();

  await db.schema
    .createTable('dm_messages')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('dm_channel_id', 'uuid', (col) => col.notNull().references('dm_channels.id').onDelete('cascade'))
    .addColumn('author_id', 'uuid', (col) => col.notNull().references('users.id'))
    .addColumn('content', 'text', (col) => col.notNull())
    .addColumn('edited_at', 'timestamptz')
    .addColumn('deleted', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('idx_dm_messages_channel_created')
    .ifNotExists()
    .on('dm_messages')
    .columns(['dm_channel_id', 'created_at'])
    .execute();

  await db.schema
    .createTable('dm_message_reactions')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('dm_message_id', 'uuid', (col) => col.notNull().references('dm_messages.id').onDelete('cascade'))
    .addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('emoji', 'varchar(32)', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('idx_dm_message_reactions_unique')
    .ifNotExists()
    .on('dm_message_reactions')
    .columns(['dm_message_id', 'user_id', 'emoji'])
    .unique()
    .execute();

  await db.schema
    .createIndex('idx_dm_message_reactions_message')
    .ifNotExists()
    .on('dm_message_reactions')
    .column('dm_message_id')
    .execute();

  await sql`UPDATE roles SET permissions = CAST(CAST(permissions AS bigint) | 512 AS varchar) WHERE is_default = true`.execute(db).catch(() => {});

  await sql`ALTER TABLE messages ALTER COLUMN author_id DROP NOT NULL`.execute(db).catch(() => {});
  await sql`ALTER TABLE dm_messages ALTER COLUMN author_id DROP NOT NULL`.execute(db).catch(() => {});
  await sql`ALTER TABLE invites ALTER COLUMN creator_id DROP NOT NULL`.execute(db).catch(() => {});
  await sql`ALTER TABLE bans ALTER COLUMN banned_by DROP NOT NULL`.execute(db).catch(() => {});
  await sql`ALTER TABLE audit_log ALTER COLUMN actor_id DROP NOT NULL`.execute(db).catch(() => {});

  await sql`ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_author_id_fkey`.execute(db).catch(() => {});
  await sql`ALTER TABLE messages ADD CONSTRAINT messages_author_id_fkey FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL`.execute(db).catch(() => {});

  await sql`ALTER TABLE dm_messages DROP CONSTRAINT IF EXISTS dm_messages_author_id_fkey`.execute(db).catch(() => {});
  await sql`ALTER TABLE dm_messages ADD CONSTRAINT dm_messages_author_id_fkey FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL`.execute(db).catch(() => {});

  await sql`ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_user_id_fkey`.execute(db).catch(() => {});
  await sql`ALTER TABLE memberships ADD CONSTRAINT memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`.execute(db).catch(() => {});

  await sql`ALTER TABLE invites DROP CONSTRAINT IF EXISTS invites_creator_id_fkey`.execute(db).catch(() => {});
  await sql`ALTER TABLE invites ADD CONSTRAINT invites_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE SET NULL`.execute(db).catch(() => {});

  await sql`ALTER TABLE bans DROP CONSTRAINT IF EXISTS bans_user_id_fkey`.execute(db).catch(() => {});
  await sql`ALTER TABLE bans ADD CONSTRAINT bans_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`.execute(db).catch(() => {});

  await sql`ALTER TABLE bans DROP CONSTRAINT IF EXISTS bans_banned_by_fkey`.execute(db).catch(() => {});
  await sql`ALTER TABLE bans ADD CONSTRAINT bans_banned_by_fkey FOREIGN KEY (banned_by) REFERENCES users(id) ON DELETE SET NULL`.execute(db).catch(() => {});

  await sql`ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_actor_id_fkey`.execute(db).catch(() => {});
  await sql`ALTER TABLE audit_log ADD CONSTRAINT audit_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL`.execute(db).catch(() => {});

  await sql`ALTER TABLE clubs DROP CONSTRAINT IF EXISTS clubs_owner_id_fkey`.execute(db).catch(() => {});
  await sql`ALTER TABLE clubs ADD CONSTRAINT clubs_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE`.execute(db).catch(() => {});

  await sql`ALTER TABLE dm_channels DROP CONSTRAINT IF EXISTS dm_channels_owner_id_fkey`.execute(db).catch(() => {});
  await sql`ALTER TABLE dm_channels ADD CONSTRAINT dm_channels_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL`.execute(db).catch(() => {});

  await sql`ALTER TABLE clubs ADD COLUMN IF NOT EXISTS slug varchar(30) UNIQUE`.execute(db).catch(() => {});

  const clubsWithoutSlug = await db
    .selectFrom('clubs')
    .select('id')
    .where('slug', 'is', null)
    .execute();

  for (const club of clubsWithoutSlug) {
    const slug = nanoid(8).toLowerCase();
    await db.updateTable('clubs').set({ slug }).where('id', '=', club.id).execute();
  }

  const clubsWithoutAdmin = await sql<{ id: string }>`
    SELECT c.id FROM clubs c
    WHERE NOT EXISTS (
      SELECT 1 FROM roles r WHERE r.club_id = c.id AND CAST(r.permissions AS bigint) & (1 << 10) != 0
    )
  `.execute(db);

  for (const club of clubsWithoutAdmin.rows) {
    await db.insertInto('roles').values({
      club_id: club.id,
      name: 'admin',
      permissions: (1n << 10n | 1n << 4n | 1n << 3n | 1n << 2n | 1n << 5n | 1n << 6n | 1n << 13n | 1n << 1n | 1n << 0n | 1n << 7n | 1n << 8n | 1n << 9n | 1n << 11n | 1n << 12n).toString(),
      position: 1,
      is_default: false,
    }).execute().catch(() => {});
  }

  await db.schema
    .createTable('sections')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('club_id', 'uuid', (col) => col.notNull().references('clubs.id').onDelete('cascade'))
    .addColumn('name', 'varchar(100)', (col) => col.notNull())
    .addColumn('position', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('idx_sections_club_id')
    .ifNotExists()
    .on('sections')
    .column('club_id')
    .execute();

  await sql`ALTER TABLE channels ADD COLUMN IF NOT EXISTS section_id uuid REFERENCES sections(id) ON DELETE SET NULL`.execute(db).catch(() => {});

  const clubsWithoutSections = await sql<{ id: string }>`
    SELECT c.id FROM clubs c
    WHERE NOT EXISTS (SELECT 1 FROM sections s WHERE s.club_id = c.id)
  `.execute(db);

  for (const club of clubsWithoutSections.rows) {
    const textSection = await db.insertInto('sections')
      .values({ club_id: club.id, name: 'text channels', position: 0 })
      .returning('id')
      .executeTakeFirstOrThrow();

    const voiceSection = await db.insertInto('sections')
      .values({ club_id: club.id, name: 'voice channels', position: 1 })
      .returning('id')
      .executeTakeFirstOrThrow();

    await sql`UPDATE channels SET section_id = ${textSection.id} WHERE club_id = ${club.id} AND type = 'text' AND section_id IS NULL`.execute(db);
    await sql`UPDATE channels SET section_id = ${voiceSection.id} WHERE club_id = ${club.id} AND type = 'voice' AND section_id IS NULL`.execute(db);
  }

  await sql`ALTER TABLE channels ADD COLUMN IF NOT EXISTS last_message_at timestamptz`.execute(db).catch(() => {});

  await sql`
    UPDATE channels SET last_message_at = (
      SELECT MAX(created_at) FROM messages WHERE messages.channel_id = channels.id
    ) WHERE last_message_at IS NULL
  `.execute(db).catch(() => {});

  await sql`ALTER TABLE dm_members ADD COLUMN IF NOT EXISTS last_read_at timestamptz`.execute(db).catch(() => {});

  await sql`
    UPDATE dm_members SET last_read_at = now()
    WHERE last_read_at IS NULL OR last_read_at < (
      SELECT updated_at FROM dm_channels WHERE dm_channels.id = dm_members.dm_channel_id
    )
  `.execute(db).catch(() => {});

  await sql`
    CREATE TABLE IF NOT EXISTS channel_reads (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, channel_id)
    )
  `.execute(db).catch(() => {});

  await sql`
    INSERT INTO channel_reads (user_id, channel_id, last_read_at)
    SELECT m.user_id, c.id, now()
    FROM memberships m
    JOIN channels c ON c.club_id = m.club_id
    ON CONFLICT DO NOTHING
  `.execute(db).catch(() => {});

  await sql`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      ua TEXT,
      failure_count INTEGER NOT NULL DEFAULT 0,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);

  await sql`CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id)`.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS notification_settings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      scope_type VARCHAR(12) NOT NULL,
      scope_id UUID NOT NULL,
      muted BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (user_id, scope_type, scope_id)
    )
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS notification_prefs (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      mode VARCHAR(12) NOT NULL DEFAULT 'all',
      dnd_until TIMESTAMPTZ,
      quiet_start SMALLINT,
      quiet_end SMALLINT,
      quiet_tz VARCHAR(48),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);

  await sql`
    INSERT INTO users (id, email, email_verified, display_name, username, "displayUsername", avatar_key, status_emoji, status_text, bio, friend_privacy)
    VALUES (
      ${VALENTINO_ID},
      ${'valentino@wazup.chat'},
      true,
      ${VALENTINO_DISPLAY_NAME},
      ${VALENTINO_USERNAME},
      ${VALENTINO_DISPLAY_NAME},
      ${VALENTINO_AVATAR_KEY},
      ${'🐾'},
      ${'say wazup'},
      ${"hi, i'm valentino — your first friend on wazup. i'll show you around."},
      'everyone'
    )
    ON CONFLICT (id) DO UPDATE SET
      email_verified = true,
      display_name = EXCLUDED.display_name,
      username = EXCLUDED.username,
      "displayUsername" = EXCLUDED."displayUsername",
      avatar_key = EXCLUDED.avatar_key,
      status_emoji = EXCLUDED.status_emoji,
      status_text = EXCLUDED.status_text,
      bio = EXCLUDED.bio
  `.execute(db).catch((err) => {
    console.error('ensureValentino failed:', err);
  });

  const toBackfill = await sql<{ id: string }>`
    SELECT u.id FROM users u
    WHERE u.email_verified = true
      AND u.id <> ${VALENTINO_ID}
      AND NOT EXISTS (
        SELECT 1 FROM dm_channels dc
          JOIN dm_members m1 ON m1.dm_channel_id = dc.id AND m1.user_id = ${VALENTINO_ID}
          JOIN dm_members m2 ON m2.dm_channel_id = dc.id AND m2.user_id = u.id
         WHERE dc.type = 'direct'
      )
  `.execute(db).catch(() => ({ rows: [] as { id: string }[] }));

  for (const row of toBackfill.rows) {
    await befriendValentino(db, row.id).catch((err) => console.error('Valentino backfill failed for', row.id, err));
  }

  console.log('Migrations complete!');
  await db.destroy();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
