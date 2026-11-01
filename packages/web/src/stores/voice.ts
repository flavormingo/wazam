import { create } from 'zustand';
import type { Room } from 'livekit-client';
import { api } from '../lib/api';
import { stopRing } from '../lib/sounds';
import { useCallStore } from './call';

interface Participant {
  identity: string;
  name: string;
  isSpeaking: boolean;
  isMuted: boolean;
  hasCamera: boolean;
  hasScreen: boolean;
  avatarUrl: string | null;
}

interface VoiceState {
  channelId: string | null;
  callType: 'channel' | 'dm' | null;
  dmChannelId: string | null;
  connecting: boolean;
  connected: boolean;
  muted: boolean;
  deafened: boolean;
  cameraEnabled: boolean;
  screenSharing: boolean;
  participants: Record<string, Participant>;
  joinVoice: (channelId: string) => Promise<void>;
  joinDmCall: (dmChannelId: string, token: string, url: string) => Promise<void>;
  leaveVoice: () => void;
  toggleMute: () => void;
  toggleDeafen: () => void;
  toggleCamera: () => void;
  toggleScreenShare: () => void;
}

let room: Room | null = null;
let lkImport: Promise<typeof import('livekit-client')> | null = null;
let aloneTimer: ReturnType<typeof setTimeout> | null = null;

const DM_ALONE_TIMEOUT = 20000;
const HEARTBEAT_INTERVAL = 2000;
const HEARTBEAT_TIMEOUT = 10000;
const HEARTBEAT = new TextEncoder().encode('hb');

function clearAloneTimer() {
  if (aloneTimer) clearTimeout(aloneTimer);
  aloneTimer = null;
}

function endDmCall() {
  const { callType, dmChannelId } = useVoiceStore.getState();
  if (callType !== 'dm' || !dmChannelId) return;
  api.endCall(dmChannelId).catch(() => {});
  useVoiceStore.getState().leaveVoice();
  useCallStore.getState().clearAll();
}

export function preloadLiveKit() {
  if (!lkImport) lkImport = import('livekit-client');
}

export function getRoom(): Room | null {
  return room;
}

function buildParticipant(p: { identity: string; name?: string; metadata?: string; isSpeaking: boolean; audioTrackPublications: Map<string, any>; videoTrackPublications: Map<string, any> }): Participant {
  let hasCamera = false;
  let hasScreen = false;
  for (const pub of p.videoTrackPublications.values()) {
    if (pub.source === 'screen_share' && pub.track && !pub.isMuted) hasScreen = true;
    else if (pub.source === 'camera' && pub.track && !pub.isMuted) hasCamera = true;
  }
  let isMuted = true;
  for (const pub of p.audioTrackPublications.values()) {
    if (pub.source === 'microphone' && !pub.isMuted) isMuted = false;
  }
  let avatarUrl: string | null = null;
  if (p.metadata) {
    try { avatarUrl = JSON.parse(p.metadata)?.avatar_url ?? null; } catch {}
  }
  return {
    identity: p.identity,
    name: p.name || p.identity,
    isSpeaking: p.isSpeaking,
    isMuted,
    hasCamera,
    hasScreen,
    avatarUrl,
  };
}

function syncParticipants() {
  if (!room) return;
  const participants: Record<string, Participant> = {};
  const local = room.localParticipant;
  participants[local.identity] = buildParticipant(local as any);
  for (const p of room.remoteParticipants.values()) {
    participants[p.identity] = buildParticipant(p as any);
  }
  useVoiceStore.setState({ participants });
}

function setupRoomListeners(r: Room, RoomEvent: any) {
  for (const p of r.remoteParticipants.values()) {
    for (const pub of p.audioTrackPublications.values()) {
      if (pub.track && pub.isSubscribed) {
        pub.track.attach();
      }
    }
  }

  r.on(RoomEvent.ParticipantConnected, () => {
    clearAloneTimer();
    syncParticipants();
  });
  r.on(RoomEvent.ParticipantDisconnected, (p: any) => {
    syncParticipants();
    const othersLeft = [...r.remoteParticipants.values()].some((rp) => rp.identity !== p.identity);
    if (useVoiceStore.getState().callType === 'dm' && !othersLeft) endDmCall();
  });

  const lastHeard = new Map<string, number>();
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  if (useVoiceStore.getState().callType === 'dm') {
    r.on(RoomEvent.DataReceived, (_payload: Uint8Array, p: any, _kind: any, topic?: string) => {
      if (topic === 'hb' && p) lastHeard.set(p.identity, Date.now());
    });
    r.on(RoomEvent.Reconnected, () => {
      const now = Date.now();
      for (const id of lastHeard.keys()) lastHeard.set(id, now);
    });
    heartbeat = setInterval(() => {
      if (room !== r) {
        if (heartbeat) clearInterval(heartbeat);
        return;
      }
      r.localParticipant.publishData(HEARTBEAT, { reliable: false, topic: 'hb' }).catch(() => {});
      if (r.state !== 'connected') return;
      const now = Date.now();
      for (const [id, at] of lastHeard) {
        if (now - at > HEARTBEAT_TIMEOUT && r.remoteParticipants.has(id)) {
          endDmCall();
          return;
        }
      }
    }, HEARTBEAT_INTERVAL);
  }

  r.on(RoomEvent.TrackMuted, () => syncParticipants());
  r.on(RoomEvent.TrackUnmuted, () => syncParticipants());
  r.on(RoomEvent.ActiveSpeakersChanged, () => syncParticipants());
  r.on(RoomEvent.TrackPublished, () => syncParticipants());
  r.on(RoomEvent.TrackUnpublished, () => syncParticipants());
  r.on(RoomEvent.LocalTrackPublished, () => syncParticipants());
  r.on(RoomEvent.LocalTrackUnpublished, (pub: any) => {
    syncParticipants();
    if (pub.source === 'screen_share') {
      useVoiceStore.setState({ screenSharing: false });
    }
  });

  r.on(RoomEvent.TrackSubscribed, (track: any, pub: any) => {
    if (track.kind === 'audio') {
      track.attach();
      if (useVoiceStore.getState().deafened && pub) {
        pub.setEnabled(false);
      }
    }
    syncParticipants();
  });

  r.on(RoomEvent.TrackUnsubscribed, (track: any) => {
    track.detach();
    syncParticipants();
  });

  r.on(RoomEvent.Disconnected, () => {
    if (heartbeat) clearInterval(heartbeat);
    if (room !== r) return;
    room = null;
    clearAloneTimer();
    const { callType, dmChannelId } = useVoiceStore.getState();
    if (callType === 'dm' && dmChannelId) {
      api.endCall(dmChannelId).catch(() => {});
      useCallStore.getState().clearAll();
    }
    useVoiceStore.setState({ channelId: null, callType: null, dmChannelId: null, connecting: false, connected: false, muted: false, deafened: false, cameraEnabled: false, screenSharing: false, participants: {} });
  });
}

export const useVoiceStore = create<VoiceState>((set, get) => ({
  channelId: null,
  callType: null,
  dmChannelId: null,
  connecting: false,
  connected: false,
  muted: false,
  deafened: false,
  cameraEnabled: false,
  screenSharing: false,
  participants: {},

  joinVoice: async (channelId: string) => {
    if (get().connecting) return;

    const current = get();
    if (current.callType === 'dm' && current.dmChannelId) {
      api.endCall(current.dmChannelId).catch(() => {});
      useCallStore.getState().clearAll();
    }
    clearAloneTimer();

    if (room) {
      room.disconnect();
      room = null;
    }

    set({ connecting: true, connected: false, channelId: null, callType: null, dmChannelId: null, participants: {} });

    let token: string;
    let url: string;
    try {
      const res = await api.getVoiceToken(channelId);
      token = res.token;
      url = res.url;
    } catch (err) {
      console.error('Failed to get voice token:', err);
      set({ connecting: false });
      return;
    }

    if (!lkImport) lkImport = import('livekit-client');
    const { Room, RoomEvent } = await lkImport;
    const r = new Room();
    room = r;

    const wsUrl = url.startsWith('http://') ? url.replace('http://', 'ws://') :
                  url.startsWith('https://') ? url.replace('https://', 'wss://') : url;

    try {
      await r.connect(wsUrl, token);
    } catch (err) {
      console.error('Failed to connect to voice:', err);
      room = null;
      set({ connecting: false });
      return;
    }

    set({ channelId, callType: 'channel', dmChannelId: null, connecting: false, connected: true, muted: false, deafened: false, cameraEnabled: false, screenSharing: false });

    r.localParticipant.setMicrophoneEnabled(true).catch(() => {
      set({ muted: true });
    });

    setupRoomListeners(r, RoomEvent);
    syncParticipants();
  },

  joinDmCall: async (dmChannelId: string, token: string, url: string) => {
    if (get().connecting) return;
    stopRing();

    if (room) {
      room.disconnect();
      room = null;
    }

    set({ connecting: true, connected: false, channelId: null, callType: null, dmChannelId: null, participants: {} });

    if (!lkImport) lkImport = import('livekit-client');
    const { Room, RoomEvent } = await lkImport;
    const r = new Room();
    room = r;

    const wsUrl = url.startsWith('http://') ? url.replace('http://', 'ws://') :
                  url.startsWith('https://') ? url.replace('https://', 'wss://') : url;

    try {
      await r.connect(wsUrl, token);
    } catch (err) {
      console.error('Failed to connect to DM call:', err);
      room = null;
      set({ connecting: false });
      return;
    }

    set({ channelId: null, callType: 'dm', dmChannelId, connecting: false, connected: true, muted: false, deafened: false, cameraEnabled: false, screenSharing: false });

    r.localParticipant.setMicrophoneEnabled(true).catch(() => {
      set({ muted: true });
    });

    setupRoomListeners(r, RoomEvent);
    syncParticipants();

    clearAloneTimer();
    if (r.remoteParticipants.size === 0) {
      aloneTimer = setTimeout(() => {
        aloneTimer = null;
        if (room === r && r.remoteParticipants.size === 0) endDmCall();
      }, DM_ALONE_TIMEOUT);
    }
  },

  leaveVoice: () => {
    clearAloneTimer();
    if (room) {
      room.disconnect();
      room = null;
    }
    set({ channelId: null, callType: null, dmChannelId: null, connecting: false, connected: false, muted: false, deafened: false, cameraEnabled: false, screenSharing: false, participants: {} });
  },

  toggleMute: () => {
    const { muted } = get();
    const next = !muted;
    set({ muted: next });
    if (room) {
      room.localParticipant.setMicrophoneEnabled(!next);
    }
  },

  toggleDeafen: () => {
    const { deafened } = get();
    if (!deafened) {
      set({ deafened: true, muted: true });
      if (room) {
        room.localParticipant.setMicrophoneEnabled(false);
        for (const p of room.remoteParticipants.values()) {
          for (const pub of p.audioTrackPublications.values()) {
            pub.setEnabled(false);
          }
        }
      }
    } else {
      set({ deafened: false, muted: false });
      if (room) {
        room.localParticipant.setMicrophoneEnabled(true);
        for (const p of room.remoteParticipants.values()) {
          for (const pub of p.audioTrackPublications.values()) {
            pub.setEnabled(true);
          }
        }
      }
    }
  },

  toggleCamera: () => {
    const { cameraEnabled } = get();
    const next = !cameraEnabled;
    set({ cameraEnabled: next });
    if (room) {
      room.localParticipant.setCameraEnabled(next).then(() => syncParticipants()).catch(() => {});
    }
  },

  toggleScreenShare: async () => {
    const { screenSharing } = get();
    const next = !screenSharing;
    if (room) {
      try {
        await room.localParticipant.setScreenShareEnabled(next);
        set({ screenSharing: next });
      } catch {
      }
    }
  },

}));
