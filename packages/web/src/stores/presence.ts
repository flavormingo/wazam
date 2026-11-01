import { create } from 'zustand';
import type { PresenceStatus } from '@wazam/shared';

interface PresenceState {
  statuses: Record<string, PresenceStatus>;
  setStatus: (userId: string, status: PresenceStatus) => void;
  setBulk: (statuses: Record<string, string>) => void;
}

export const usePresenceStore = create<PresenceState>((set) => ({
  statuses: {},
  setStatus: (userId, status) => {
    set((s) => ({ statuses: { ...s.statuses, [userId]: status } }));
  },
  setBulk: (incoming) => {
    set((s) => ({ statuses: { ...s.statuses, ...incoming } as Record<string, PresenceStatus> }));
  },
}));
