import { useEffect } from 'react';
import { wsClient } from '../lib/ws';
import { useMessagesStore } from '../stores/messages';
import { useChannelsStore } from '../stores/channels';
import { useMembersStore } from '../stores/members';
import { usePresenceStore } from '../stores/presence';
import { useDmsStore } from '../stores/dms';
import { useFriendsStore } from '../stores/friends';
import { useSectionsStore } from '../stores/sections';
import { useCallStore } from '../stores/call';
import { useVoiceStore } from '../stores/voice';
import { useUnreadStore } from '../stores/unread';
import { useAuthStore } from '../stores/auth';
import { useClubsStore } from '../stores/clubs';
import { useVoiceOccupancyStore } from '../stores/voiceOccupancy';
import { playMessageChime, playDmChime, startRing, stopRing, playJoinChime } from '../lib/sounds';
import { api } from '../lib/api';
import type { ServerOp } from '@wazup/shared';

function chimeIfVisible(fn: () => void) {
  if (document.visibilityState === 'visible') fn();
}

export function useWsHandler() {
  const addMessage = useMessagesStore((s) => s.addMessage);
  const updateMessage = useMessagesStore((s) => s.updateMessage);
  const removeMessage = useMessagesStore((s) => s.removeMessage);
  const applyReaction = useMessagesStore((s) => s.applyReaction);
  const addChannel = useChannelsStore((s) => s.addChannel);
  const updateChannel = useChannelsStore((s) => s.updateChannel);
  const removeChannel = useChannelsStore((s) => s.removeChannel);
  const addMember = useMembersStore((s) => s.addMember);
  const removeMember = useMembersStore((s) => s.removeMember);
  const setStatus = usePresenceStore((s) => s.setStatus);
  const addDmMessage = useDmsStore((s) => s.addDmMessage);
  const updateDmMessage = useDmsStore((s) => s.updateDmMessage);
  const removeDmMessage = useDmsStore((s) => s.removeDmMessage);
  const applyDmReaction = useDmsStore((s) => s.applyDmReaction);
  const addDmChannel = useDmsStore((s) => s.addDmChannel);
  const addFriend = useFriendsStore((s) => s.addFriend);
  const addIncoming = useFriendsStore((s) => s.addIncoming);
  const removeFriendById = useFriendsStore((s) => s.removeFriendById);
  const movePendingToFriends = useFriendsStore((s) => s.movePendingToFriends);
  const addSection = useSectionsStore((s) => s.addSection);
  const updateSection = useSectionsStore((s) => s.updateSection);
  const removeSection = useSectionsStore((s) => s.removeSection);
  const clearSectionId = useChannelsStore((s) => s.clearSectionId);
  const setIncomingCall = useCallStore((s) => s.setIncomingCall);
  const setOutgoingCall = useCallStore((s) => s.setOutgoingCall);
  const setActiveCall = useCallStore((s) => s.setActiveCall);
  const clearCallAll = useCallStore((s) => s.clearAll);
  const joinDmCall = useVoiceStore((s) => s.joinDmCall);
  const leaveVoice = useVoiceStore((s) => s.leaveVoice);
  const removeDmChannelByUserId = useDmsStore((s) => s.removeDmChannelByUserId);

  useEffect(() => {
    const unsub = wsClient.subscribe((op: ServerOp) => {
      switch (op.op) {
        case 'message.create':
          addMessage(op.d);
          if (useChannelsStore.getState().currentChannelId === op.d.channel_id) {
            useUnreadStore.getState().markChannelRead(op.d.channel_id);
          }
          break;
        case 'message.update':
          updateMessage(op.d);
          break;
        case 'message.delete':
          removeMessage(op.d.id, op.d.channel_id);
          break;
        case 'reaction.add':
        case 'reaction.remove': {
          const meId = useAuthStore.getState().user?.id;
          applyReaction(op.d.channel_id, op.d.message_id, op.d.emoji, op.d.user_id === meId, op.op === 'reaction.add');
          break;
        }
        case 'message.notify': {
          const { channel_id, author_id, created_at } = op.d;
          useUnreadStore.getState().setChannelLastMessage(channel_id, created_at);
          const currentUserId = useAuthStore.getState().user?.id;
          if (author_id === currentUserId) {
            useUnreadStore.getState().markChannelRead(channel_id);
            break;
          }
          const currentChannelId = useChannelsStore.getState().currentChannelId;
          if (channel_id === currentChannelId) {
            useUnreadStore.getState().markChannelRead(channel_id);
            break;
          }
          chimeIfVisible(playMessageChime);
          break;
        }
        case 'read.update':
          useUnreadStore.getState().applyRemoteRead(op.d.scope_type, op.d.scope_id, op.d.last_read_at);
          break;
        case 'channel.create':
          addChannel(op.d);
          useUnreadStore.getState().addChannelMapping(op.d.id, op.d.club_id);
          break;
        case 'channel.update':
          updateChannel(op.d);
          break;
        case 'channel.delete':
          removeChannel(op.d.id, op.d.club_id);
          useUnreadStore.getState().removeChannelMapping(op.d.id);
          break;
        case 'section.create':
          addSection(op.d);
          break;
        case 'section.update':
          updateSection(op.d);
          break;
        case 'section.delete':
          clearSectionId(op.d.id, op.d.club_id);
          removeSection(op.d.id, op.d.club_id);
          break;
        case 'member.join':
          addMember(op.d.club_id, op.d.member);
          break;
        case 'member.leave':
          removeMember(op.d.club_id, op.d.user_id);
          break;
        case 'club.add':
          useClubsStore.getState().addClub(op.d);
          useChannelsStore.getState().fetchChannels(op.d.id);
          break;
        case 'club.update':
          useClubsStore.getState().updateClub(op.d.id, op.d);
          break;
        case 'club.remove': {
          const removedClubId = op.d.club_id;
          if (useClubsStore.getState().currentClubId === removedClubId) {
            useClubsStore.getState().setCurrentClub(null);
          }
          useClubsStore.getState().removeClub(removedClubId);
          break;
        }
        case 'presence.update':
          setStatus(op.d.user_id, op.d.status);
          break;
        case 'dm.message.create':
          addDmMessage(op.d);
          useUnreadStore.getState().setDmLastMessage(op.d.dm_channel_id, op.d.created_at);
          if (useDmsStore.getState().currentDmId === op.d.dm_channel_id) {
            useUnreadStore.getState().markDmRead(op.d.dm_channel_id);
          } else if (op.d.author.id === useAuthStore.getState().user?.id) {
            useUnreadStore.getState().markDmRead(op.d.dm_channel_id);
          } else {
            chimeIfVisible(playDmChime);
          }
          break;
        case 'dm.message.update':
          updateDmMessage(op.d);
          break;
        case 'dm.message.delete':
          removeDmMessage(op.d.id, op.d.dm_channel_id);
          break;
        case 'dm.reaction.add':
        case 'dm.reaction.remove': {
          const meId = useAuthStore.getState().user?.id;
          applyDmReaction(op.d.dm_channel_id, op.d.dm_message_id, op.d.emoji, op.d.user_id === meId, op.op === 'dm.reaction.add');
          break;
        }
        case 'dm.channel.create':
          addDmChannel(op.d);
          break;
        case 'friend.request':
          addIncoming(op.d);
          break;
        case 'friend.accept':
          movePendingToFriends(op.d);
          useDmsStore.getState().fetchDmChannels();
          break;
        case 'friend.remove':
          removeFriendById(op.d.friendship_id);
          removeDmChannelByUserId(op.d.user_id);
          break;
        case 'call.incoming':
          setIncomingCall({ dmChannelId: op.d.dm_channel_id, caller: op.d.caller });
          startRing();
          break;
        case 'call.accepted': {
          const dmId = op.d.dm_channel_id;
          const calls = useCallStore.getState();
          const placedHere = calls.outgoingCall?.dmChannelId === dmId;
          if (!placedHere) {
            if (calls.incomingCall?.dmChannelId === dmId) {
              setIncomingCall(null);
              stopRing();
            }
            break;
          }
          setOutgoingCall(null);
          stopRing();
          setActiveCall(dmId);
          api.getDmVoiceToken(dmId).then((res) => {
            joinDmCall(dmId, res.token, res.url);
          }).catch((err) => {
            console.error('Failed to get DM voice token:', err);
            clearCallAll();
          });
          break;
        }
        case 'call.rejected':
          setOutgoingCall(null);
          stopRing();
          break;
        case 'call.ended': {
          const dmId = op.d.dm_channel_id;
          const calls = useCallStore.getState();
          if (calls.incomingCall?.dmChannelId === dmId || calls.outgoingCall?.dmChannelId === dmId) {
            setIncomingCall(null);
            setOutgoingCall(null);
            stopRing();
          }
          if (calls.activeCallDmChannelId === dmId) setActiveCall(null);
          const voice = useVoiceStore.getState();
          if (voice.callType === 'dm' && voice.dmChannelId === dmId) leaveVoice();
          break;
        }
        case 'voice.state':
          useVoiceOccupancyStore.getState().setPresence(op.d.channel_id, op.d.user_id, op.d.joined);
          if (op.d.joined && op.d.user_id !== useAuthStore.getState().user?.id) {
            playJoinChime();
          }
          break;
        case 'ready': {
          useDmsStore.getState().fetchDmChannels();
          const openChannelId = useChannelsStore.getState().currentChannelId;
          if (openChannelId) useMessagesStore.getState().fetchMessages(openChannelId);
          const openDmId = useDmsStore.getState().currentDmId;
          if (openDmId) useDmsStore.getState().fetchDmMessages(openDmId);
          break;
        }
      }
    });

    return unsub;
  }, [
    addMessage, updateMessage, removeMessage, applyReaction,
    addChannel, updateChannel, removeChannel, clearSectionId,
    addSection, updateSection, removeSection,
    addMember, removeMember,
    setStatus,
    addDmMessage, updateDmMessage, removeDmMessage, applyDmReaction, addDmChannel,
    addFriend, addIncoming, removeFriendById, movePendingToFriends,
    setIncomingCall, setOutgoingCall, setActiveCall, clearCallAll,
    joinDmCall, leaveVoice, removeDmChannelByUserId,
  ]);
}
