import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { VALENTINO_ID } from '@wazup/shared';
import { useTourStore } from '../stores/tour';
import { useDmsStore } from '../stores/dms';
import { setTourSeen } from '../lib/preferences';
import { Valentino } from './Valentino';
import './TourOverlay.css';

interface Step {
  key: string;
  target?: string;
  side?: 'right';
  title?: string;
  body: string;
  cta?: string;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface Spot {
  key: string;
  rect: Rect;
  round: boolean;
}

type Side = 'center' | 'right' | 'below' | 'above';

const INSET = 4;
const MARGIN = 16;
const GAP = 14;
const RING_MAX = 64;
const TAIL_MIN = 22;

const STEPS: Step[] = [
  { key: 'intro', title: 'welcome!', body: "hi! i'm valentino, your first friend on wazup. let me give you a quick tour", cta: 'show me around' },
  { key: 'clubs', target: 'create-club', side: 'right', body: 'clubs are little hangouts for your people. tap the + to create your own' },
  { key: 'home', target: 'home', side: 'right', body: 'this bubble is home base. you can directly call and message your friends here' },
  { key: 'friends', target: 'friends', body: 'add friends by name up here. you can message and call them or invite them to a club once they accept' },
  { key: 'profile', target: 'profile', body: 'tap your profile to make it yours. photo, name, status and more' },
  { key: 'settings', target: 'settings', body: 'you can mess with themes, notifications and plenty of other settings here' },
  { key: 'valentino-dm', target: 'valentino-message', body: 'i already slid in your dms 😼' },
  { key: 'composer', target: 'composer', body: 'just write your messages here. you can say hi to me any time' },
  { key: 'outro', title: "that's all", body: 'you can always take the tour again from settings. make yourself at home and have fun ✌️', cta: 'peace' },
];

const COACH_STEPS = STEPS.filter((s) => s.target);
const DM_STEP_KEYS = new Set(['valentino-dm', 'composer']);
const TOTAL = STEPS.length;

function findValentinoRoute(): string | null {
  const dm = useDmsStore
    .getState()
    .channels.find((c: any) => c.type === 'direct' && c.members?.some((m: any) => m.id === VALENTINO_ID));
  return dm ? `/dm/${dm.id}` : null;
}

function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), Math.max(min, max));
}

function spotFor(key: string, r: DOMRect, vw: number, vh: number): Spot {
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const size = Math.max(r.width, r.height);
  if (size <= RING_MAX) {
    const fit = Math.min(size + 16, 2 * (cx - INSET), 2 * (vw - INSET - cx), 2 * (cy - INSET), 2 * (vh - INSET - cy));
    const d = Math.max(size, fit);
    return { key, rect: { top: cy - d / 2, left: cx - d / 2, width: d, height: d }, round: true };
  }
  const left = Math.max(INSET, r.left - 8);
  const top = Math.max(INSET, r.top - 8);
  const right = Math.min(vw - INSET, r.right + 8);
  const bottom = Math.min(vh - INSET, r.bottom + 8);
  return { key, rect: { top, left, width: right - left, height: bottom - top }, round: false };
}

function placeCard(spot: Rect | null, prefer: Step['side'], w: number, h: number, vw: number, vh: number) {
  if (!spot) {
    return { side: 'center' as Side, left: (vw - w) / 2, top: Math.max(MARGIN, (vh - h) / 2), tail: 0 };
  }
  const spotRight = spot.left + spot.width;
  const midY = spot.top + spot.height / 2;
  if (prefer === 'right' && spotRight + GAP + w + MARGIN <= vw) {
    const top = clamp(midY - h / 2, MARGIN, vh - MARGIN - h);
    return { side: 'right' as Side, left: spotRight + GAP, top, tail: clamp(midY - top, TAIL_MIN, h - TAIL_MIN) };
  }
  const below = midY < vh / 2;
  const top = clamp(below ? spot.top + spot.height + GAP : spot.top - GAP - h, MARGIN, vh - MARGIN - h);
  const left = clamp(spot.left + spot.width / 2 - w / 2, MARGIN, vw - MARGIN - w);
  const tail = clamp(spot.left + spot.width / 2 - left, TAIL_MIN, w - TAIL_MIN);
  return { side: (below ? 'below' : 'above') as Side, left, top, tail };
}

export function TourOverlay() {
  const active = useTourStore((s) => s.active);
  return active ? <Tour /> : null;
}

function Tour() {
  const stepIndex = useTourStore((s) => s.stepIndex);
  const next = useTourStore((s) => s.next);
  const prev = useTourStore((s) => s.prev);
  const finish = useTourStore((s) => s.finish);
  const navigate = useNavigate();
  const [spot, setSpot] = useState<Spot | null>(null);
  const [viewport, setViewport] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const [card, setCard] = useState({ w: 0, h: 0 });
  const [placed, setPlaced] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);

  const step = STEPS[stepIndex];
  const coachIndex = step ? COACH_STEPS.indexOf(step) : -1;

  const done = useCallback(() => {
    setTourSeen(true);
    finish();
  }, [finish]);

  const advance = useCallback(() => {
    if (stepIndex >= TOTAL - 1) done();
    else next();
  }, [stepIndex, next, done]);

  const measure = useCallback(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    setViewport((v) => (v.w === vw && v.h === vh ? v : { w: vw, h: vh }));
    const s = STEPS[stepIndex];
    if (!s?.target) return;
    const el = document.querySelector<HTMLElement>(`[data-tour="${s.target}"]`);
    const r = el?.getBoundingClientRect();
    if (r && (r.width > 0 || r.height > 0)) setSpot(spotFor(s.key, r, vw, vh));
  }, [stepIndex]);

  useEffect(() => {
    const s = STEPS[stepIndex];
    if (!s) {
      done();
      return;
    }
    if (DM_STEP_KEYS.has(s.key)) {
      const route = findValentinoRoute();
      if (!route) {
        advance();
        return;
      }
      if (s.key === 'valentino-dm') navigate(route);
    }
    if (!s.target) {
      setSpot(null);
      return;
    }
    let cancelled = false;
    let raf = 0;
    let tries = 0;
    const tick = () => {
      if (cancelled) return;
      const el = document.querySelector<HTMLElement>(`[data-tour="${s.target}"]`);
      const r = el?.getBoundingClientRect();
      if (el && r && (r.width > 0 || r.height > 0)) {
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        setSpot(spotFor(s.key, el.getBoundingClientRect(), window.innerWidth, window.innerHeight));
        return;
      }
      if (++tries > 180) {
        advance();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [stepIndex, advance, done, navigate]);

  useEffect(() => {
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [measure]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') done();
      else if (e.key === 'ArrowRight') advance();
      else if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [advance, prev, done]);

  useEffect(() => {
    const app = document.querySelector('.main-layout');
    const restore = document.activeElement as HTMLElement | null;
    app?.setAttribute('inert', '');
    return () => {
      app?.removeAttribute('inert');
      restore?.focus?.();
    };
  }, []);

  useEffect(() => {
    primaryRef.current?.focus();
  }, [stepIndex]);

  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    setCard((c) => (c.w === w && c.h === h ? c : { w, h }));
  }, [stepIndex, spot, viewport]);

  useEffect(() => {
    if (placed || !card.h) return;
    const raf = requestAnimationFrame(() => setPlaced(true));
    return () => cancelAnimationFrame(raf);
  }, [placed, card.h]);

  if (!step) return null;

  const waiting = !!step.target && spot?.key !== step.key;
  const target = step.target ? spot : null;
  const place = placeCard(target?.rect ?? null, step.side, card.w, card.h, viewport.w, viewport.h);
  const spotRect = target?.rect ?? { top: viewport.h / 2, left: viewport.w / 2, width: 0, height: 0 };

  return createPortal(
    <div className="tour" role="dialog" aria-modal="true" aria-label="welcome tour">
      <div className="scrim" />
      <div
        className="spotlight"
        data-shape={target ? (target.round ? 'ring' : 'box') : 'none'}
        style={spotRect}
      />
      <div
        ref={cardRef}
        className="card"
        data-side={place.side}
        data-placed={placed ? '' : undefined}
        data-waiting={waiting ? '' : undefined}
        aria-live="polite"
        style={{ top: place.top, left: place.left, '--tail': `${place.tail}px` } as React.CSSProperties}
      >
        {step.target ? (
          <div className="coach">
            <span key={`avatar-${step.key}`} className="avatar"><Valentino size={36} /></span>
            <header>
              <span className="name">valentino</span>
              <button className="btn btn-secondary btn-sm" onClick={done}>skip</button>
            </header>
            <p key={step.key}>{step.body}</p>
            <footer>
              <span
                className="progress"
                role="progressbar"
                aria-label="tour progress"
                aria-valuemin={1}
                aria-valuemax={COACH_STEPS.length}
                aria-valuenow={coachIndex + 1}
              >
                {COACH_STEPS.map((s, i) => (
                  <span key={s.key} data-state={i < coachIndex ? 'done' : i === coachIndex ? 'current' : undefined} />
                ))}
              </span>
              <button className="btn btn-ghost" onClick={prev}>back</button>
              <button ref={primaryRef} className="btn btn-primary" onClick={advance}>next</button>
            </footer>
          </div>
        ) : (
          <div className="hero" key={step.key}>
            <span className="avatar"><Valentino size={72} /></span>
            <h2>{step.title}</h2>
            <p>{step.body}</p>
            <footer>
              {stepIndex === 0 && <button className="btn btn-secondary" onClick={done}>skip</button>}
              <button ref={primaryRef} className="btn btn-primary" onClick={advance}>{step.cta}</button>
            </footer>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
