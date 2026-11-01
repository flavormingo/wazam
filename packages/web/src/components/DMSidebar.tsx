import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useDmsStore } from '../stores/dms';
import { toast } from '../stores/toast';
import { useAuthStore } from '../stores/auth';
import { api } from '../lib/api';
import { PlusIcon, SearchIcon, XIcon, UserPlusIcon } from './icons';
import { Modal } from './Modal';
import { VoicePanel } from './VoicePanel';
import { useModalStore } from '../stores/modal';
import { useFriendsStore } from '../stores/friends';
import { useUnreadStore, isDmUnread } from '../stores/unread';
import { formatShortTime } from '../lib/time';
import { describeAttachments, describeCall } from '@wazam/shared';
import './DMSidebar.css';

export function DMSidebar() {
  const { channels, fetchDmChannels, createDm, currentDmId } = useDmsStore();
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const [friendPrompt, setFriendPrompt] = useState<any | null>(null);
  const [friendReqStatus, setFriendReqStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [friendReqError, setFriendReqError] = useState('');
  const sendFriendRequest = useFriendsStore((s) => s.sendRequest);
  const openProfile = useModalStore((s) => s.openProfile);

  useUnreadStore((s) => s.dmLastRead);
  useUnreadStore((s) => s.dmLastMessage);

  useEffect(() => {
    fetchDmChannels();
  }, [fetchDmChannels]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await api.searchUsers(searchQuery.trim());
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      }
      setSearching(false);
    }, 300);
  }, [searchQuery]);

  const handleStartDm = async (targetUser: any) => {
    try {
      const dm = await createDm([targetUser.id]);
      setShowSearch(false);
      setSearchQuery('');
      navigate(`/dm/${dm.id}`);
    } catch (e: any) {
      if (e.message?.toLowerCase().includes('friends')) {
        setFriendPrompt(targetUser);
        setFriendReqStatus('idle');
        setFriendReqError('');
      } else {
        toast.error(e.message);
      }
    }
  };

  const handleSendFriendRequest = async () => {
    if (!friendPrompt) return;
    setFriendReqStatus('sending');
    setFriendReqError('');
    try {
      await sendFriendRequest(friendPrompt.name);
      setFriendReqStatus('sent');
    } catch (e: any) {
      setFriendReqStatus('error');
      setFriendReqError(e.message || 'failed to send request');
    }
  };

  const getDmDisplayName = (channel: any) => {
    if (channel.type === 'group' && channel.name) return channel.name;
    const others = channel.members?.filter((m: any) => m.id !== user?.id) || [];
    if (others.length === 0) return 'unknown';
    return others.map((m: any) => m.name).join(', ');
  };

  const getDmAvatar = (channel: any) => {
    const others = channel.members?.filter((m: any) => m.id !== user?.id) || [];
    if (others.length === 1 && others[0].avatar_url) return others[0].avatar_url;
    return null;
  };

  const getDmInitial = (channel: any) => {
    const others = channel.members?.filter((m: any) => m.id !== user?.id) || [];
    if (others.length === 1) return others[0].name?.[0]?.toUpperCase() || '?';
    return '#';
  };

  const formatPreview = (msg: any) => {
    if (!msg) return '';
    if (msg.call) return describeCall(msg.call, msg.author?.id === user?.id);
    const author = msg.author?.name || '';
    const content = msg.deleted ? '[deleted]' : msg.content || (msg.attachments?.length ? describeAttachments(msg.attachments) : '');
    const text = content.length > 40 ? content.slice(0, 40) + '...' : content;
    return `${author}: ${text}`;
  };


  return (
    <div className="dm-sidebar">
      <div className="header">
        <span className="title">messages</span>
        <button className="compose icon-btn" onClick={() => setShowSearch(!showSearch)} aria-label="new message">
          {showSearch ? <XIcon size={16} /> : <PlusIcon size={16} />}
        </button>
      </div>

      {showSearch && (
        <div className="search">
          <div className="search-field">
            <SearchIcon size={14} className="icon" />
            <input
              placeholder="search users..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
          </div>
          {searchResults.length > 0 && (
            <div className="results">
              {searchResults.map((u) => (
                <button key={u.id} className="result" onClick={() => handleStartDm(u)}>
                  <div className="avatar">
                    {u.avatar_url ? <img src={u.avatar_url} alt="" /> : <span>{u.name[0]?.toUpperCase()}</span>}
                  </div>
                  <span className="name">{u.name}</span>
                </button>
              ))}
            </div>
          )}
          {searching && <div className="loading">searching...</div>}
        </div>
      )}

      <div className="list">
        {channels.filter((ch: any) => ch.type !== 'direct' || ch.members?.some((m: any) => m.id !== user?.id)).map((ch: any) => {
          const unread = isDmUnread(ch.id);
          return (
          <button
            key={ch.id}
            className={`item ${ch.id === currentDmId ? 'active' : ''}`}
            data-unread={unread || undefined}
            onClick={() => navigate(`/dm/${ch.id}`)}
          >
            <div className="avatar" role="button" tabIndex={0} aria-label="view profile" onClick={(e) => {
              const others = ch.members?.filter((m: any) => m.id !== user?.id) || [];
              if (others.length === 1) { e.stopPropagation(); openProfile(others[0].id); }
            }}>
              {getDmAvatar(ch) ? (
                <img src={getDmAvatar(ch)} alt="" />
              ) : (
                <span>{getDmInitial(ch)}</span>
              )}
            </div>
            <div className="info">
              <div className="name">{getDmDisplayName(ch)}</div>
              {ch.last_message && (
                <div className="preview">{formatPreview(ch.last_message)}</div>
              )}
            </div>
            {ch.last_message && (
              <span className="time">{formatShortTime(ch.last_message.created_at)}</span>
            )}
          </button>
          );
        })}
        {channels.length === 0 && (
          <div className="empty-state">
            <p>no messages yet</p>
            <button className="btn btn-primary btn-sm" onClick={() => setShowSearch(true)}>
              start a conversation
            </button>
          </div>
        )}
      </div>

      <VoicePanel />

      {friendPrompt && (
        <Modal onClose={() => setFriendPrompt(null)} label="add friend">
          <h3 className="title">add friend</h3>
          <p className="modal-desc">
            you need to be friends with <strong>{friendPrompt.name}</strong> to message them.
          </p>
          {friendReqStatus === 'error' && (
            <p className="modal-error">{friendReqError}</p>
          )}
          {friendReqStatus === 'sent' ? (
            <div className="actions">
              <span className="modal-success">request sent!</span>
              <button className="btn btn-primary" onClick={() => setFriendPrompt(null)}>done</button>
            </div>
          ) : (
            <div className="actions">
              <button className="btn btn-secondary" onClick={() => setFriendPrompt(null)}>cancel</button>
              <button className="btn btn-primary" onClick={handleSendFriendRequest} disabled={friendReqStatus === 'sending'}>
                {friendReqStatus === 'sending' ? '...' : 'send friend request'}
              </button>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
