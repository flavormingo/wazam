import { useState, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useClubsStore } from '../stores/clubs';
import { api, uploadToPresigned } from '../lib/api';
import { PlusIcon, MessageTextIcon } from './icons';
import { Modal } from './Modal';
import { useUnreadStore, hasClubUnread, getUnreadDmCount } from '../stores/unread';
import './ClubSidebar.css';

export function ClubSidebar() {
  const { clubs, createClub, currentClubId } = useClubsStore();
  const navigate = useNavigate();
  const clubId = currentClubId;
  useUnreadStore((s) => s.channelLastRead);
  useUnreadStore((s) => s.channelLastMessage);
  useUnreadStore((s) => s.dmLastRead);
  useUnreadStore((s) => s.dmLastMessage);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const [iconKey, setIconKey] = useState<string | null>(null);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleIconSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    try {
      const presign = await api.presignNewClubIcon({
        filename: file.name,
        content_type: file.type,
        size: file.size,
      });
      await uploadToPresigned(presign, file);
      setIconKey(presign.key);
      setIconPreview(presign.public_url);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setError('');
    try {
      const data: any = { name: newName.trim() };
      if (newSlug.trim()) data.slug = newSlug.trim();
      if (iconKey) data.icon_key = iconKey;
      const club = await createClub(data);
      setNewName('');
      setNewSlug('');
      setIconPreview(null);
      setIconKey(null);
      setShowCreate(false);
      navigate(`/club/${club.slug}`);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleSlugChange = (val: string) => {
    setNewSlug(val.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''));
  };

  const initials = newName ? newName.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase() : '';

  return (
    <div className="club-sidebar">
      <div className="list">
        <button
          className={`icon home ${!clubId ? 'active' : ''}`}
          data-tour="home"
          onClick={() => navigate('/dm')}
          aria-label="messages"
        >
          <MessageTextIcon size={22} />
          {getUnreadDmCount() > 0 && <span className="unread-badge" />}
        </button>

        <div className="divider" />

        {clubs.map((club) => (
          <button
            key={club.id}
            className={`icon ${club.id === clubId ? 'active' : ''}`}
            onClick={() => navigate(`/club/${club.slug}`)}
            aria-label={club.name}
          >
            {club.icon_url ? (
              <img src={club.icon_url} alt={club.name} />
            ) : (
              <span className="text">
                {club.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}
              </span>
            )}
            {hasClubUnread(club.id) && <span className="unread-badge" />}
          </button>
        ))}
      </div>

      <div className="bottom">
        <button
          className="icon create"
          data-tour="create-club"
          onClick={() => setShowCreate(true)}
          aria-label="create club"
        >
          <PlusIcon size={20} />
        </button>
      </div>

      {showCreate && (
        <Modal onClose={() => setShowCreate(false)} label="create a club">
            <h3 className="title">create a club</h3>

            <input type="file" ref={fileRef} accept="image/*" hidden onChange={handleIconSelect} />
            <div
              style={{
                width: 72, height: 72, borderRadius: '50%', background: 'var(--bg-raised)',
                border: '2px dashed var(--border)', display: 'flex', alignItems: 'center',
                justifyContent: 'center', cursor: 'pointer', margin: '0 auto var(--space-lg)',
                overflow: 'hidden', color: 'var(--fg-3)', fontSize: 'var(--text-lg)', fontWeight: 600,
              }}
              role="button"
              tabIndex={0}
              aria-label="upload club icon"
              onClick={() => fileRef.current?.click()}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current?.click(); } }}
            >
              {iconPreview ? (
                <img src={iconPreview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <span>{initials || '+'}</span>
              )}
            </div>

            <input
              className="input"
              placeholder="club name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              autoFocus
            />

            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 'var(--space-lg)' }}>
              <span style={{
                fontSize: 'var(--text-xs)', color: 'var(--fg-3)',
                padding: 'var(--space-sm) var(--space-sm) var(--space-sm) var(--space-md)',
                background: 'var(--bg-raised)', border: '1px solid var(--border)',
                borderRight: 'none', borderRadius: 'var(--r-md) 0 0 var(--r-md)', whiteSpace: 'nowrap',
              }}>wazup.chat/club/</span>
              <input
                style={{
                  flex: 1, padding: 'var(--space-sm) var(--space-md)',
                  background: 'var(--bg-raised)', border: '1px solid var(--border)',
                  borderRadius: '0 var(--r-md) var(--r-md) 0', color: 'var(--fg)',
                  fontSize: 'var(--text-sm)', marginBottom: 0,
                }}
                placeholder="optional"
                value={newSlug}
                onChange={(e) => handleSlugChange(e.target.value)}
                maxLength={30}
              />
            </div>

            {error && <p className="modal-error">{error}</p>}
            <div className="actions">
              <button className="btn btn-secondary" onClick={() => setShowCreate(false)}>cancel</button>
              <button className="btn btn-primary" onClick={handleCreate}>create</button>
            </div>
        </Modal>
      )}
    </div>
  );
}
