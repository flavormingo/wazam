const BASE = '';

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = { ...options.headers as Record<string, string> };
  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (body.error || res.statusText).toLowerCase());
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const api = {
  getMe: () => request<any>('/api/auth/me'),

  getClubs: () => request<any[]>('/api/club'),
  getClub: (id: string) => request<any>(`/api/club/${id}`),
  createClub: (data: { name: string; slug?: string; icon_key?: string }) => request<any>('/api/club', { method: 'POST', body: JSON.stringify(data) }),
  updateClub: (id: string, data: any) => request<any>(`/api/club/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteClub: (id: string) => request<any>(`/api/club/${id}`, { method: 'DELETE' }),

  getChannels: (clubId: string) => request<any[]>(`/api/club/${clubId}/channel`),
  createChannel: (clubId: string, data: { name: string; type?: string; section_id?: string }) =>
    request<any>(`/api/club/${clubId}/channel`, { method: 'POST', body: JSON.stringify(data) }),
  updateChannel: (clubId: string, channelId: string, data: any) =>
    request<any>(`/api/club/${clubId}/channel/${channelId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteChannel: (clubId: string, channelId: string) =>
    request<any>(`/api/club/${clubId}/channel/${channelId}`, { method: 'DELETE' }),

  getSections: (clubId: string) => request<any[]>(`/api/club/${clubId}/section`),
  createSection: (clubId: string, data: { name: string }) =>
    request<any>(`/api/club/${clubId}/section`, { method: 'POST', body: JSON.stringify(data) }),
  updateSection: (clubId: string, sectionId: string, data: any) =>
    request<any>(`/api/club/${clubId}/section/${sectionId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteSection: (clubId: string, sectionId: string) =>
    request<any>(`/api/club/${clubId}/section/${sectionId}`, { method: 'DELETE' }),

  getMessages: (channelId: string, before?: string) => {
    const params = new URLSearchParams();
    if (before) params.set('before', before);
    const qs = params.toString();
    return request<any[]>(`/api/channel/${channelId}/messages${qs ? `?${qs}` : ''}`);
  },
  sendMessage: (channelId: string, content: string, attachment_ids?: string[]) =>
    request<any>(`/api/channel/${channelId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content, attachment_ids }),
    }),
  editMessage: (channelId: string, messageId: string, content: string) =>
    request<any>(`/api/channel/${channelId}/messages/${messageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ content }),
    }),
  deleteMessage: (channelId: string, messageId: string) =>
    request<any>(`/api/channel/${channelId}/messages/${messageId}`, { method: 'DELETE' }),
  toggleReaction: (channelId: string, messageId: string, emoji: string) =>
    request<{ reacted: boolean }>(`/api/channel/${channelId}/messages/${messageId}/react`, {
      method: 'POST',
      body: JSON.stringify({ emoji }),
    }),

  getMembers: (clubId: string) => request<any[]>(`/api/club/${clubId}/members`),
  getPresence: (clubId: string) => request<Record<string, string>>(`/api/club/${clubId}/presence`),
  getVoiceOccupancy: (clubId: string) => request<Record<string, string[]>>(`/api/club/${clubId}/voice-occupancy`),
  kickMember: (clubId: string, userId: string) =>
    request<any>(`/api/club/${clubId}/members/${userId}`, { method: 'DELETE' }),
  banMember: (clubId: string, userId: string, reason?: string) =>
    request<any>(`/api/club/${clubId}/bans`, { method: 'POST', body: JSON.stringify({ user_id: userId, reason }) }),
  unbanMember: (clubId: string, userId: string) =>
    request<any>(`/api/club/${clubId}/bans/${userId}`, { method: 'DELETE' }),
  getBans: (clubId: string) => request<any[]>(`/api/club/${clubId}/bans`),

  getRoles: (clubId: string) => request<any[]>(`/api/club/${clubId}/roles`),
  createRole: (clubId: string, data: { name: string; permissions?: string; color?: string }) =>
    request<any>(`/api/club/${clubId}/roles`, { method: 'POST', body: JSON.stringify(data) }),
  updateRole: (clubId: string, roleId: string, data: any) =>
    request<any>(`/api/club/${clubId}/roles/${roleId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteRole: (clubId: string, roleId: string) =>
    request<any>(`/api/club/${clubId}/roles/${roleId}`, { method: 'DELETE' }),
  assignRole: (clubId: string, userId: string, roleId: string) =>
    request<any>(`/api/club/${clubId}/members/${userId}/roles`, { method: 'POST', body: JSON.stringify({ role_id: roleId }) }),
  removeRole: (clubId: string, userId: string, roleId: string) =>
    request<any>(`/api/club/${clubId}/members/${userId}/roles/${roleId}`, { method: 'DELETE' }),

  createInvite: (clubId: string, data?: { max_uses?: number; expires_in_hours?: number }) =>
    request<any>(`/api/club/${clubId}/invites`, { method: 'POST', body: JSON.stringify(data || {}) }),
  getInvites: (clubId: string) => request<any[]>(`/api/club/${clubId}/invites`),
  revokeInvite: (clubId: string, inviteId: string) =>
    request<any>(`/api/club/${clubId}/invites/${inviteId}`, { method: 'DELETE' }),
  sendInviteDm: (clubId: string, userId: string) =>
    request<any>(`/api/club/${clubId}/invites/dm`, { method: 'POST', body: JSON.stringify({ user_id: userId }) }),
  getInviteInfo: (code: string) => request<any>(`/api/invites/${code}`),
  acceptInvite: (code: string) => request<any>(`/api/invites/${code}/accept`, { method: 'POST', body: '{}' }),

  presignUpload: (data: { filename: string; content_type: string; size: number }) =>
    request<{ attachment_id: string; post_url: string; fields: Record<string, string>; public_url: string }>(
      '/api/attachments/presign',
      { method: 'POST', body: JSON.stringify(data) },
    ),

  getVoiceToken: (channelId: string) =>
    request<{ token: string; url: string; room: string }>(
      `/api/channel/${channelId}/voice-token`,
      { method: 'POST', body: '{}' },
    ),

  getAuditLog: (clubId: string, before?: string) => {
    const params = new URLSearchParams();
    if (before) params.set('before', before);
    const qs = params.toString();
    return request<any[]>(`/api/club/${clubId}/audit-log${qs ? `?${qs}` : ''}`);
  },

  presignProfileImage: (data: { type: 'avatar' | 'banner'; filename: string; content_type: string; size: number }) =>
    request<{ post_url: string; fields: Record<string, string>; key: string; public_url: string }>(
      '/api/users/me/profile-image',
      { method: 'POST', body: JSON.stringify(data) },
    ),

  searchUsers: (q: string) => request<any[]>(`/api/users/search?q=${encodeURIComponent(q)}`),
  getUserProfile: (userId: string) => request<any>(`/api/users/${userId}/profile`),
  updateProfile: (data: any) => request<any>('/api/users/me/profile', { method: 'PATCH', body: JSON.stringify(data) }),

  getFriends: () => request<any[]>('/api/friends'),
  getPendingFriends: () => request<any>('/api/friends/pending'),
  sendFriendRequest: (name: string) =>
    request<any>('/api/friends/request', { method: 'POST', body: JSON.stringify({ name }) }),
  acceptFriendRequest: (friendshipId: string) =>
    request<any>(`/api/friends/${friendshipId}/accept`, { method: 'POST', body: '{}' }),
  removeFriend: (friendshipId: string) =>
    request<any>(`/api/friends/${friendshipId}`, { method: 'DELETE' }),
  befriendValentino: () =>
    request<{ added: boolean }>('/api/friends/valentino', { method: 'POST', body: '{}' }),

  getDmChannels: () => request<any[]>('/api/dm'),
  createDm: (user_ids: string[]) =>
    request<any>('/api/dm', { method: 'POST', body: JSON.stringify({ user_ids }) }),
  getDmMessages: (dmChannelId: string, before?: string) => {
    const params = new URLSearchParams();
    if (before) params.set('before', before);
    const qs = params.toString();
    return request<any[]>(`/api/dm/${dmChannelId}/messages${qs ? `?${qs}` : ''}`);
  },
  sendDmMessage: (dmChannelId: string, content: string, attachmentIds?: string[]) =>
    request<any>(`/api/dm/${dmChannelId}/messages`, { method: 'POST', body: JSON.stringify({ content, attachment_ids: attachmentIds?.length ? attachmentIds : undefined }) }),
  editDmMessage: (dmChannelId: string, messageId: string, content: string) =>
    request<any>(`/api/dm/${dmChannelId}/messages/${messageId}`, { method: 'PATCH', body: JSON.stringify({ content }) }),
  deleteDmMessage: (dmChannelId: string, messageId: string) =>
    request<any>(`/api/dm/${dmChannelId}/messages/${messageId}`, { method: 'DELETE' }),
  toggleDmReaction: (dmChannelId: string, messageId: string, emoji: string) =>
    request<{ reacted: boolean }>(`/api/dm/${dmChannelId}/messages/${messageId}/react`, {
      method: 'POST',
      body: JSON.stringify({ emoji }),
    }),

  transferOwnership: (clubId: string, newOwnerId: string) =>
    request<any>(`/api/club/${clubId}/transfer`, { method: 'POST', body: JSON.stringify({ new_owner_id: newOwnerId }) }),

  presignClubIcon: (clubId: string, data: { filename: string; content_type: string; size: number }) =>
    request<{ post_url: string; fields: Record<string, string>; key: string; public_url: string }>(
      `/api/club/${clubId}/presign-icon`,
      { method: 'POST', body: JSON.stringify(data) },
    ),

  presignNewClubIcon: (data: { filename: string; content_type: string; size: number }) =>
    request<{ post_url: string; fields: Record<string, string>; key: string; public_url: string }>(
      '/api/clubs/presign-icon',
      { method: 'POST', body: JSON.stringify(data) },
    ),

  startCall: (dmChannelId: string) =>
    request<{ ok: boolean }>(`/api/dm/${dmChannelId}/call`, { method: 'POST', body: '{}' }),
  acceptCall: (dmChannelId: string) =>
    request<{ token: string; url: string; room: string }>(`/api/dm/${dmChannelId}/call/accept`, { method: 'POST', body: '{}' }),
  rejectCall: (dmChannelId: string) =>
    request<{ ok: boolean }>(`/api/dm/${dmChannelId}/call/reject`, { method: 'POST', body: '{}' }),
  endCall: (dmChannelId: string) =>
    request<{ ok: boolean }>(`/api/dm/${dmChannelId}/call/end`, { method: 'POST', body: '{}' }),
  getDmVoiceToken: (dmChannelId: string) =>
    request<{ token: string; url: string; room: string }>(`/api/dm/${dmChannelId}/voice-token`, { method: 'POST', body: '{}' }),

  sendReport: (data: { type: 'bug' | 'actor'; message: string }) =>
    request<void>('/api/reports', { method: 'POST', body: JSON.stringify(data) }),

  markChannelRead: (channelId: string) =>
    request<{ ok: boolean }>(`/api/channel/${channelId}/read`, { method: 'POST', body: '{}' }),
  markDmRead: (dmChannelId: string) =>
    request<{ ok: boolean }>(`/api/dm/${dmChannelId}/read`, { method: 'POST', body: '{}' }),

  getVapidKey: () => request<{ publicKey: string }>('/api/push/vapid'),
  pushSubscribe: (data: { endpoint: string; keys: { p256dh: string; auth: string }; ua?: string }) =>
    request<{ ok: boolean }>('/api/push/subscribe', { method: 'POST', body: JSON.stringify(data) }),
  pushUnsubscribe: (endpoint: string) =>
    request<{ ok: boolean }>('/api/push/subscribe', { method: 'DELETE', body: JSON.stringify({ endpoint }) }),
  getMutes: () => request<{ scope_type: string; scope_id: string }[]>('/api/push/mutes'),
  mute: (scope_type: 'club' | 'channel' | 'dm', scope_id: string) =>
    request<{ ok: boolean }>('/api/push/mute', { method: 'POST', body: JSON.stringify({ scope_type, scope_id }) }),
  unmute: (scope_type: 'club' | 'channel' | 'dm', scope_id: string) =>
    request<{ ok: boolean }>('/api/push/mute', { method: 'DELETE', body: JSON.stringify({ scope_type, scope_id }) }),

  getPrefs: () => request<NotifPrefs>('/api/push/prefs'),
  savePrefs: (p: NotifPrefs) => request<{ ok: boolean }>('/api/push/prefs', { method: 'PUT', body: JSON.stringify(p) }),
};

export interface NotifPrefs {
  mode: string;
  dnd_until: string | null;
  quiet_start: number | null;
  quiet_end: number | null;
  quiet_tz: string | null;
}

export async function uploadToPresigned(
  presign: { post_url: string; fields: Record<string, string> },
  file: File,
): Promise<void> {
  const form = new FormData();
  for (const [k, v] of Object.entries(presign.fields)) {
    form.append(k, v);
  }
  form.append('file', file);
  const res = await fetch(presign.post_url, { method: 'POST', body: form });
  if (!res.ok) {
    throw new Error(`upload failed (${res.status})`);
  }
}
