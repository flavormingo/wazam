import { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '../stores/auth';
import { toast } from '../stores/toast';
import { useFriendsStore } from '../stores/friends';
import { useDmsStore } from '../stores/dms';
import { api, uploadToPresigned } from '../lib/api';
import { formatShortDate } from '../lib/time';
import {
  XIcon, CheckIcon, LocationIcon, EditIcon, ImageUploadIcon, GlobalLinkIcon, PlusIcon,
  FaceSmileIcon,
  DribbbleIcon, FacebookIcon, GithubIcon, InstagramIcon, LinkedinIcon,
  MediumIcon, PinterestIcon, SnapchatIcon, TelegramIcon,
  ThreadsIcon, TiktokIcon, YoutubeIcon, XPlatformIcon,
} from './icons';
import { EmojiPicker } from './EmojiPicker';
import { Modal } from './Modal';
import { useOutsideClose } from '../hooks/useOutsideClose';
import { useNavigate } from 'react-router';
import './ProfileModal.css';

const PLATFORMS = [
  { key: 'dribbble', label: 'Dribbble', Icon: DribbbleIcon, url: 'https://dribbble.com/' },
  { key: 'facebook', label: 'Facebook', Icon: FacebookIcon, url: 'https://facebook.com/' },
  { key: 'github', label: 'GitHub', Icon: GithubIcon, url: 'https://github.com/' },
  { key: 'instagram', label: 'Instagram', Icon: InstagramIcon, url: 'https://instagram.com/' },
  { key: 'linkedin', label: 'LinkedIn', Icon: LinkedinIcon, url: 'https://linkedin.com/in/' },
  { key: 'medium', label: 'Medium', Icon: MediumIcon, url: 'https://medium.com/@' },
  { key: 'pinterest', label: 'Pinterest', Icon: PinterestIcon, url: 'https://pinterest.com/' },
  { key: 'snapchat', label: 'Snapchat', Icon: SnapchatIcon, url: 'https://snapchat.com/add/' },
  { key: 'telegram', label: 'Telegram', Icon: TelegramIcon, url: 'https://t.me/' },
  { key: 'threads', label: 'Threads', Icon: ThreadsIcon, url: 'https://threads.net/@' },
  { key: 'tiktok', label: 'TikTok', Icon: TiktokIcon, url: 'https://tiktok.com/@' },
  { key: 'x', label: 'X', Icon: XPlatformIcon, url: 'https://x.com/' },
  { key: 'youtube', label: 'YouTube', Icon: YoutubeIcon, url: 'https://youtube.com/@' },
] as const;

interface Props {
  userId: string | null;
  onClose: () => void;
}

export function ProfileModal({ userId, onClose }: Props) {
  const currentUser = useAuthStore((s) => s.user);
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const friends = useFriendsStore((s) => s.friends);
  const sendRequest = useFriendsStore((s) => s.sendRequest);
  const removeFriend = useFriendsStore((s) => s.removeFriend);
  const createDm = useDmsStore((s) => s.createDm);
  const navigate = useNavigate();

  const isOwnProfile = !userId || userId === currentUser?.id;
  const [profile, setProfile] = useState<any>(null);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [statusEmoji, setStatusEmoji] = useState('');
  const [statusText, setStatusText] = useState('');
  const [bio, setBio] = useState('');
  const [location, setLocation] = useState('');
  const [link, setLink] = useState('');
  const [connections, setConnections] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [socialPickerOpen, setSocialPickerOpen] = useState(false);
  const socialPickerRef = useRef<HTMLDivElement>(null);

  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [bannerPreview, setBannerPreview] = useState<string | null>(null);
  const [pendingAvatarKey, setPendingAvatarKey] = useState<string | null>(null);
  const [pendingBannerKey, setPendingBannerKey] = useState<string | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [removeBanner, setRemoveBanner] = useState(false);
  const bioRef = useRef<HTMLTextAreaElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOwnProfile) {
      const p = {
        ...currentUser,
        status_emoji: currentUser?.status_emoji || '',
        status_text: currentUser?.status_text || '',
        bio: currentUser?.bio || '',
        location: currentUser?.location || '',
        link: currentUser?.link || '',
        connections: currentUser?.connections || {},
      };
      setProfile(p);
      populateEditFields(p);
    } else if (userId) {
      api.getUserProfile(userId).then((p) => {
        setProfile(p);
      }).catch(() => setProfile(null));
    }

    return () => {
      setEditing(false);
      setProfile(null);
      setAvatarPreview(null);
      setBannerPreview(null);
      setPendingAvatarKey(null);
      setPendingBannerKey(null);
      setRemoveAvatar(false);
      setRemoveBanner(false);
    };
  }, [userId, isOwnProfile, currentUser]);

  useEffect(() => {
    if (bioRef.current) {
      bioRef.current.style.height = 'auto';
      bioRef.current.style.height = bioRef.current.scrollHeight + 'px';
    }
  }, [bio, editing]);

  useOutsideClose(socialPickerRef, () => setSocialPickerOpen(false), socialPickerOpen);

  const populateEditFields = (p: any) => {
    setEditName(p.name || '');
    setStatusEmoji(p.status_emoji || '');
    setStatusText(p.status_text || '');
    setBio(p.bio || '');
    setLocation(p.location || '');
    setLink(p.link || '');
    setConnections(p.connections || {});
  };

  const friendship = friends.find((f: any) => f.user.id === userId);

  const handleImageUpload = async (file: File, type: 'avatar' | 'banner') => {
    const previewUrl = URL.createObjectURL(file);
    if (type === 'avatar') { setAvatarPreview(previewUrl); setRemoveAvatar(false); }
    else { setBannerPreview(previewUrl); setRemoveBanner(false); }

    try {
      const result = await api.presignProfileImage({
        type,
        filename: file.name,
        content_type: file.type,
        size: file.size,
      });
      await uploadToPresigned(result, file);
      if (type === 'avatar') setPendingAvatarKey(result.key);
      else setPendingBannerKey(result.key);
    } catch (e: any) {
      toast.error(e.message);
      if (type === 'avatar') setAvatarPreview(null);
      else setBannerPreview(null);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, type: 'avatar' | 'banner') => {
    const file = e.target.files?.[0];
    if (file) handleImageUpload(file, type);
    e.target.value = '';
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const cleanedConnections: Record<string, string> = {};
      for (const [k, v] of Object.entries(connections)) {
        if (v) cleanedConnections[k] = v;
      }
      const data: any = {
        name: editName || '',
        status_emoji: statusEmoji || '',
        status_text: statusText || '',
        bio: bio || '',
        location: location || '',
        link: link || '',
        connections: cleanedConnections,
      };
      if (pendingAvatarKey) data.avatar_key = pendingAvatarKey;
      else if (removeAvatar) data.avatar_key = '';
      if (pendingBannerKey) data.banner_key = pendingBannerKey;
      else if (removeBanner) data.banner_key = '';
      await updateProfile(data);
      setEditing(false);
      setAvatarPreview(null);
      setBannerPreview(null);
      setPendingAvatarKey(null);
      setPendingBannerKey(null);
      setRemoveAvatar(false);
      setRemoveBanner(false);
    } catch (e: any) {
      toast.error(e.message);
    }
    setSaving(false);
  };

  const handleStartEdit = () => {
    if (profile) populateEditFields(profile);
    setEditing(true);
  };

  const handleCancelEdit = () => {
    setEditing(false);
    setSocialPickerOpen(false);
    setAvatarPreview(null);
    setBannerPreview(null);
    setPendingAvatarKey(null);
    setPendingBannerKey(null);
    setRemoveAvatar(false);
    setRemoveBanner(false);
  };

  const handleAddFriend = async () => {
    if (!profile?.name) return;
    try {
      await sendRequest(profile.name);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleRemoveFriend = async () => {
    if (!friendship) return;
    try {
      await removeFriend(friendship.id);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleMessage = async () => {
    if (!userId) return;
    try {
      const dm = await createDm([userId]);
      onClose();
      navigate(`/dm/${dm.id}`);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  if (!profile) return null;

  const displayAvatar = removeAvatar ? null : (avatarPreview || profile.avatar_url);
  const displayBanner = removeBanner ? null : (bannerPreview || profile.banner_url);
  const profileConnections = profile.connections || {};
  const activeConnections = PLATFORMS
    .filter((p) => profileConnections[p.key])
    .map((p) => [p.key, profileConnections[p.key]] as [string, string]);

  const activePlatforms = PLATFORMS.filter((p) => p.key in connections);
  const availablePlatforms = PLATFORMS.filter((p) => !(p.key in connections));

  const hasBio = !!profile.bio;
  const hasConnections = activeConnections.length > 0;
  const hasMeta = !!profile.location || !!profile.link;
  const hasStatus = !!profile.status_emoji || !!profile.status_text;

  return (
    <Modal onClose={onClose} label="profile" className="profile" bare>
        <button className="modal-close over-banner" onClick={onClose} aria-label="close">
          <XIcon size={18} />
        </button>
        <div className="profile-scroll">
        <div className="banner" style={displayBanner ? { backgroundImage: `url(${displayBanner})` } : undefined}>
          {editing && (
            <div className="upload-overlay">
              <div className="banner-actions">
                <button type="button" onClick={() => bannerInputRef.current?.click()}>
                  <ImageUploadIcon size={20} />
                  <span>change banner</span>
                </button>
                {(bannerPreview || profile.banner_url) && !removeBanner && (
                  <button type="button" onClick={() => { setRemoveBanner(true); setBannerPreview(null); setPendingBannerKey(null); }}>
                    <XIcon size={16} />
                    <span>remove</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <input ref={bannerInputRef} type="file" accept="image/*" hidden onChange={(e) => handleFileChange(e, 'banner')} />
        <input ref={avatarInputRef} type="file" accept="image/*" hidden onChange={(e) => handleFileChange(e, 'avatar')} />

        <div className="avatar-section">
          <div
            className="avatar avatar-lg"
            onClick={editing ? () => avatarInputRef.current?.click() : undefined}
            role={editing ? 'button' : undefined}
            tabIndex={editing ? 0 : undefined}
            aria-label={editing ? 'change avatar' : undefined}
            onKeyDown={editing ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); avatarInputRef.current?.click(); } } : undefined}
          >
            {displayAvatar ? (
              <img src={displayAvatar} alt="" />
            ) : (
              <span>{profile.name?.[0]?.toUpperCase()}</span>
            )}
            {editing && (
              <div className="avatar-upload">
                <ImageUploadIcon size={20} />
              </div>
            )}
          </div>
          {editing && displayAvatar && (
            <button
              className="avatar-remove"
              type="button"
              aria-label="remove avatar"
              onClick={() => { setRemoveAvatar(true); setAvatarPreview(null); setPendingAvatarKey(null); }}
            >
              <XIcon size={10} />
            </button>
          )}
        </div>

        {isOwnProfile && (
          <div className="profile-actions">
            {editing ? (
              <>
                <button className="icon-btn profile-action" onClick={handleCancelEdit} aria-label="cancel">
                  <XIcon size={16} />
                </button>
                <button className="icon-btn profile-action accent" onClick={handleSave} disabled={saving} aria-label="save">
                  <CheckIcon size={16} />
                </button>
              </>
            ) : (
              <button className="icon-btn profile-action" onClick={handleStartEdit} aria-label="edit profile">
                <EditIcon size={16} />
              </button>
            )}
          </div>
        )}

        <div className="hero">
          {editing ? (
            <input
              className="edit-name"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              maxLength={32}
              placeholder="your name"
            />
          ) : (
            <h2>{profile.name}</h2>
          )}

          {(editing || hasStatus) && (
            <div className="status">
              {editing ? (
                <>
                  <div className="emoji-wrap">
                    <button
                      className={`emoji-btn${statusEmoji ? '' : ' empty'}`}
                      onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                      type="button"
                      aria-label="set status emoji"
                    >
                      {statusEmoji || <FaceSmileIcon size={16} />}
                    </button>
                    {showEmojiPicker && (
                      <EmojiPicker
                        onSelect={(e) => { setStatusEmoji(e); setShowEmojiPicker(false); }}
                        onClose={() => setShowEmojiPicker(false)}
                      />
                    )}
                  </div>
                  <input
                    className="status-input"
                    value={statusText}
                    onChange={(e) => setStatusText(e.target.value)}
                    maxLength={30}
                    placeholder="set a status..."
                  />
                  {(statusEmoji || statusText) && (
                    <button
                      className="status-clear"
                      type="button"
                      aria-label="clear status"
                      onClick={() => { setStatusEmoji(''); setStatusText(''); }}
                    >
                      <XIcon size={10} />
                    </button>
                  )}
                </>
              ) : (
                <>
                  {profile.status_emoji && <span className="emoji">{profile.status_emoji}</span>}
                  {profile.status_text && <span className="text">{profile.status_text}</span>}
                </>
              )}
            </div>
          )}

          {(editing || hasMeta) && (
            <div className="meta">
              {(editing || profile.location) && (
                <div className="meta-field">
                  <LocationIcon size={12} />
                  {editing ? (
                    <input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={100} placeholder="location" />
                  ) : (
                    <span>{profile.location}</span>
                  )}
                </div>
              )}
              {(editing || (profile.location && profile.link)) && <span className="meta-dot">·</span>}
              {(editing || profile.link) && (
                <div className="meta-field">
                  <GlobalLinkIcon size={12} />
                  {editing ? (
                    <input value={link} onChange={(e) => setLink(e.target.value)} maxLength={256} placeholder="https://yoursite.com" />
                  ) : (
                    <a href={profile.link} target="_blank" rel="noopener noreferrer">
                      {profile.link?.replace(/^https?:\/\//, '')}
                    </a>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="body">
          {(editing || hasBio) && (
            <div className="section">
              {editing ? (
                <div className="bio-wrap">
                  <textarea
                    ref={bioRef}
                    className="bio-edit"
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    maxLength={200}
                    placeholder="tell us about yourself"
                  />
                  <span className="bio-counter">{bio.length}/200</span>
                </div>
              ) : (
                <div className="bio-text">{profile.bio}</div>
              )}
            </div>
          )}

          {(editing || hasConnections) && (
            <div className="section">
              {editing ? (
                <div className="socials-edit">
                  {activePlatforms.map(({ key, label, Icon }) => (
                    <div key={key} className="social-pill">
                      <Icon size={14} />
                      <input
                        placeholder={label}
                        value={connections[key] || ''}
                        maxLength={64}
                        onChange={(e) => setConnections({ ...connections, [key]: e.target.value })}
                      />
                      <button
                        className="social-remove"
                        type="button"
                        aria-label="remove social link"
                        onClick={() => {
                          const next = { ...connections };
                          delete next[key];
                          setConnections(next);
                        }}
                      >
                        <XIcon size={10} />
                      </button>
                    </div>
                  ))}
                  {availablePlatforms.length > 0 && (
                    <div className="social-add-wrap" ref={socialPickerRef}>
                      <button
                        className="social-add-btn"
                        type="button"
                        onClick={() => setSocialPickerOpen(!socialPickerOpen)}
                      >
                        <PlusIcon size={14} />
                        <span>add social</span>
                      </button>
                      {socialPickerOpen && (
                        <div className="social-picker">
                          {availablePlatforms.map(({ key, label, Icon }) => (
                            <button
                              key={key}
                              className="social-picker-item"
                              type="button"
                              onClick={() => {
                                setConnections({ ...connections, [key]: '' });
                                setSocialPickerOpen(false);
                              }}
                            >
                              <Icon size={14} />
                              <span>{label}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="connections-grid">
                  {activeConnections.map(([key, val]) => {
                    const platform = PLATFORMS.find((p) => p.key === key);
                    if (!platform) return null;
                    return (
                      <a
                        key={key}
                        className={`badge ${key}`}
                        href={`${platform.url}${val}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <platform.Icon size={14} />
                        <span>{val as string}</span>
                      </a>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {!isOwnProfile && (
            <div className="actions">
              {friendship ? (
                <>
                  <button className="btn btn-primary" onClick={handleMessage}>message</button>
                  <button className="btn btn-danger" onClick={handleRemoveFriend}>remove friend</button>
                </>
              ) : (
                <button className="btn btn-primary" onClick={handleAddFriend}>add friend</button>
              )}
            </div>
          )}
        </div>

        {profile.created_at && (
          <div className="profile-footer">
            user #{profile.user_number ?? '—'} · est. {formatShortDate(profile.created_at)}
          </div>
        )}
        </div>

    </Modal>
  );
}
