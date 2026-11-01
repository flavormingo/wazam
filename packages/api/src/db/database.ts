import pg from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';
import type { DmCallStatus } from '@wazam/shared';

export interface UsersTable {
  id: Generated<string>;
  email: string;
  email_verified: Generated<boolean>;
  display_name: string | null;
  image: string | null;
  username: string;
  displayUsername: string | null;
  avatar_key: string | null;
  status_emoji: string | null;
  status_text: string | null;
  bio: string | null;
  location: string | null;
  banner_key: string | null;
  link: string | null;
  connections: ColumnType<Record<string, string> | null, string | null, string | null>;
  friend_privacy: Generated<string>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface SessionsTable {
  id: Generated<string>;
  user_id: string;
  token: string;
  expires_at: Date;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface AccountsTable {
  id: Generated<string>;
  user_id: string;
  account_id: string;
  provider_id: string;
  access_token: string | null;
  refresh_token: string | null;
  access_token_expires_at: Date | null;
  refresh_token_expires_at: Date | null;
  scope: string | null;
  id_token: string | null;
  password: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface VerificationsTable {
  id: Generated<string>;
  identifier: string;
  value: string;
  expires_at: Date;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ClubsTable {
  id: Generated<string>;
  name: string;
  slug: string;
  icon_key: string | null;
  owner_id: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ChannelsTable {
  id: Generated<string>;
  club_id: string;
  name: string;
  type: 'text' | 'voice';
  position: number;
  section_id: string | null;
  last_message_at: ColumnType<Date | null, Date | null, Date | null>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface SectionsTable {
  id: Generated<string>;
  club_id: string;
  name: string;
  position: number;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface MessagesTable {
  id: Generated<string>;
  channel_id: string;
  author_id: string;
  content: string;
  edited_at: Date | null;
  deleted: Generated<boolean>;
  created_at: Generated<Date>;
}

export interface AttachmentsTable {
  id: Generated<string>;
  message_id: string | null;
  dm_message_id: string | null;
  filename: string;
  content_type: string;
  size: number;
  storage_key: string;
  created_at: Generated<Date>;
}

export interface MessageReactionsTable {
  id: Generated<string>;
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: Generated<Date>;
}

export interface DmMessageReactionsTable {
  id: Generated<string>;
  dm_message_id: string;
  user_id: string;
  emoji: string;
  created_at: Generated<Date>;
}

export interface MembershipsTable {
  id: Generated<string>;
  user_id: string;
  club_id: string;
  nickname: string | null;
  joined_at: Generated<Date>;
}

export interface RolesTable {
  id: Generated<string>;
  club_id: string;
  name: string;
  permissions: string;
  position: number;
  is_default: Generated<boolean>;
  color: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface MemberRolesTable {
  id: Generated<string>;
  membership_id: string;
  role_id: string;
}

export interface InvitesTable {
  id: Generated<string>;
  club_id: string;
  creator_id: string;
  code: string;
  max_uses: number | null;
  uses: Generated<number>;
  expires_at: Date | null;
  created_at: Generated<Date>;
}

export interface BansTable {
  id: Generated<string>;
  club_id: string;
  user_id: string;
  reason: string | null;
  banned_by: string;
  created_at: Generated<Date>;
}

export interface AuditLogTable {
  id: Generated<string>;
  club_id: string;
  actor_id: string;
  action: string;
  target_type: string;
  target_id: string;
  metadata: ColumnType<Record<string, unknown> | null, string | null, string | null>;
  created_at: Generated<Date>;
}

export interface FriendshipsTable {
  id: Generated<string>;
  requester_id: string;
  addressee_id: string;
  status: Generated<'pending' | 'accepted'>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface DmChannelsTable {
  id: Generated<string>;
  type: 'direct' | 'group';
  name: string | null;
  owner_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface DmMembersTable {
  id: Generated<string>;
  dm_channel_id: string;
  user_id: string;
  last_read_at: ColumnType<Date | null, Date | null, Date | null>;
  joined_at: Generated<Date>;
}

export interface DmMessagesTable {
  id: Generated<string>;
  dm_channel_id: string;
  author_id: string;
  content: string;
  call_status: DmCallStatus | null;
  call_duration: number | null;
  edited_at: Date | null;
  deleted: Generated<boolean>;
  created_at: Generated<Date>;
}

export interface ChannelReadsTable {
  user_id: string;
  channel_id: string;
  last_read_at: ColumnType<Date, Date, Date>;
}

export interface PushSubscriptionsTable {
  id: Generated<string>;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  ua: string | null;
  origin: string | null;
  failure_count: Generated<number>;
  last_seen_at: ColumnType<Date, Date | undefined, Date>;
  created_at: Generated<Date>;
}

export interface NotificationSettingsTable {
  id: Generated<string>;
  user_id: string;
  scope_type: string;
  scope_id: string;
  muted: Generated<boolean>;
  created_at: Generated<Date>;
}

export interface NotificationPrefsTable {
  user_id: string;
  mode: Generated<string>;
  dnd_until: ColumnType<Date | null, Date | null | undefined, Date | null>;
  quiet_start: number | null;
  quiet_end: number | null;
  quiet_tz: string | null;
  updated_at: Generated<Date>;
}

export interface Database {
  users: UsersTable;
  sessions: SessionsTable;
  accounts: AccountsTable;
  verifications: VerificationsTable;
  clubs: ClubsTable;
  channels: ChannelsTable;
  sections: SectionsTable;
  messages: MessagesTable;
  attachments: AttachmentsTable;
  message_reactions: MessageReactionsTable;
  dm_message_reactions: DmMessageReactionsTable;
  memberships: MembershipsTable;
  roles: RolesTable;
  member_roles: MemberRolesTable;
  invites: InvitesTable;
  bans: BansTable;
  audit_log: AuditLogTable;
  friendships: FriendshipsTable;
  dm_channels: DmChannelsTable;
  dm_members: DmMembersTable;
  dm_messages: DmMessagesTable;
  channel_reads: ChannelReadsTable;
  push_subscriptions: PushSubscriptionsTable;
  notification_settings: NotificationSettingsTable;
  notification_prefs: NotificationPrefsTable;
}

export type UserRow = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;
export type ClubRow = Selectable<ClubsTable>;
export type ChannelRow = Selectable<ChannelsTable>;
export type MessageRow = Selectable<MessagesTable>;
export type AttachmentRow = Selectable<AttachmentsTable>;
export type MembershipRow = Selectable<MembershipsTable>;
export type RoleRow = Selectable<RolesTable>;
export type InviteRow = Selectable<InvitesTable>;
export type BanRow = Selectable<BansTable>;
export type AuditLogRow = Selectable<AuditLogTable>;
export type FriendshipRow = Selectable<FriendshipsTable>;
export type DmChannelRow = Selectable<DmChannelsTable>;
export type DmMemberRow = Selectable<DmMembersTable>;
export type SectionRow = Selectable<SectionsTable>;
export type DmMessageRow = Selectable<DmMessagesTable>;
export type PushSubscriptionRow = Selectable<PushSubscriptionsTable>;
export type NotificationSettingRow = Selectable<NotificationSettingsTable>;
export type NotificationPrefsRow = Selectable<NotificationPrefsTable>;

export function createDb(connectionString: string): Kysely<Database> {
  const dialect = new PostgresDialect({
    pool: new pg.Pool({
      connectionString,
      max: 20,
    }),
  });

  return new Kysely<Database>({ dialect });
}
