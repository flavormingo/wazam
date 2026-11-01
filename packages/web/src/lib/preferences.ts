export type TimeFormat = '12h' | '24h';
export type FriendPrivacy = 'everyone' | 'friends-of-friends' | 'club-members';

export function getTimeFormat(): TimeFormat {
  return (localStorage.getItem('timeFormat') as TimeFormat) || '12h';
}

export function setTimeFormat(format: TimeFormat) {
  localStorage.setItem('timeFormat', format);
}

export function getHighContrast(): boolean {
  return localStorage.getItem('highContrast') === 'true';
}

export function setHighContrast(on: boolean) {
  localStorage.setItem('highContrast', String(on));
  if (on) {
    document.documentElement.setAttribute('data-high-contrast', 'true');
  } else {
    document.documentElement.removeAttribute('data-high-contrast');
  }
}

export function getTourSeen(): boolean {
  return localStorage.getItem('tourSeen') === 'true';
}

export function setTourSeen(seen: boolean) {
  localStorage.setItem('tourSeen', String(seen));
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'auto' : 'smooth';
}

export function initPreferences() {
  if (getHighContrast()) {
    document.documentElement.setAttribute('data-high-contrast', 'true');
  }
}
