import type { ApiDmCall } from './types.js';

export function formatCallDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

export function describeCall(call: ApiDmCall, viewerIsCaller: boolean): string {
  if (call.status === 'completed') {
    return call.duration == null ? 'call ended' : `call ended · ${formatCallDuration(call.duration)}`;
  }
  if (call.status === 'declined') return viewerIsCaller ? 'call declined' : 'declined call';
  return viewerIsCaller ? 'no answer' : 'missed call';
}
