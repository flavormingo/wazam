import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { authClient } from '../lib/authClient';
import './LoginPage.css';

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await authClient.resetPassword({
        newPassword: password,
        token,
      });
      if (res.error) {
        setError(res.error.message || 'reset failed');
        setLoading(false);
        return;
      }
      setDone(true);
    } catch (err: any) {
      setError(err.message || 'something went wrong');
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="login-page">
        <div className="card">
          <h1 className="logo">wazam</h1>
          <div className="verify">
            <p>invalid or missing reset token.</p>
            <button className="back" onClick={() => navigate('/login')}>
              back to login
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="login-page">
        <div className="card">
          <h1 className="logo">wazam</h1>
          <div className="verify">
            <h2>password reset</h2>
            <p>your password has been updated.</p>
            <button
              className="btn btn-primary submit"
              style={{ width: '100%', marginTop: '8px' }}
              onClick={() => navigate('/login')}
            >
              log in
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="card">
        <h1 className="logo">wazam</h1>
        <p className="desc">enter your new password.</p>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            placeholder="new password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="new-password"
            minLength={8}
          />
          {error && <div className="error">{error}</div>}
          <button type="submit" className="btn btn-primary submit" disabled={loading}>
            {loading ? '...' : 'reset password'}
          </button>
        </form>
      </div>
    </div>
  );
}
