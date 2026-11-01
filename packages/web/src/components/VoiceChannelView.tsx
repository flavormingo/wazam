import { useState, useEffect, useRef, useMemo, type CSSProperties } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useVoiceStore, getRoom, preloadLiveKit } from '../stores/voice';
import { useChannelsStore } from '../stores/channels';
import { useMessagesStore } from '../stores/messages';
import { useAuthStore } from '../stores/auth';
import { useUnreadStore } from '../stores/unread';
import { api } from '../lib/api';
import { formatMessage } from '../lib/formatMessage';
import { formatMessageTime } from '../lib/time';
import { openLightbox } from '../stores/lightbox';
import { scrollBehavior } from '../lib/preferences';
import { wsClient } from '../lib/ws';
import { VolumeIcon, MicIcon, MicMutedIcon, CameraIcon, CameraOffIcon, ScreenIcon, PhoneIcon, MultiBubbleIcon, SendIcon, EditIcon, TrashIcon, ChevronLeftIcon, FaceSmileIcon } from './icons';
import { EmojiPicker } from './EmojiPicker';
import { MessageReactions } from './MessageReactions';
import { toast } from '../stores/toast';
import { ConfirmDialog } from './ConfirmDialog';
import { useMobile } from '../hooks/useMobile';
import type { Participant as LKParticipant, Track } from 'livekit-client';
import type { ServerOp } from '@wazam/shared';
import './VoiceChannelView.css';
import './CallStage.css';

const EMPTY_CHANNELS: any[] = [];

type TileDescriptor = {
  id: string;
  identity: string;
  name: string;
  type: 'participant' | 'screen';
  isSpeaking: boolean;
  isMuted: boolean;
  hasCamera: boolean;
  hasScreen: boolean;
  avatarUrl: string | null;
};

interface Props {
  clubId: string;
  channelId: string;
}

export function VoiceChannelView({ clubId, channelId }: Props) {
  const { clubId: clubParam } = useParams<{ clubId: string }>();
  const navigate = useNavigate();
  const mobile = useMobile();
  const connecting = useVoiceStore((s) => s.connecting);
  const connected = useVoiceStore((s) => s.connected);
  const voiceChannelId = useVoiceStore((s) => s.channelId);
  const muted = useVoiceStore((s) => s.muted);
  const cameraEnabled = useVoiceStore((s) => s.cameraEnabled);
  const screenSharing = useVoiceStore((s) => s.screenSharing);
  const participants = useVoiceStore((s) => s.participants);
  const joinVoice = useVoiceStore((s) => s.joinVoice);
  const leaveVoice = useVoiceStore((s) => s.leaveVoice);
  const toggleMute = useVoiceStore((s) => s.toggleMute);
  const toggleCamera = useVoiceStore((s) => s.toggleCamera);
  const toggleScreenShare = useVoiceStore((s) => s.toggleScreenShare);
  const channels = useChannelsStore((s) => s.channels[clubId] ?? EMPTY_CHANNELS);
  const channel = channels.find((c: any) => c.id === channelId);

  const { messages, loading, hasMore, fetchMessages, fetchOlderMessages } = useMessagesStore();
  const user = useAuthStore((s) => s.user);

  const [showChat, setShowChat] = useState(false);
  const [input, setInput] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [reactionPickerId, setReactionPickerId] = useState<string | null>(null);
  const [reactionPickerUp, setReactionPickerUp] = useState(false);
  const [showComposerEmoji, setShowComposerEmoji] = useState(false);
  const [hasNewChat, setHasNewChat] = useState(false);
  const prevMsgCount = useRef(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const lastTypingSent = useRef(0);
  const isInitialLoad = useRef(true);

  useEffect(() => { preloadLiveKit(); }, []);

  const [focusedTileId, setFocusedTileId] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [gridLayout, setGridLayout] = useState({ cols: 1, w: 240, h: 150 });

  const isConnectedHere = connected && voiceChannelId === channelId;
  const participantList = Object.values(participants);
  const channelMessages = messages[channelId] || [];

  const tiles: TileDescriptor[] = [];
  for (const p of participantList) {
    tiles.push({
      id: `participant:${p.identity}`,
      identity: p.identity,
      name: p.name,
      type: 'participant',
      isSpeaking: p.isSpeaking,
      isMuted: p.isMuted,
      hasCamera: p.hasCamera,
      hasScreen: p.hasScreen,
      avatarUrl: p.avatarUrl,
    });
    if (p.hasScreen) {
      tiles.push({
        id: `screen:${p.identity}`,
        identity: p.identity,
        name: p.name,
        type: 'screen',
        isSpeaking: false,
        isMuted: false,
        hasCamera: false,
        hasScreen: true,
        avatarUrl: p.avatarUrl,
      });
    }
  }

  const screenTileIds = useMemo(() => tiles.filter((t) => t.type === 'screen').map((t) => t.id), [tiles]);

  useEffect(() => {
    if (screenTileIds.length > 0) {
      setFocusedTileId((prev) => {
        if (prev && screenTileIds.includes(prev)) return prev;
        return screenTileIds[0];
      });
    } else {
      setFocusedTileId((prev) => prev?.startsWith('screen:') ? null : prev);
    }
  }, [screenTileIds.length]);

  useEffect(() => {
    const el = bodyRef.current;
    const n = tiles.length;
    if (!el || n === 0) return;
    const GAP = 12;
    const R = 16 / 10;
    const observer = new ResizeObserver((entries) => {
      const { width: W, height: H } = entries[0].contentRect;
      if (W <= 0 || H <= 0) return;
      let bestCols = 1;
      let bestArea = 0;
      let bestW = 100;
      let bestH = 62;
      for (let c = 1; c <= n; c++) {
        const rows = Math.ceil(n / c);
        let tw = (W - GAP * (c - 1)) / c;
        let th = tw / R;
        const maxH = (H - GAP * (rows - 1)) / rows;
        if (th > maxH) { th = maxH; tw = th * R; }
        if (tw > 0 && th > 0 && tw * th > bestArea) {
          bestArea = tw * th;
          bestCols = c;
          bestW = tw;
          bestH = th;
        }
      }
      setGridLayout({ cols: bestCols, w: Math.floor(bestW), h: Math.floor(bestH) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [tiles.length]);

  useEffect(() => {
    isInitialLoad.current = true;
    prevMsgCount.current = 0;
    setHasNewChat(false);
    fetchMessages(channelId);
    wsClient.subscribeChannel(channelId);
    useUnreadStore.getState().markChannelRead(channelId);

    const handleFocus = () => useUnreadStore.getState().markChannelRead(channelId);
    window.addEventListener('focus', handleFocus);

    return () => {
      wsClient.unsubscribeChannel(channelId);
      window.removeEventListener('focus', handleFocus);
    };
  }, [channelId, fetchMessages]);

  useEffect(() => {
    if (prevMsgCount.current > 0 && channelMessages.length > prevMsgCount.current && !showChat) {
      const latest = channelMessages[channelMessages.length - 1];
      if (latest?.author?.id !== user?.id) {
        setHasNewChat(true);
      }
    }
    prevMsgCount.current = channelMessages.length;
  }, [channelMessages.length, showChat, user?.id]);

  useEffect(() => {
    if (showChat) {
      setHasNewChat(false);
      useUnreadStore.getState().markChannelRead(channelId);
    }
  }, [showChat, channelId]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    if (isInitialLoad.current && channelMessages.length > 0) {
      isInitialLoad.current = false;
      messagesEndRef.current?.scrollIntoView();
      return;
    }

    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 200;
    if (isNearBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: scrollBehavior() });
    }
  }, [channelMessages.length]);

  useEffect(() => {
    const typingTimers: ReturnType<typeof setTimeout>[] = [];
    const unsub = wsClient.subscribe((op: ServerOp) => {
      if (op.op === 'typing.start' && op.d.channel_id === channelId && op.d.user_id !== user?.id) {
        setTypingUsers((prev) => {
          if (prev.includes(op.d.name)) return prev;
          return [...prev, op.d.name];
        });
        const timer = setTimeout(() => {
          setTypingUsers((prev) => prev.filter((u) => u !== op.d.name));
        }, 5000);
        typingTimers.push(timer);
      }
    });
    return () => {
      unsub();
      typingTimers.forEach(clearTimeout);
      setTypingUsers([]);
    };
  }, [channelId, user?.id]);

  const focusedTile = focusedTileId ? tiles.find((t) => t.id === focusedTileId) : null;
  const validFocusId = focusedTile ? focusedTileId : null;

  const handleTileClick = (id: string) => {
    setFocusedTileId((prev) => (prev === id ? null : id));
  };

  const handleToggleReaction = (messageId: string, emoji: string) => {
    api.toggleReaction(channelId, messageId, emoji).catch((e: any) => toast.error(e.message || 'failed to react'));
  };

  const handleSend = async () => {
    if (sending || !input.trim() || !channelId) return;
    setSending(true);
    try {
      await api.sendMessage(channelId, input.trim());
      setInput('');
    } catch (e) {
      console.error('Send failed:', e);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
      return;
    }
    if (channelId && Date.now() - lastTypingSent.current > 3000) {
      wsClient.send({ op: 'typing.start', d: { channel_id: channelId } });
      lastTypingSent.current = Date.now();
    }
  };

  const handleEdit = async (messageId: string) => {
    if (!channelId || !editContent.trim()) return;
    try {
      await api.editMessage(channelId, messageId, editContent.trim());
      setEditingId(null);
      setEditContent('');
    } catch (e) {
      console.error('Edit failed:', e);
    }
  };

  const handleDelete = async (messageId: string) => {
    if (!channelId) return;
    try {
      await api.deleteMessage(channelId, messageId);
    } catch (e) {
      console.error('Delete failed:', e);
    }
  };

  const handleScroll = () => {
    const container = messagesContainerRef.current;
    if (!container || !channelId) return;
    if (container.scrollTop === 0 && hasMore[channelId]) {
      fetchOlderMessages(channelId);
    }
  };


  const groupedMessages: { isGroupStart: boolean; message: any }[] = [];
  for (let i = 0; i < channelMessages.length; i++) {
    const msg = channelMessages[i];
    const prev = channelMessages[i - 1];
    const isGroupStart =
      !prev ||
      prev.author.id !== msg.author.id ||
      new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime() > 5 * 60 * 1000;
    groupedMessages.push({ isGroupStart, message: msg });
  }

  return (
    <div className="vc-view">
      <div className="header">
        {mobile && <button className="mobile-back" onClick={() => navigate(`/club/${clubParam}`)} aria-label="back"><ChevronLeftIcon size={20} /></button>}
        <VolumeIcon size={20} className="icon" />
        <span className="name">{channel?.name || ''}</span>
        <button
          className={`chat-toggle ${showChat ? 'active' : ''}`}
          onClick={() => setShowChat((v) => !v)}
          aria-label="toggle chat"
        >
          <MultiBubbleIcon size={18} />
          {hasNewChat && !showChat && <span className="unread-dot dot-badge" />}
        </button>
      </div>

      <div className="main">
        <div className="col">
          <div className={`body ${validFocusId ? 'has-focus' : ''}`} ref={bodyRef}>
            {isConnectedHere ? (
              validFocusId && focusedTile ? (
                <>
                  <VideoTile
                    key={focusedTile.id}
                    tile={focusedTile}
                    focused
                    onClick={() => handleTileClick(focusedTile.id)}
                  />
                  {tiles.length > 1 && (
                    <div className="strip">
                      {tiles.filter((t) => t.id !== validFocusId).map((t) => (
                        <VideoTile
                          key={t.id}
                          tile={t}
                          focused={false}
                          onClick={() => handleTileClick(t.id)}
                        />
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="grid" style={{ '--tile-w': `${gridLayout.w}px`, '--tile-h': `${gridLayout.h}px` } as CSSProperties}>
                  {tiles.map((t) => (
                    <VideoTile
                      key={t.id}
                      tile={t}
                      focused={false}
                      onClick={() => handleTileClick(t.id)}
                    />
                  ))}
                </div>
              )
            ) : (
              <div className="join">
                <VolumeIcon size={48} className="icon" />
                <p>{channel?.name || 'voice channel'}</p>
                <button onClick={() => joinVoice(channelId)} disabled={connecting}>
                  {connecting ? 'connecting...' : 'join voice'}
                </button>
              </div>
            )}
          </div>

          {isConnectedHere && (
            <div className="controls">
              <button
                className={`ctrl-btn ${muted ? 'active' : ''}`}
                onClick={toggleMute}
                aria-label={muted ? 'unmute' : 'mute'}
              >
                {muted ? <MicMutedIcon size={20} /> : <MicIcon size={20} />}
              </button>
              <button
                className={`ctrl-btn ${cameraEnabled ? 'active' : ''}`}
                onClick={toggleCamera}
                aria-label={cameraEnabled ? 'turn off camera' : 'turn on camera'}
              >
                {cameraEnabled ? <CameraIcon size={20} /> : <CameraOffIcon size={20} />}
              </button>
              <button
                className={`ctrl-btn ${screenSharing ? 'active' : ''}`}
                onClick={toggleScreenShare}
                aria-label={screenSharing ? 'stop sharing' : 'share screen'}
              >
                <ScreenIcon size={20} />
              </button>
              <button
                className="ctrl-btn disconnect"
                onClick={leaveVoice}
                aria-label="disconnect"
              >
                <PhoneIcon size={20} />
              </button>
            </div>
          )}
        </div>

        {showChat && (
          <div className="chat">
            <div className="msgs" ref={messagesContainerRef} onScroll={handleScroll}>
              {loading && <div className="loading"><div className="loading-spinner" /></div>}
              <div className="list">
                {groupedMessages.map(({ isGroupStart, message: msg }) => (
                  <div key={msg.id} className={`message ${isGroupStart ? 'group-start' : 'group-cont'} ${reactionPickerId === msg.id ? 'menu-open' : ''}`}>
                    {isGroupStart && (
                      <div className="avatar">
                        {msg.author.avatar_url ? (
                          <img src={msg.author.avatar_url} alt="" />
                        ) : (
                          <span>{msg.author.name[0]?.toUpperCase()}</span>
                        )}
                      </div>
                    )}
                    <div className="content">
                      {isGroupStart && (
                        <header>
                          <span className="author">{msg.author.name}</span>
                          <span className="time">{formatMessageTime(msg.created_at)}</span>
                        </header>
                      )}
                      {editingId === msg.id ? (
                        <div className="edit">
                          <textarea
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleEdit(msg.id); }
                              if (e.key === 'Escape') { setEditingId(null); }
                            }}
                            autoFocus
                          />
                          <span className="hint">escape to cancel, enter to save</span>
                        </div>
                      ) : msg.content ? (
                        <div className="text">{formatMessage(msg.content)}{msg.edited_at && <span className="edited">(edited)</span>}</div>
                      ) : null}
                      {msg.attachments?.length > 0 && (
                        <div className="attachments">
                          {msg.attachments.map((att: any) => (
                            <div key={att.id}>
                              {att.content_type.startsWith('image/') ? (
                                <img
                                  src={att.url}
                                  alt={att.filename}
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => openLightbox(att.url, att.filename)}
                                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLightbox(att.url, att.filename); } }}
                                />
                              ) : (
                                <a href={att.url} target="_blank" rel="noopener noreferrer">
                                  {att.filename} ({(att.size / 1024).toFixed(1)}KB)
                                </a>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      <MessageReactions reactions={msg.reactions} onToggle={(e) => handleToggleReaction(msg.id, e)} />
                    </div>
                    {!editingId && (
                      <div className="actions">
                        <button
                          className="action-btn"
                          aria-label="react"
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            if (reactionPickerId === msg.id) { setReactionPickerId(null); return; }
                            setReactionPickerUp(e.currentTarget.getBoundingClientRect().top > 340);
                            setShowComposerEmoji(false);
                            setReactionPickerId(msg.id);
                          }}
                        >
                          <FaceSmileIcon size={14} />
                        </button>
                        {msg.author.id === user?.id && (
                          <>
                            <button className="action-btn" aria-label="edit message" onClick={() => { setEditingId(msg.id); setEditContent(msg.content); }}>
                              <EditIcon size={14} />
                            </button>
                            <button className="action-btn danger" aria-label="delete message" onClick={() => setDeleteTarget(msg.id)}>
                              <TrashIcon size={14} />
                            </button>
                          </>
                        )}
                      </div>
                    )}
                    {reactionPickerId === msg.id && (
                      <div className="reaction-picker-anchor">
                        <EmojiPicker
                          placement={reactionPickerUp ? 'up-right' : 'down-right'}
                          onSelect={(e) => { handleToggleReaction(msg.id, e); setReactionPickerId(null); }}
                          onClose={() => setReactionPickerId(null)}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div ref={messagesEndRef} />
            </div>

            {typingUsers.length > 0 && (
              <div className="typing">
                <span className="dots">
                  <span /><span /><span />
                </span>
                {typingUsers.join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing...
              </div>
            )}

            <div className="msg-input">
              <div className="input-wrap">
                <div className="input-row">
                  <div className="emoji-wrap">
                    <button
                      className="icon-btn"
                      aria-label="emoji"
                      onMouseDown={(e) => { e.stopPropagation(); setReactionPickerId(null); setShowComposerEmoji((v) => !v); }}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setReactionPickerId(null); setShowComposerEmoji((v) => !v); } }}
                    >
                      <FaceSmileIcon size={20} />
                    </button>
                    {showComposerEmoji && (
                      <EmojiPicker
                        onSelect={(e) => { setInput((v) => v + e); setShowComposerEmoji(false); }}
                        onClose={() => setShowComposerEmoji(false)}
                      />
                    )}
                  </div>
                  <textarea
                    placeholder={`message #${channel?.name || ''}`}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    rows={1}
                  />
                  <button className="icon-btn send" onClick={handleSend} disabled={sending || !input.trim()} aria-label="send message">
                    <SendIcon size={20} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {deleteTarget && (
        <ConfirmDialog
          title="delete message"
          message="are you sure you want to delete this message?"
          confirmLabel="delete"
          danger
          onConfirm={() => { handleDelete(deleteTarget); setDeleteTarget(null); }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

function VideoTile({ tile, focused, onClick }: { tile: TileDescriptor; focused: boolean; onClick: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [imgError, setImgError] = useState(false);

  const source = tile.type === 'screen' ? 'screen_share' : 'camera';
  const trackTrigger = tile.type === 'screen' ? tile.hasScreen : tile.hasCamera;

  useEffect(() => {
    const r = getRoom();
    if (!r || !videoRef.current) return;

    let lkParticipant: LKParticipant | undefined;
    if (r.localParticipant.identity === tile.identity) {
      lkParticipant = r.localParticipant;
    } else {
      lkParticipant = r.remoteParticipants.get(tile.identity);
    }
    if (!lkParticipant) return;

    let track: Track | undefined;
    for (const pub of lkParticipant.videoTrackPublications.values()) {
      if (pub.source === source && pub.track) {
        track = pub.track;
        break;
      }
    }

    const el = videoRef.current;
    if (track) {
      track.attach(el);
      return () => { track!.detach(el); };
    }
  }, [tile.identity, source, trackTrigger]);

  const isScreen = tile.type === 'screen';
  const showVideo = isScreen ? tile.hasScreen : tile.hasCamera;
  const isLocal = getRoom()?.localParticipant?.identity === tile.identity;

  return (
    <div
      className={`tile ${isScreen ? 'screen' : ''} ${tile.isSpeaking ? 'speaking' : ''} ${focused ? 'focused' : ''}`}
      onClick={onClick}
    >
      {showVideo ? (
        <video ref={videoRef} autoPlay playsInline muted className={isLocal && !isScreen ? 'mirror' : ''} />
      ) : (
        <div className="tile-avatar">
          <span>
            {tile.avatarUrl && !imgError ? <img src={tile.avatarUrl} alt="" onError={() => setImgError(true)} /> : tile.name[0]?.toUpperCase()}
          </span>
        </div>
      )}
      <div className="bar">
        {isScreen && <ScreenIcon size={14} />}
        <span className="name">{isScreen ? `${tile.name}'s screen` : tile.name}</span>
        {!isScreen && tile.isMuted && <MicMutedIcon size={14} className="muted" />}
      </div>
    </div>
  );
}
