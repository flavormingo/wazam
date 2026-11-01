import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useDmsStore } from '../stores/dms';
import { useAuthStore } from '../stores/auth';
import { useCallStore } from '../stores/call';
import { useVoiceStore } from '../stores/voice';
import { api } from '../lib/api';
import { wsClient } from '../lib/ws';
import { SendIcon, EditIcon, TrashIcon, PhoneIcon, ChevronLeftIcon, FaceSmileIcon } from './icons';
import { MuteButton } from './MuteButton';
import { EmojiPicker } from './EmojiPicker';
import { MessageReactions } from './MessageReactions';
import { toast } from '../stores/toast';
import { formatMessageTime } from '../lib/time';
import { formatMessage } from '../lib/formatMessage';
import { scrollBehavior } from '../lib/preferences';
import { FormatToolbar } from './FormatToolbar';
import { ConfirmDialog } from './ConfirmDialog';
import { DMCallView } from './DMCallView';
import { useModalStore } from '../stores/modal';
import { useUnreadStore } from '../stores/unread';
import { useMobile } from '../hooks/useMobile';
import { VALENTINO_ID, type ServerOp } from '@wazup/shared';
import './DMView.css';

export function DMView() {
  const { dmChannelId } = useParams<{ dmChannelId: string }>();
  const navigate = useNavigate();
  const mobile = useMobile();
  const { messages, loading, hasMore, fetchDmMessages, fetchOlderDmMessages, setCurrentDm, addDmMessage } = useDmsStore();
  const channels = useDmsStore((s) => s.channels);
  const user = useAuthStore((s) => s.user);
  const openProfile = useModalStore((s) => s.openProfile);
  const outgoingCall = useCallStore((s) => s.outgoingCall);
  const setOutgoingCall = useCallStore((s) => s.setOutgoingCall);
  const activeCallDmChannelId = useCallStore((s) => s.activeCallDmChannelId);
  const voiceConnected = useVoiceStore((s) => s.connected);
  const [input, setInput] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [showComposerEmoji, setShowComposerEmoji] = useState(false);
  const [reactionPickerId, setReactionPickerId] = useState<string | null>(null);
  const [reactionPickerUp, setReactionPickerUp] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastTypingSent = useRef(0);
  const isInitialLoad = useRef(true);

  const channel = channels.find((c: any) => c.id === dmChannelId);
  const channelMessages = dmChannelId ? (messages[dmChannelId] || []) : [];

  const getRecipientName = () => {
    if (!channel) return 'messages';
    if (channel.type === 'group' && channel.name) return channel.name;
    const others = channel.members?.filter((m: any) => m.id !== user?.id) || [];
    return others.map((m: any) => m.name).join(', ') || 'messages';
  };

  useEffect(() => {
    if (dmChannelId) {
      isInitialLoad.current = true;
      setCurrentDm(dmChannelId);
      fetchDmMessages(dmChannelId);
      useUnreadStore.getState().markDmRead(dmChannelId);

      const handleFocus = () => useUnreadStore.getState().markDmRead(dmChannelId);
      window.addEventListener('focus', handleFocus);

      return () => {
        setCurrentDm(null);
        window.removeEventListener('focus', handleFocus);
      };
    }
  }, [dmChannelId, fetchDmMessages, setCurrentDm]);

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
      if (op.op === 'dm.typing.start' && op.d.dm_channel_id === dmChannelId && op.d.user_id !== user?.id) {
        setTypingUsers((prev) => {
          if (prev.includes(op.d.name)) return prev;
          return [...prev, op.d.name];
        });
        const timer = setTimeout(() => {
          setTypingUsers((prev) => prev.filter((u) => u !== op.d.name));
        }, 5000);
        typingTimers.push(timer);
      } else if (op.op === 'dm.message.create' && op.d.dm_channel_id === dmChannelId) {
        setTypingUsers((prev) => prev.filter((u) => u !== op.d.author.name));
      }
    });
    return () => {
      unsub();
      typingTimers.forEach(clearTimeout);
      setTypingUsers([]);
    };
  }, [dmChannelId, user?.id]);


  const handleStartCall = async () => {
    if (!dmChannelId || voiceConnected) return;
    try {
      await api.startCall(dmChannelId);
      setOutgoingCall({ dmChannelId });
    } catch (err: any) {
      toast.error(err.message || 'failed to start call');
    }
  };

  const isActiveCallHere = activeCallDmChannelId === dmChannelId;
  const isOutgoingHere = outgoingCall?.dmChannelId === dmChannelId;
  const isDirectChannel = channel?.type === 'direct';
  const isValentino = isDirectChannel && channel.members?.some((m: any) => m.id === VALENTINO_ID);
  const otherMember = isDirectChannel ? channel.members?.find((m: any) => m.id !== user?.id) : null;

  const handleSend = async () => {
    if (sending || !input.trim() || !dmChannelId) return;
    setSending(true);
    setSendError(null);
    try {
      const msg = await api.sendDmMessage(dmChannelId, input.trim());
      addDmMessage(msg);
      setInput('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.overflowY = 'hidden';
      }
    } catch {
      setSendError('failed to send');
    } finally {
      setSending(false);
    }
  };

  const handleToggleReaction = (messageId: string, emoji: string) => {
    if (!dmChannelId) return;
    api.toggleDmReaction(dmChannelId, messageId, emoji).catch((e: any) => toast.error(e.message || 'failed to react'));
  };

  const insertEmoji = (emoji: string) => {
    const el = textareaRef.current;
    if (!el) {
      setInput((v) => v + emoji);
      return;
    }
    const start = el.selectionStart ?? input.length;
    const end = el.selectionEnd ?? input.length;
    setInput(input.slice(0, start) + emoji + input.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + emoji.length;
      el.setSelectionRange(pos, pos);
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
      el.style.overflowY = el.scrollHeight > 200 ? 'auto' : 'hidden';
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
      return;
    }
    if (dmChannelId && Date.now() - lastTypingSent.current > 3000) {
      wsClient.sendDmTyping(dmChannelId);
      lastTypingSent.current = Date.now();
    }
  };

  const handleEdit = async (messageId: string) => {
    if (!dmChannelId || !editContent.trim()) return;
    try {
      await api.editDmMessage(dmChannelId, messageId, editContent.trim());
      setEditingId(null);
      setEditContent('');
    } catch (e) {
      console.error('Edit failed:', e);
    }
  };

  const handleDelete = async (messageId: string) => {
    if (!dmChannelId) return;
    try {
      await api.deleteDmMessage(dmChannelId, messageId);
    } catch (e) {
      console.error('Delete failed:', e);
    }
  };

  const handleScroll = () => {
    const container = messagesContainerRef.current;
    if (!container || !dmChannelId) return;
    if (container.scrollTop === 0 && hasMore[dmChannelId]) {
      fetchOlderDmMessages(dmChannelId);
    }
  };


  const valentinoMessageId = channelMessages.find((m: any) => m.author.id === VALENTINO_ID)?.id;

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
    <div className="dm-view">
      <div className="header">
        {mobile && <button className="mobile-back" onClick={() => navigate('/dm')} aria-label="back"><ChevronLeftIcon size={20} /></button>}
        {otherMember ? (
          <button className="name" onClick={() => openProfile(otherMember.id)}>{getRecipientName()}</button>
        ) : (
          <span className="name">{getRecipientName()}</span>
        )}
        {dmChannelId && <MuteButton scopeType="dm" scopeId={dmChannelId} />}
        {isDirectChannel && !isValentino && (
          <button
            className="icon-btn"
            onClick={handleStartCall}
            disabled={voiceConnected || isOutgoingHere}
            aria-label="start call"
          >
            <PhoneIcon size={18} />
          </button>
        )}
      </div>

      {isActiveCallHere && dmChannelId && (
        <DMCallView dmChannelId={dmChannelId} />
      )}

      {!isActiveCallHere && (
        <>
          <div className="messages" ref={messagesContainerRef} onScroll={handleScroll}>
            {loading && <div className="loading"><div className="loading-spinner" /></div>}
            <div className="list">
              {groupedMessages.map(({ isGroupStart, message: msg }) => (
                <div
                  key={msg.id}
                  className={`message ${isGroupStart ? 'group-start' : 'group-cont'} ${reactionPickerId === msg.id ? 'menu-open' : ''}`}
                  data-tour={msg.id === valentinoMessageId ? 'valentino-message' : undefined}
                >
                  {isGroupStart && (
                    <div className="avatar" onClick={() => openProfile(msg.author.id)}>
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
                        <span className="author" onClick={() => openProfile(msg.author.id)}>{msg.author.name}</span>
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
              <span className="dots"><span /><span /><span /></span>
              {typingUsers.join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing...
            </div>
          )}

          {sendError && (
            <div className="send-error">{sendError}</div>
          )}

          <div className="msg-input">
            <div className="input-wrap" data-tour="composer">
              <FormatToolbar
                textareaRef={textareaRef}
                value={input}
                onChange={setInput}
                leading={
                  <div className="emoji-wrap">
                    <button
                      className="fmt-btn icon-btn"
                      aria-label="emoji"
                      onMouseDown={(e) => { e.stopPropagation(); setReactionPickerId(null); setShowComposerEmoji((v) => !v); }}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setReactionPickerId(null); setShowComposerEmoji((v) => !v); } }}
                    >
                      <FaceSmileIcon size={16} />
                    </button>
                    {showComposerEmoji && (
                      <EmojiPicker
                        onSelect={(e) => { insertEmoji(e); setShowComposerEmoji(false); }}
                        onClose={() => setShowComposerEmoji(false)}
                      />
                    )}
                  </div>
                }
              />
              <div className="input-row">
                <textarea
                  ref={textareaRef}
                  placeholder={`message ${getRecipientName()}`}
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    const el = e.target;
                    el.style.height = 'auto';
                    el.style.height = el.scrollHeight + 'px';
                    el.style.overflowY = el.scrollHeight > 200 ? 'auto' : 'hidden';
                  }}
                  onKeyDown={handleKeyDown}
                  rows={1}
                />
                <button className="icon-btn send" onClick={handleSend} disabled={sending || !input.trim()} aria-label="send message">
                  <SendIcon size={20} />
                </button>
              </div>
            </div>
          </div>
        </>
      )}

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
