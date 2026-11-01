import type { ApiMessage, ApiMember, ApiChannel, ApiSection, ApiDmMessage, ApiFriendship, ApiDmChannel, ApiUser, ApiClub } from './types.js';

export type ClientOp =
  | { op: 'subscribe'; d: { channel_id: string } }
  | { op: 'unsubscribe'; d: { channel_id: string } }
  | { op: 'message.send'; d: { channel_id: string; content: string; nonce: string } }
  | { op: 'typing.start'; d: { channel_id: string } }
  | { op: 'presence.update'; d: { status: PresenceStatus } }
  | { op: 'dm.typing.start'; d: { dm_channel_id: string } }
  | { op: 'focus'; d: { conversation_id: string | null } }
  | { op: 'ping' };

export type ServerOp =
  | { op: 'ready'; d: { user_id: string; session_id: string } }
  | { op: 'message.create'; d: ApiMessage }
  | { op: 'message.update'; d: ApiMessage }
  | { op: 'message.delete'; d: { id: string; channel_id: string } }
  | { op: 'reaction.add'; d: { message_id: string; channel_id: string; emoji: string; user_id: string } }
  | { op: 'reaction.remove'; d: { message_id: string; channel_id: string; emoji: string; user_id: string } }
  | { op: 'typing.start'; d: { channel_id: string; user_id: string; name: string } }
  | { op: 'presence.update'; d: { user_id: string; status: PresenceStatus } }
  | { op: 'channel.create'; d: ApiChannel }
  | { op: 'channel.update'; d: ApiChannel }
  | { op: 'channel.delete'; d: { id: string; club_id: string } }
  | { op: 'section.create'; d: ApiSection }
  | { op: 'section.update'; d: ApiSection }
  | { op: 'section.delete'; d: { id: string; club_id: string } }
  | { op: 'member.join'; d: { club_id: string; member: ApiMember } }
  | { op: 'member.leave'; d: { club_id: string; user_id: string } }
  | { op: 'club.add'; d: ApiClub }
  | { op: 'club.update'; d: ApiClub }
  | { op: 'club.remove'; d: { club_id: string } }
  | { op: 'voice.state'; d: VoiceState }
  | { op: 'dm.message.create'; d: ApiDmMessage }
  | { op: 'dm.message.update'; d: ApiDmMessage }
  | { op: 'dm.message.delete'; d: { id: string; dm_channel_id: string } }
  | { op: 'dm.reaction.add'; d: { dm_message_id: string; dm_channel_id: string; emoji: string; user_id: string } }
  | { op: 'dm.reaction.remove'; d: { dm_message_id: string; dm_channel_id: string; emoji: string; user_id: string } }
  | { op: 'dm.typing.start'; d: { dm_channel_id: string; user_id: string; name: string } }
  | { op: 'dm.channel.create'; d: ApiDmChannel }
  | { op: 'friend.request'; d: ApiFriendship }
  | { op: 'friend.accept'; d: ApiFriendship }
  | { op: 'friend.remove'; d: { friendship_id: string; user_id: string } }
  | { op: 'call.incoming'; d: { dm_channel_id: string; caller: { id: string; username: string; display_name: string; avatar_url: string | null } } }
  | { op: 'call.accepted'; d: { dm_channel_id: string } }
  | { op: 'call.rejected'; d: { dm_channel_id: string } }
  | { op: 'call.ended'; d: { dm_channel_id: string } }
  | { op: 'message.notify'; d: { channel_id: string; author_id: string; created_at: string } }
  | { op: 'read.update'; d: { scope_type: 'channel' | 'dm'; scope_id: string; last_read_at: string } }
  | { op: 'pong' }
  | { op: 'error'; d: { message: string; code?: number } };

export type PresenceStatus = 'online' | 'idle' | 'dnd' | 'offline';

export interface VoiceState {
  channel_id: string;
  user_id: string;
  muted: boolean;
  deafened: boolean;
  streaming: boolean;
  joined: boolean;
}
