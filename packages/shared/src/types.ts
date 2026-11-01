export interface User {
  id: string;
  email: string;
  email_verified: boolean;
  username: string;
  avatar_key: string | null;
  status_emoji: string | null;
  status_text: string | null;
  bio: string | null;
  location: string | null;
  banner_key: string | null;
  link: string | null;
  connections: Record<string, string> | null;
  created_at: Date;
  updated_at: Date;
}

export interface Club {
  id: string;
  name: string;
  slug: string;
  icon_key: string | null;
  owner_id: string;
  created_at: Date;
  updated_at: Date;
}

export type ChannelType = 'text' | 'voice';

export interface Channel {
  id: string;
  club_id: string;
  name: string;
  type: ChannelType;
  position: number;
  section_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface Section {
  id: string;
  club_id: string;
  name: string;
  position: number;
  created_at: Date;
  updated_at: Date;
}

export interface Message {
  id: string;
  channel_id: string;
  author_id: string;
  content: string;
  edited_at: Date | null;
  deleted: boolean;
  created_at: Date;
}

export interface Attachment {
  id: string;
  message_id: string;
  filename: string;
  content_type: string;
  size: number;
  storage_key: string;
  created_at: Date;
}

export interface Membership {
  id: string;
  user_id: string;
  club_id: string;
  nickname: string | null;
  joined_at: Date;
}

export interface Role {
  id: string;
  club_id: string;
  name: string;
  permissions: string;
  position: number;
  is_default: boolean;
  color: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface MemberRole {
  id: string;
  membership_id: string;
  role_id: string;
}

export interface Invite {
  id: string;
  club_id: string;
  creator_id: string;
  code: string;
  max_uses: number | null;
  uses: number;
  expires_at: Date | null;
  created_at: Date;
}

export interface Ban {
  id: string;
  club_id: string;
  user_id: string;
  reason: string | null;
  banned_by: string;
  created_at: Date;
}

export type AuditAction =
  | 'club.update'
  | 'channel.create' | 'channel.update' | 'channel.delete'
  | 'section.create' | 'section.update' | 'section.delete'
  | 'member.kick' | 'member.ban' | 'member.unban'
  | 'role.create' | 'role.update' | 'role.delete' | 'role.assign' | 'role.remove'
  | 'invite.create' | 'invite.revoke'
  | 'message.delete'
  | 'club.transfer';

export interface AuditLog {
  id: string;
  club_id: string;
  actor_id: string;
  action: AuditAction;
  target_type: string;
  target_id: string;
  metadata: Record<string, unknown> | null;
  created_at: Date;
}

export interface ApiUser {
  id: string;
  name: string;
  avatar_url: string | null;
}

export interface ApiClub {
  id: string;
  name: string;
  slug: string;
  icon_url: string | null;
  owner_id: string;
  member_count?: number;
}

export interface ApiChannel {
  id: string;
  club_id: string;
  name: string;
  type: ChannelType;
  position: number;
  section_id: string | null;
}

export interface ApiSection {
  id: string;
  club_id: string;
  name: string;
  position: number;
}

export interface ApiReaction {
  emoji: string;
  count: number;
  me: boolean;
}

export interface ApiMessage {
  id: string;
  channel_id: string;
  author: ApiUser;
  content: string;
  attachments: ApiAttachment[];
  reactions: ApiReaction[];
  edited_at: string | null;
  deleted: boolean;
  created_at: string;
}

export interface ApiAttachment {
  id: string;
  filename: string;
  content_type: string;
  size: number;
  url: string;
}

export interface ApiMember {
  id: string;
  user: ApiUser;
  nickname: string | null;
  roles: ApiRole[];
  joined_at: string;
}

export interface ApiRole {
  id: string;
  name: string;
  permissions: string;
  position: number;
  is_default: boolean;
  color: string | null;
}

export interface ApiInvite {
  id: string;
  code: string;
  club: { id: string; name: string; icon_url: string | null };
  creator: ApiUser;
  max_uses: number | null;
  uses: number;
  expires_at: string | null;
  created_at: string;
}

export interface ApiAuditLog {
  id: string;
  actor: ApiUser;
  action: AuditAction;
  target_type: string;
  target_id: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export type FriendshipStatus = 'pending' | 'accepted';

export interface Friendship {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: FriendshipStatus;
  created_at: Date;
  updated_at: Date;
}

export interface DmChannel {
  id: string;
  type: 'direct' | 'group';
  name: string | null;
  owner_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface DmMember {
  id: string;
  dm_channel_id: string;
  user_id: string;
  joined_at: Date;
}

export interface DmMessage {
  id: string;
  dm_channel_id: string;
  author_id: string;
  content: string;
  edited_at: Date | null;
  deleted: boolean;
  created_at: Date;
}

export interface ApiUserProfile extends ApiUser {
  status_emoji: string | null;
  status_text: string | null;
  bio: string | null;
  location: string | null;
  banner_url: string | null;
  link: string | null;
  connections: Record<string, string> | null;
}

export interface ApiFriendship {
  id: string;
  user: ApiUser;
  status: FriendshipStatus;
  created_at: string;
}

export interface ApiDmChannel {
  id: string;
  type: 'direct' | 'group';
  name: string | null;
  members: ApiUser[];
  last_message: ApiDmMessage | null;
  updated_at: string;
}

export type DmCallStatus = 'completed' | 'missed' | 'declined';

export interface ApiDmCall {
  status: DmCallStatus;
  duration: number | null;
}

export interface ApiDmMessage {
  id: string;
  dm_channel_id: string;
  author: ApiUser;
  content: string;
  call?: ApiDmCall | null;
  attachments?: ApiAttachment[];
  reactions?: ApiReaction[];
  edited_at: string | null;
  deleted: boolean;
  created_at: string;
}
