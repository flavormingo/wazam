import { create } from 'zustand';
import { api } from '../lib/api';
import { useFriendsStore } from './friends';
import { useDmsStore } from './dms';

interface TourState {
  active: boolean;
  stepIndex: number;
  start: () => void;
  next: () => void;
  prev: () => void;
  finish: () => void;
}

export const useTourStore = create<TourState>((set) => ({
  active: false,
  stepIndex: 0,
  start: () => set({ active: true, stepIndex: 0 }),
  next: () => set((s) => ({ stepIndex: s.stepIndex + 1 })),
  prev: () => set((s) => ({ stepIndex: Math.max(0, s.stepIndex - 1) })),
  finish: () => set({ active: false, stepIndex: 0 }),
}));

export async function startTour() {
  await api.befriendValentino().catch(() => {});
  await Promise.all([
    useFriendsStore.getState().fetchFriends(),
    useDmsStore.getState().fetchDmChannels(),
  ]).catch(() => {});
  useTourStore.getState().start();
}
