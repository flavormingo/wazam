import { create } from 'zustand';
import { api } from '../lib/api';
import { useDmsStore } from './dms';

interface FriendsState {
  friends: any[];
  incoming: any[];
  outgoing: any[];
  loading: boolean;
  fetchFriends: () => Promise<void>;
  fetchPending: () => Promise<void>;
  sendRequest: (name: string) => Promise<any>;
  acceptRequest: (friendshipId: string) => Promise<void>;
  removeFriend: (friendshipId: string) => Promise<void>;
  addFriend: (friendship: any) => void;
  addIncoming: (friendship: any) => void;
  removeFriendById: (friendshipId: string) => void;
  movePendingToFriends: (friendship: any) => void;
}

export const useFriendsStore = create<FriendsState>((set, get) => ({
  friends: [],
  incoming: [],
  outgoing: [],
  loading: false,

  fetchFriends: async () => {
    set({ loading: true });
    try {
      const friends = await api.getFriends();
      set({ friends, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  fetchPending: async () => {
    try {
      const { incoming, outgoing } = await api.getPendingFriends();
      set({ incoming, outgoing });
    } catch {
    }
  },

  sendRequest: async (name: string) => {
    const result = await api.sendFriendRequest(name);
    if (result.status === 'accepted') {
      set((s) => ({
        friends: [...s.friends, result],
        outgoing: s.outgoing.filter((r: any) => r.user.name.toLowerCase() !== name.toLowerCase()),
        incoming: s.incoming.filter((r: any) => r.user.name.toLowerCase() !== name.toLowerCase()),
      }));
    } else {
      set((s) => ({ outgoing: [...s.outgoing, result] }));
    }
    return result;
  },

  acceptRequest: async (friendshipId: string) => {
    const result = await api.acceptFriendRequest(friendshipId);
    set((s) => ({
      incoming: s.incoming.filter((r: any) => r.id !== friendshipId),
      friends: [...s.friends, result],
    }));
  },

  removeFriend: async (friendshipId: string) => {
    await api.removeFriend(friendshipId);
    const friend = get().friends.find((f: any) => f.id === friendshipId);
    if (friend) useDmsStore.getState().removeDmChannelByUserId(friend.user.id);
    set((s) => ({
      friends: s.friends.filter((f: any) => f.id !== friendshipId),
      incoming: s.incoming.filter((r: any) => r.id !== friendshipId),
      outgoing: s.outgoing.filter((r: any) => r.id !== friendshipId),
    }));
  },

  addFriend: (friendship) => {
    set((s) => {
      if (s.friends.some((f: any) => f.id === friendship.id)) return s;
      return { friends: [...s.friends, friendship] };
    });
  },

  addIncoming: (friendship) => {
    set((s) => {
      if (s.incoming.some((r: any) => r.id === friendship.id)) return s;
      return { incoming: [...s.incoming, friendship] };
    });
  },

  removeFriendById: (friendshipId) => {
    set((s) => ({
      friends: s.friends.filter((f: any) => f.id !== friendshipId),
      incoming: s.incoming.filter((r: any) => r.id !== friendshipId),
      outgoing: s.outgoing.filter((r: any) => r.id !== friendshipId),
    }));
  },

  movePendingToFriends: (friendship) => {
    set((s) => ({
      incoming: s.incoming.filter((r: any) => r.id !== friendship.id),
      outgoing: s.outgoing.filter((r: any) => r.id !== friendship.id),
      friends: s.friends.some((f: any) => f.id === friendship.id) ? s.friends : [...s.friends, friendship],
    }));
  },
}));
