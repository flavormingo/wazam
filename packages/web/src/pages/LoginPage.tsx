import { useState, useEffect, type CSSProperties } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { authClient } from '../lib/authClient';
import { useAuthStore } from '../stores/auth';
import { cycleFlavor } from '../lib/themes';
import { randomFact } from '../lib/facts';
import { toast } from '../stores/toast';
import './LoginPage.css';

type Mode = 'login' | 'signup' | 'verify' | 'forgot' | 'forgot-sent';

function buildStream(W: number, H: number) {
  const rad = (-24 * Math.PI) / 180;
  const ux = Math.cos(rad);
  const uy = Math.sin(rad);
  const px = -uy;
  const py = ux;
  const LEAP = 7;
  const TARGET = 9;

  const du = Math.max(150, Math.sqrt((W * H * 1.15) / TARGET));
  const dv = du / 1.15;
  const bigSize = du * 0.47;
  const smallSize = du * 0.33;
  const margin = bigSize * 1.35;

  const uc = [0, W * ux, H * uy, W * ux + H * uy];
  const pc = [0, W * px, H * py, W * px + H * py];
  const uMin = Math.min(...uc);
  const uMax = Math.max(...uc);
  const pMin = Math.min(...pc);
  const pMax = Math.max(...pc);

  const START_U = uMin - margin;
  const M = uMax + margin - START_U;
  const STEP = du * 0.42;
  const N = Math.max(6, Math.ceil(M / STEP));
  const CYCLE = N * LEAP;

  const nLanes = Math.max(2, Math.ceil((pMax - pMin + 2 * margin) / dv));
  const nPhases = Math.max(3, Math.round(M / du));
  const COUNT = nLanes * nPhases;
  const pStart = pMin - margin;

  const travel = N * STEP;
  const flies: { x: number; y: number; size: number; big: boolean; delay: number; rx: number; ry: number }[] = [];
  let idx = 0;
  for (let L = 0; L < nLanes; L++) {
    const perp = pStart + L * dv;
    for (let p = 0; p < nPhases; p++) {
      const brick = (L % 2) * 0.5;
      const frac = ((p + brick) % nPhases) / nPhases;
      const subOffset = (((idx * 7) % COUNT) / COUNT) * LEAP;
      const rest = frac + subOffset / CYCLE;
      const big = (L + p) % 2 === 0;
      flies.push({
        x: START_U * ux + perp * px,
        y: START_U * uy + perp * py,
        size: big ? bigSize : smallSize,
        big,
        delay: -(frac * CYCLE + subOffset),
        rx: rest * travel * ux,
        ry: rest * travel * uy,
      });
      idx++;
    }
  }

  const seg = 100 / N;
  const frame = (d: number, sx: number, sy: number) =>
    `translate(${(d * ux).toFixed(1)}px, ${(d * uy).toFixed(1)}px) rotate(-24deg) scaleX(${sx}) scaleY(${sy})`;
  const rows: string[] = [];
  for (let kk = 1; kk <= N; kk++) {
    const s0 = (kk - 1) * seg;
    const prev = (kk - 1) * STEP;
    const d = kk * STEP;
    rows.push(`${s0.toFixed(2)}%{transform:${frame(prev, 1, 1)};animation-timing-function:cubic-bezier(.4,0,.7,1)}`);
    rows.push(`${(s0 + 0.08 * seg).toFixed(2)}%{transform:${frame(prev - 0.05 * STEP, 0.9, 1.06)};animation-timing-function:cubic-bezier(.18,.7,.3,1)}`);
    rows.push(`${(s0 + 0.2 * seg).toFixed(2)}%{transform:${frame(d + 0.05 * STEP, 1.08, 0.92)}}`);
    rows.push(`${(s0 + 0.3 * seg).toFixed(2)}%{transform:${frame(d, 1, 1)}}`);
  }
  rows.push(`100%{transform:${frame(N * STEP, 1, 1)}}`);

  return { flies, keyframes: `@keyframes fly-stream{${rows.join('')}}`, cycle: CYCLE };
}

function LoginFlies() {
  const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(t);
      t = setTimeout(() => setVp((prev) => (prev.w === window.innerWidth ? prev : { w: window.innerWidth, h: window.innerHeight })), 200);
    };
    window.addEventListener('resize', onResize);
    return () => { clearTimeout(t); window.removeEventListener('resize', onResize); };
  }, []);
  const { flies, keyframes, cycle } = buildStream(vp.w, vp.h);
  return (
    <div className="login-flies" aria-hidden="true">
      <style>{keyframes}</style>
      {flies.map((f, i) => (
        <span
          key={i}
          className={`fly ${f.big ? 'fly-lg' : 'fly-sm'}`}
          style={{ left: `${f.x.toFixed(1)}px`, top: `${f.y.toFixed(1)}px`, width: `${f.size.toFixed(1)}px`, '--delay': `${f.delay.toFixed(2)}s`, '--dur': `${cycle}s`, '--rx': `${f.rx.toFixed(1)}px`, '--ry': `${f.ry.toFixed(1)}px` } as CSSProperties}
        >
          <img src="/fly-static.svg" alt="" draggable={false} />
        </span>
      ))}
    </div>
  );
}

export function safeNext(value: string | null) {
  return value && /^\/(?![/\\])/.test(value) ? value : null;
}

export function LoginPage() {
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const verifyCallback = next ? `${next}${next.includes('?') ? '&' : '?'}profile_setup=1` : '/?profile_setup=1';
  const [mode, setMode] = useState<Mode>(params.get('mode') === 'signup' ? 'signup' : 'login');

  const handleLogo = (e: React.MouseEvent<HTMLHeadingElement>) => {
    cycleFlavor();
    toast.info(randomFact());
    const el = e.currentTarget;
    el.classList.remove('wiggling');
    void el.offsetWidth;
    el.classList.add('wiggling');
  };
  const [identifier, setIdentifier] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const navigate = useNavigate();
  const fetchUser = useAuthStore((s) => s.fetchUser);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (mode === 'signup') {
        const res = await authClient.signUp.email({
          email,
          password,
          username,
          name: username,
          callbackURL: verifyCallback,
        });
        if (res.error) {
          setError(res.error.message || 'signup failed');
          setLoading(false);
          return;
        }
        localStorage.setItem('needs_profile_setup', 'true');
        setMode('verify');
        setLoading(false);
        return;
      } else if (mode === 'forgot') {
        await fetch('/api/auth/request-password-reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: identifier, redirectTo: '/reset-password' }),
        });
        setMode('forgot-sent');
        setLoading(false);
        return;
      } else {
        const isEmail = identifier.includes('@');
        const res = isEmail
          ? await authClient.signIn.email({ email: identifier, password })
          : await authClient.signIn.username({ username: identifier, password });
        if (res.error) {
          if (res.error.code === 'EMAIL_NOT_VERIFIED') {
            if (isEmail) setEmail(identifier);
            setMode('verify');
            setLoading(false);
            return;
          }
          setError(res.error.message || 'login failed');
          setLoading(false);
          return;
        }
      }
      await fetchUser();
      navigate(next ?? '/', { replace: true });
    } catch (err: any) {
      setError(err.message || 'something went wrong');
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (!email) {
      setError('enter your email address above');
      return;
    }
    setResending(true);
    setResent(false);
    setError('');
    try {
      await authClient.sendVerificationEmail({
        email,
        callbackURL: verifyCallback,
      });
      setResent(true);
    } catch {
      setError('failed to resend verification email');
    } finally {
      setResending(false);
    }
  }

  if (mode === 'verify') {
    return (
      <div className="login-page">
        <LoginFlies />
        <div className="card">
          <h1 className="logo" onClick={handleLogo}>wazup</h1>
          <div className="verify">
            <h2>check your email</h2>
            {email ? (
              <p>
                we sent a verification link to <strong>{email}</strong>
              </p>
            ) : (
              <p>
                enter your email to resend the verification link.
              </p>
            )}
            <input
              type="email"
              placeholder="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setResent(false); }}
              autoComplete="email"
            />
            <button
              className="btn btn-primary submit resend"
              onClick={handleResend}
              disabled={resending}
            >
              {resending ? '...' : resent ? 'sent!' : 'resend verification email'}
            </button>
            {error && <div className="error">{error}</div>}
            <button
              className="back"
              onClick={() => { setMode('login'); setError(''); setResent(false); }}
            >
              back to login
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (mode === 'forgot-sent') {
    return (
      <div className="login-page">
        <LoginFlies />
        <div className="card">
          <h1 className="logo" onClick={handleLogo}>wazup</h1>
          <div className="verify">
            <h2>check your email</h2>
            <p>
              if an account exists for <strong>{identifier}</strong>, we sent a password reset link.
            </p>
            <button
              className="back"
              onClick={() => { setMode('login'); setError(''); }}
            >
              back to login
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <LoginFlies />
      <div className="card">
        <h1 className="logo" onClick={handleLogo}>wazup</h1>
        {mode !== 'forgot' && (
          <div className="tabs">
            <button
              className={`tab ${mode === 'login' ? 'active' : ''}`}
              onClick={() => { setMode('login'); setError(''); }}
            >
              log in
            </button>
            <button
              className={`tab ${mode === 'signup' ? 'active' : ''}`}
              onClick={() => { setMode('signup'); setError(''); }}
            >
              sign up
            </button>
          </div>
        )}
        <form onSubmit={handleSubmit}>
          {mode === 'login' && (
            <input
              type="text"
              placeholder="email or name"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
              autoComplete="username"
            />
          )}
          {mode === 'signup' && (
            <>
              <input
                type="text"
                placeholder="name"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoComplete="username"
              />
              <input
                type="email"
                placeholder="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </>
          )}
          {mode === 'forgot' && (
            <input
              type="email"
              placeholder="email"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
              autoComplete="email"
            />
          )}
          {mode !== 'forgot' && (
            <input
              type="password"
              placeholder="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              minLength={8}
            />
          )}
          {error && <div className="error">{error}</div>}
          <button type="submit" className="btn btn-primary submit" disabled={loading}>
            {loading
              ? '...'
              : mode === 'login'
                ? 'log in'
                : mode === 'signup'
                  ? 'sign up'
                  : 'send reset link'}
          </button>
          {mode === 'login' && (
            <button
              type="button"
              className="forgot"
              onClick={() => { setMode('forgot'); setError(''); }}
            >
              forgot password?
            </button>
          )}
          {mode === 'forgot' && (
            <button
              type="button"
              className="back"
              onClick={() => { setMode('login'); setError(''); }}
            >
              back to login
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
