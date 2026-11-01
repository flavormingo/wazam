import { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/auth';
import { useClubsStore } from '../stores/clubs';
import './LoginPage.css';

export function InvitePage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const user = useAuthStore((s) => s.user);
  const [invite, setInvite] = useState<any>(null);
  const [error, setError] = useState('');
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (code) {
      api.getInviteInfo(code).then(setInvite).catch((e) => setError(e.message));
    }
  }, [code]);

  useEffect(() => {
    if (params.get('profile_setup') === '1') localStorage.setItem('needs_profile_setup', 'true');
  }, [params]);

  const toLogin = (signup?: boolean) => {
    const next = encodeURIComponent(`/invite/${code}`);
    navigate(`/login?${signup ? 'mode=signup&' : ''}next=${next}`);
  };

  const handleJoin = async () => {
    if (!code) return;
    if (!user) {
      toLogin();
      return;
    }
    setJoining(true);
    try {
      const result = await api.acceptInvite(code);
      await useClubsStore.getState().fetchClubs();
      const clubs = useClubsStore.getState().clubs;
      const joined = clubs.find((c: any) => c.id === result.club.id);
      navigate(`/club/${joined?.slug || result.club.id}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setJoining(false);
    }
  };

  if (error) {
    return (
      <div className="login-page">
        <div className="card">
          <h1 className="logo">wazup</h1>
          <div className="verify">
            <p style={{ color: 'var(--fg-danger)' }}>{error}</p>
          </div>
          <button className="btn btn-primary submit" onClick={() => navigate('/')}>go home</button>
        </div>
      </div>
    );
  }

  if (!invite) {
    return (
      <div className="login-page">
        <div className="loading-spinner" />
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="card">
        <h1 className="logo">wazup</h1>
        <div className="verify">
          <p>you've been invited to join</p>
          <h2 style={{ fontSize: '1.5rem', marginBottom: 'var(--space-sm)' }}>{invite.club.name}</h2>
          <p style={{ color: 'var(--fg-2)' }}>
            {invite.club.member_count} member{invite.club.member_count !== 1 ? 's' : ''}
          </p>
        </div>
        <button className="btn btn-primary submit" onClick={handleJoin} disabled={joining} style={{ width: '100%', marginTop: 'var(--space-lg)' }}>
          {joining ? 'joining...' : user ? 'accept invite' : 'log in to join'}
        </button>
        {!user && (
          <button className="back" onClick={() => toLogin(true)}>new here? sign up</button>
        )}
      </div>
    </div>
  );
}
