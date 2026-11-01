import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useMessagesStore } from '../stores/messages';
import { useChannelsStore } from '../stores/channels';
import { useAuthStore } from '../stores/auth';
import { api, uploadToPresigned } from '../lib/api';
import { wsClient } from '../lib/ws';
import { HashIcon, PaperclipIcon, SendIcon, EditIcon, TrashIcon, ChevronLeftIcon, FaceSmileIcon, XIcon } from './icons';
import { formatMessageTime } from '../lib/time';
import { formatMessage } from '../lib/formatMessage';
import { scrollBehavior } from '../lib/preferences';
import { openLightbox } from '../stores/lightbox';
import { toast } from '../stores/toast';
import { WormMark } from './WormMark';
import { MuteButton } from './MuteButton';
import { EmojiPicker } from './EmojiPicker';
import { MessageReactions } from './MessageReactions';
import { FormatToolbar } from './FormatToolbar';
import { ConfirmDialog } from './ConfirmDialog';
import { useModalStore } from '../stores/modal';
import { useUnreadStore } from '../stores/unread';
import { useMobile } from '../hooks/useMobile';
import type { ServerOp } from '@wazam/shared';
import './ChannelView.css';

const EMPTY_CHANNELS: any[] = [];

interface Props {
  clubId: string;
}

export function ChannelView({ clubId }: Props) {
  const { clubId: clubParam, channelId } = useParams<{ clubId: string; channelId: string }>();
  const navigate = useNavigate();
  const mobile = useMobile();
  const { messages, loading, hasMore, fetchMessages, fetchOlderMessages } = useMessagesStore();
  const channels = useChannelsStore((s) => s.channels[clubId] ?? EMPTY_CHANNELS);
  const user = useAuthStore((s) => s.user);
  const openProfile = useModalStore((s) => s.openProfile);
  const [input, setInput] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [reactionPickerId, setReactionPickerId] = useState<string | null>(null);
  const [reactionPickerUp, setReactionPickerUp] = useState(false);
  const [showComposerEmoji, setShowComposerEmoji] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastTypingSent = useRef(0);
  const isInitialLoad = useRef(true);

  const channel = channels.find((c: any) => c.id === channelId);
  const channelMessages = channelId ? (messages[channelId] || []) : [];

  useEffect(() => {
    if (channelId) {
      isInitialLoad.current = true;
      fetchMessages(channelId);
      wsClient.subscribeChannel(channelId);
      useUnreadStore.getState().markChannelRead(channelId);

      const handleFocus = () => useUnreadStore.getState().markChannelRead(channelId);
      window.addEventListener('focus', handleFocus);

      return () => {
        wsClient.unsubscribeChannel(channelId);
        window.removeEventListener('focus', handleFocus);
      };
    }
  }, [channelId, fetchMessages]);

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

  const handleSend = async () => {
    if (sending || (!input.trim() && !pendingFiles.length) || !channelId) return;
    setSending(true);

    setSendError(null);
    let attachmentIds: string[] = [];
    let uploadFailed = false;

    for (const file of pendingFiles) {
      try {
        const presign = await api.presignUpload({
          filename: file.name,
          content_type: file.type,
          size: file.size,
        });
        await uploadToPresigned(presign, file);
        attachmentIds.push(presign.attachment_id);
      } catch {
        uploadFailed = true;
      }
    }

    if (uploadFailed) {
      setSendError('some attachments failed to upload');
      setSending(false);
      return;
    }

    try {
      await api.sendMessage(channelId, input.trim(), attachmentIds.length ? attachmentIds : undefined);
      setInput('');
      setPendingFiles([]);
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
    if (!channelId) return;
    api.toggleReaction(channelId, messageId, emoji).catch((e: any) => toast.error(e.message || 'failed to react'));
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

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    setPendingFiles((prev) => [...prev, ...files]);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setPendingFiles((prev) => [...prev, ...files]);
    e.target.value = '';
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
    <div className="channel-view" onDrop={handleFileDrop} onDragOver={(e) => e.preventDefault()}>
      <div className="header">
        <div className="left">
          {mobile && <button className="mobile-back" onClick={() => navigate(`/club/${clubParam}`)} aria-label="back"><ChevronLeftIcon size={20} /></button>}
          <HashIcon size={20} className="icon" />
          <span className="name">{channel?.name || ''}</span>
        </div>
        {channelId && <MuteButton scopeType="channel" scopeId={channelId} />}
      </div>

      <div className="messages" ref={messagesContainerRef} onScroll={handleScroll}>
        {loading && <div className="loading"><div className="loading-spinner" /></div>}

        {!loading && channelId && Array.isArray(messages[channelId]) && channelMessages.length === 0 && (
          <div className="channel-empty empty-hero">
            <WormMark size={72} />
            <h2>it's quiet in here</h2>
            <p>be the first to say wazam in #{channel?.name}</p>
          </div>
        )}

        <div className="list">
          {groupedMessages.map(({ isGroupStart, message: msg }) => (
            <div key={msg.id} className={`message ${isGroupStart ? 'group-start' : 'group-cont'} ${reactionPickerId === msg.id ? 'menu-open' : ''}`}>
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

      {sendError && (
        <div className="send-error">{sendError}</div>
      )}

      {pendingFiles.length > 0 && (
        <div className="pending-files">
          {pendingFiles.map((f, i) => (
            <div key={`${f.name}-${f.size}-${f.lastModified}`} className="file">
              <span>{f.name}</span>
              <button aria-label="remove file" onClick={() => setPendingFiles((prev) => prev.filter((_, j) => j !== i))}><XIcon size={10} /></button>
            </div>
          ))}
        </div>
      )}

      <div className="msg-input">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={handleFileSelect}
        />
        <div className="input-wrap">
          <FormatToolbar
            textareaRef={textareaRef}
            value={input}
            onChange={setInput}
            leading={
              <>
                <button className="fmt-btn icon-btn" onClick={() => fileInputRef.current?.click()} aria-label="attach">
                  <PaperclipIcon size={16} />
                </button>
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
              </>
            }
          />
          <div className="input-row">
            <textarea
              ref={textareaRef}
              placeholder={`message #${channel?.name || ''}`}
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
            <button className="icon-btn send" onClick={handleSend} disabled={sending || (!input.trim() && !pendingFiles.length)} aria-label="send message">
              <SendIcon size={20} />
            </button>
          </div>
        </div>
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
