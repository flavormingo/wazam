import { useState, useRef, useEffect } from 'react';
import { useOutsideClose } from '../hooks/useOutsideClose';
import { isPushSupported, isPushEnabled, permissionState, needsInstall, enablePush, disablePush } from '../lib/push';
import { useAuthStore } from '../stores/auth';
import { authClient } from '../lib/authClient';
import { api } from '../lib/api';
import type { NotifPrefs } from '../lib/api';
import { THEMES, getTheme, setTheme } from '../lib/themes';
import {
  getTimeFormat, setTimeFormat, type TimeFormat,
  type FriendPrivacy,
  getHighContrast, setHighContrast,
} from '../lib/preferences';
import { XIcon, SignOutIcon, ChevronDownIcon } from './icons';
import { Modal } from './Modal';
import { startTour } from '../stores/tour';
import './SettingsModal.css';

interface DropdownOption<T extends string> {
  value: T;
  label: string;
}

function Dropdown<T extends string>({ value, options, onChange }: {
  value: T;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  useOutsideClose(ref, () => setOpen(false), open);

  return (
    <div className={`dropdown ${open ? 'open' : ''}`} ref={ref}>
      <button className="trigger" onClick={() => setOpen(!open)}>
        <span>{selected?.label}</span>
        <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
          <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div className="menu">
          {options.map((o) => (
            <button
              key={o.value}
              className={`item ${o.value === value ? 'active' : ''}`}
              onClick={() => { onChange(o.value); setOpen(false); }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type Tab = 'account' | 'chat' | 'notifications' | 'style' | 'yikes';

const TABS: Tab[] = ['account', 'chat', 'notifications', 'style', 'yikes'];

interface Props {
  onClose: () => void;
}

export function SettingsModal({ onClose }: Props) {
  const { logout } = useAuthStore();
  const [tab, setTab] = useState<Tab>('account');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useOutsideClose(menuRef, () => setMenuOpen(false), menuOpen);

  const handleLogout = async () => {
    await logout();
  };

  return (
    <Modal onClose={onClose} label="settings" className="settings" bare>
      <div className="sidebar" role="tablist">
          <div className="title overline">settings</div>
          {TABS.map((t) => (
            <button
              key={t}
              className="tab"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
          <div className="divider" />
          <button className="tab danger" onClick={handleLogout}>
            <SignOutIcon size={16} /> log out
          </button>
        </div>
        <div className="content">
          <div className="header">
            <h2>{tab}</h2>
            <div className="tab-nav-wrap" ref={menuRef}>
              <button className="tab-nav" onClick={() => setMenuOpen((o) => !o)} aria-haspopup="true" aria-expanded={menuOpen}>
                <span>{tab}</span>
                <ChevronDownIcon size={16} />
              </button>
              {menuOpen && (
                <div className="tab-menu" role="menu">
                  {TABS.map((t) => (
                    <button
                      key={t}
                      className={`tab-menu-item ${tab === t ? 'active' : ''}`}
                      role="menuitem"
                      onClick={() => { setTab(t); setMenuOpen(false); }}
                    >
                      {t}
                    </button>
                  ))}
                  <div className="tab-menu-sep" />
                  <button className="tab-menu-item danger" role="menuitem" onClick={handleLogout}>
                    <SignOutIcon size={16} /> log out
                  </button>
                </div>
              )}
            </div>
            <button className="modal-close" onClick={onClose} aria-label="close">
              <XIcon size={18} />
            </button>
          </div>
          {tab === 'account' && <AccountTab />}
          {tab === 'chat' && <ChatTab onClose={onClose} />}
          {tab === 'notifications' && <NotificationsTab />}
          {tab === 'style' && <StyleTab />}
          {tab === 'yikes' && <YikesTab />}
        </div>
    </Modal>
  );
}

function AccountTab() {
  const user = useAuthStore((s) => s.user);
  const updateProfile = useAuthStore((s) => s.updateProfile);

  const [newEmail, setNewEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [emailSuccess, setEmailSuccess] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);

  const [friendPrivacy, setFriendPrivacyState] = useState<FriendPrivacy>((user?.friend_privacy as FriendPrivacy) || 'everyone');

  const [showDelete, setShowDelete] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);

  const handleChangeEmail = async () => {
    setEmailError('');
    setEmailSuccess('');
    if (!newEmail.trim()) return;
    setEmailLoading(true);
    try {
      const { error } = await authClient.changeEmail({ newEmail: newEmail.trim() });
      if (error) { setEmailError(error.message || 'failed to change email'); return; }
      setEmailSuccess('check your new email to confirm');
      setNewEmail('');
    } catch (err: any) {
      setEmailError(err.message || 'failed to change email');
    } finally {
      setEmailLoading(false);
    }
  };

  const handleChangePassword = async () => {
    setPasswordError('');
    setPasswordSuccess('');
    if (!currentPassword) { setPasswordError('enter your current password'); return; }
    if (!newPassword) { setPasswordError('enter a new password'); return; }
    if (newPassword.length < 8) { setPasswordError('must be at least 8 characters'); return; }
    if (newPassword !== confirmPassword) { setPasswordError('passwords do not match'); return; }
    setPasswordLoading(true);
    try {
      const { error } = await authClient.changePassword({ currentPassword, newPassword });
      if (error) { setPasswordError(error.message || 'failed to change password'); return; }
      setPasswordSuccess('password changed');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setPasswordError(err.message || 'failed to change password');
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleDeleteAccount = async () => {
    setDeleteError('');
    if (!deletePassword) { setDeleteError('enter your password'); return; }
    setDeleteLoading(true);
    try {
      const { error } = await authClient.deleteUser({ password: deletePassword });
      if (error) { setDeleteError(error.message || 'failed to delete account'); return; }
      window.location.reload();
    } catch (err: any) {
      setDeleteError(err.message || 'failed to delete account');
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleFriendPrivacyChange = (value: FriendPrivacy) => {
    setFriendPrivacyState(value);
    updateProfile({ friend_privacy: value }).catch(() => {});
  };

  return (
    <>
      <div className="section">
        <div className="title overline">email</div>
        <div className="field-value">{user?.email}</div>
        <div className="row">
          <input
            className="input"
            type="email"
            placeholder="new email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleChangeEmail()}
          />
          <button
            className="btn btn-primary"
            onClick={handleChangeEmail}
            disabled={emailLoading || !newEmail.trim()}
          >
            {emailLoading ? 'saving...' : 'save'}
          </button>
        </div>
        {emailError && <div className="error">{emailError}</div>}
        {emailSuccess && <div className="success">{emailSuccess}</div>}
      </div>

      <div className="section">
        <div className="title overline">password</div>
        <div className="stack">
          <input
            className="input"
            type="password"
            placeholder="current password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
          <input
            className="input"
            type="password"
            placeholder="new password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <div className="row">
            <input
              className="input"
              type="password"
              placeholder="confirm new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleChangePassword()}
            />
            <button
              className="btn btn-primary"
              onClick={handleChangePassword}
              disabled={passwordLoading || !currentPassword || !newPassword || !confirmPassword}
            >
              {passwordLoading ? 'saving...' : 'save'}
            </button>
          </div>
        </div>
        {passwordError && <div className="error">{passwordError}</div>}
        {passwordSuccess && <div className="success">{passwordSuccess}</div>}
      </div>

      <div className="section">
        <div className="title overline">friend requests</div>
        <Dropdown
          value={friendPrivacy}
          options={[
            { value: 'everyone', label: 'everyone' },
            { value: 'friends-of-friends', label: 'friends of friends' },
            { value: 'club-members', label: 'club members' },
          ]}
          onChange={handleFriendPrivacyChange}
        />
      </div>

      <div className="section">
        <div className="danger-zone">
          <div className="title overline">delete account</div>
          {!showDelete ? (
            <button
              className="btn btn-danger"
              onClick={() => setShowDelete(true)}
            >
              delete my account
            </button>
          ) : (
            <>
              <div className="error" style={{ marginBottom: 8 }}>this is permanent. all your data will be deleted.</div>
              <div className="row">
                <input
                  className="input"
                  type="password"
                  placeholder="enter your password to confirm"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleDeleteAccount()}
                />
                <button className="btn btn-ghost" onClick={() => setShowDelete(false)}>
                  cancel
                </button>
                <button
                  className="btn btn-danger"
                  onClick={handleDeleteAccount}
                  disabled={deleteLoading || !deletePassword}
                >
                  {deleteLoading ? 'deleting...' : 'confirm'}
                </button>
              </div>
              {deleteError && <div className="error">{deleteError}</div>}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function NotificationPrefs() {
  const [prefs, setPrefs] = useState<NotifPrefs | null>(null);
  useEffect(() => { api.getPrefs().then(setPrefs).catch(() => {}); }, []);
  if (!prefs) return null;

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const save = (patch: Partial<NotifPrefs>) => {
    const next = { ...prefs, ...patch } as NotifPrefs;
    setPrefs(next);
    api.savePrefs({
      mode: next.mode,
      dnd_until: next.dnd_until,
      quiet_start: next.quiet_start,
      quiet_end: next.quiet_end,
      quiet_tz: next.quiet_tz,
    }).catch(() => {});
  };

  const dndActive = !!prefs.dnd_until && new Date(prefs.dnd_until) > new Date();
  const quietOn = prefs.quiet_start != null && prefs.quiet_end != null;
  const toHM = (mins: number | null) => {
    const v = mins ?? 0;
    return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
  };
  const setQuiet = (which: 'start' | 'end', hm: string) => {
    const [h, m] = hm.split(':').map(Number);
    const v = h * 60 + m;
    save(which === 'start' ? { quiet_start: v, quiet_tz: tz } : { quiet_end: v, quiet_tz: tz });
  };
  const snooze = (mins: number) => save({ dnd_until: new Date(Date.now() + mins * 60000).toISOString() });

  return (
    <>
      <div className="section">
        <div className="title overline">notify me for</div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button className={`btn ${prefs.mode === 'all' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => save({ mode: 'all' })}>all messages</button>
          <button className={`btn ${prefs.mode === 'mentions' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => save({ mode: 'mentions' })}>direct messages and mentions</button>
        </div>
      </div>

      <div className="section">
        <div className="title overline">pause</div>
        {dndActive ? (
          <div className="field">
            <span className="label">paused until {new Date(prefs.dnd_until!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            <button className="btn btn-ghost" onClick={() => save({ dnd_until: null })}>resume</button>
          </div>
        ) : (
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {([['30 min', 30], ['1 hour', 60], ['4 hours', 240], ['8 hours', 480], ['12 hours', 720], ['24 hours', 1440]] as [string, number][]).map(([label, mins]) => (
              <button key={mins} className="btn btn-ghost" onClick={() => snooze(mins)}>{label}</button>
            ))}
          </div>
        )}
      </div>

      <div className="section">
        <div className="field" style={{ borderBottom: 'none' }}>
          <span className="label">quiet hours</span>
          <button
            className={`toggle ${quietOn ? 'on' : ''}`}
            onClick={() => (quietOn ? save({ quiet_start: null, quiet_end: null }) : save({ quiet_start: 22 * 60, quiet_end: 8 * 60, quiet_tz: tz }))}
            aria-pressed={quietOn}
            aria-label="quiet hours"
          />
        </div>
        {quietOn && (
          <div className="row">
            <input className="input" type="time" value={toHM(prefs.quiet_start)} onChange={(e) => setQuiet('start', e.target.value)} aria-label="quiet hours start" />
            <input className="input" type="time" value={toHM(prefs.quiet_end)} onChange={(e) => setQuiet('end', e.target.value)} aria-label="quiet hours end" />
          </div>
        )}
      </div>
    </>
  );
}

function NotificationsSection() {
  const [state, setState] = useState<'loading' | 'on' | 'off' | 'denied' | 'unsupported' | 'needs-install'>('loading');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!isPushSupported()) { if (alive) setState('unsupported'); return; }
      if (needsInstall()) { if (alive) setState('needs-install'); return; }
      if (permissionState() === 'denied') { if (alive) setState('denied'); return; }
      const on = await isPushEnabled();
      if (alive) setState(on ? 'on' : 'off');
    })();
    return () => { alive = false; };
  }, []);

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      if (state === 'on') {
        await disablePush();
        setState('off');
      } else {
        const r = await enablePush();
        if (r === 'enabled') setState('on');
        else if (r === 'needs-install') setState('needs-install');
        else if (r === 'unsupported') setState('unsupported');
        else setState('denied');
      }
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="section">
        <div className="title overline">push notifications</div>
        {state === 'unsupported' && <div className="coming-soon">not supported in this browser</div>}
        {state === 'needs-install' && (
          <div className="field-value">add wazup to your home screen (Share → Add to Home Screen), then open it from the icon to turn on notifications</div>
        )}
        {state === 'denied' && (
          <div className="field-value">notifications are blocked — enable them for wazup in your browser or OS settings, then reload</div>
        )}
        {(state === 'loading' || state === 'on' || state === 'off') && (
          <div className="field">
            <span className="label">on this device</span>
            <button
              className={`toggle ${state === 'on' ? 'on' : ''}`}
              onClick={toggle}
              disabled={busy || state === 'loading'}
              aria-pressed={state === 'on'}
              aria-label="push notifications"
            />
          </div>
        )}
        {err && <div className="error">{err}</div>}
      </div>
      {state === 'on' && <NotificationPrefs />}
    </>
  );
}

function NotificationsTab() {
  return <NotificationsSection />;
}

function ChatTab({ onClose }: { onClose: () => void }) {
  const [timeFormat, setTimeFormatState] = useState<TimeFormat>(getTimeFormat());

  const handleTimeFormat = (format: TimeFormat) => {
    setTimeFormatState(format);
    setTimeFormat(format);
  };

  return (
    <>
      <div className="section">
        <div className="title overline">language</div>
        <Dropdown
          value="en"
          options={[{ value: 'en', label: 'english' }]}
          onChange={() => {}}
        />
      </div>

      <div className="section">
        <div className="title overline">time format</div>
        <Dropdown
          value={timeFormat}
          options={[
            { value: '12h', label: '12-hour' },
            { value: '24h', label: '24-hour' },
          ]}
          onChange={handleTimeFormat}
        />
      </div>

      <div className="section">
        <div className="title overline">welcome tour</div>
        <div className="field">
          <span className="label">take valentino's tour again</span>
          <button className="btn btn-ghost btn-sm" onClick={() => { onClose(); startTour(); }}>replay</button>
        </div>
      </div>
    </>
  );
}

function StyleTab() {
  const [currentTheme, setCurrentTheme] = useState(getTheme());
  const [highContrast, setHighContrastState] = useState(getHighContrast());

  const handleThemeSelect = (name: string) => {
    setCurrentTheme(name);
    setTheme(name);
  };

  const handleHighContrast = () => {
    const next = !highContrast;
    setHighContrastState(next);
    setHighContrast(next);
  };

  return (
    <>
      <div className="section">
        <div className="title overline">theme</div>
        <div className="theme-grid">
          {THEMES.map((t) => (
            <button
              key={t.name}
              className={`card ${currentTheme === t.name ? 'active' : ''}`}
              onClick={() => handleThemeSelect(t.name)}
            >
              <div className="swatch" style={{ background: t.gradient }} />
              <span className="label">{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="section">
        <div className="title overline">app icon</div>
        <div className="coming-soon">coming soon</div>
      </div>

      <div className="section">
        <div className="title overline">accessibility</div>
        <div className="field">
          <span className="label">high contrast</span>
          <button
            className={`toggle ${highContrast ? 'on' : ''}`}
            onClick={handleHighContrast}
            aria-label="high contrast"
            aria-pressed={highContrast}
          />
        </div>
      </div>
    </>
  );
}

function YikesTab() {
  const [bugText, setBugText] = useState('');
  const [bugStatus, setBugStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [bugError, setBugError] = useState('');

  const [actorText, setActorText] = useState('');
  const [actorStatus, setActorStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [actorError, setActorError] = useState('');

  const handleBugReport = async () => {
    if (!bugText.trim()) return;
    setBugStatus('sending');
    setBugError('');
    try {
      await api.sendReport({ type: 'bug', message: bugText.trim() });
      setBugStatus('sent');
      setBugText('');
    } catch (err: any) {
      setBugStatus('error');
      setBugError(err.message || 'failed to send report');
    }
  };

  const handleActorReport = async () => {
    if (!actorText.trim()) return;
    setActorStatus('sending');
    setActorError('');
    try {
      await api.sendReport({ type: 'actor', message: actorText.trim() });
      setActorStatus('sent');
      setActorText('');
    } catch (err: any) {
      setActorStatus('error');
      setActorError(err.message || 'failed to send report');
    }
  };

  return (
    <>
      <div className="section">
        <div className="title overline">report a bug</div>
        <textarea
          placeholder="describe the bug..."
          value={bugText}
          onChange={(e) => setBugText(e.target.value)}
        />
        <div className="actions">
          {bugStatus === 'sent' && <span className="success">sent!</span>}
          {bugStatus === 'error' && <span className="error">{bugError}</span>}
          <button
            className="btn btn-primary"
            onClick={handleBugReport}
            disabled={bugStatus === 'sending' || !bugText.trim()}
          >
            {bugStatus === 'sending' ? 'sending...' : 'send'}
          </button>
        </div>
      </div>

      <div className="section">
        <div className="title overline">report a bad actor</div>
        <textarea
          placeholder="describe the situation..."
          value={actorText}
          onChange={(e) => setActorText(e.target.value)}
        />
        <div className="actions">
          {actorStatus === 'sent' && <span className="success">sent!</span>}
          {actorStatus === 'error' && <span className="error">{actorError}</span>}
          <button
            className="btn btn-primary"
            onClick={handleActorReport}
            disabled={actorStatus === 'sending' || !actorText.trim()}
          >
            {actorStatus === 'sending' ? 'sending...' : 'send'}
          </button>
        </div>
      </div>
    </>
  );
}
