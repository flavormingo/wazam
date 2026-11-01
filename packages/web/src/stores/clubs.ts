import { create } from 'zustand';
import { api } from '../lib/api';

interface ClubsState {
  clubs: any[];
  currentClubId: string | null;
  loading: boolean;
  fetchClubs: () => Promise<void>;
  setCurrentClub: (id: string | null) => void;
  createClub: (data: { name: string; slug?: string; icon_key?: string }) => Promise<any>;
  addClub: (club: any) => void;
  updateClub: (id: string, data: any) => void;
  removeClub: (id: string) => void;
}

export const useClubsStore = create<ClubsState>((set) => ({
  clubs: [],
  currentClubId: null,
  loading: false,

  fetchClubs: async () => {
    set({ loading: true });
    try {
      const clubs = await api.getClubs();
      set({ clubs, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  setCurrentClub: (id) => set({ currentClubId: id }),

  createClub: async (data) => {
    const club = await api.createClub(data);
    set((s) => (s.clubs.some((c) => c.id === club.id) ? s : { clubs: [...s.clubs, club] }));
    return club;
  },

  addClub: (club) => set((s) => (s.clubs.some((c) => c.id === club.id) ? s : { clubs: [...s.clubs, club] })),

  updateClub: (id, data) => set((s) => ({
    clubs: s.clubs.map((c) => c.id === id ? { ...c, ...data } : c),
  })),

  removeClub: (id) => set((s) => ({
    clubs: s.clubs.filter((c) => c.id !== id),
  })),
}));
