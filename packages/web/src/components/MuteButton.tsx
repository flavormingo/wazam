import { useMutesStore } from '../stores/mutes';
import { BellIcon, BellOffIcon } from './icons';

interface Props {
  scopeType: 'club' | 'channel' | 'dm';
  scopeId: string;
}

export function MuteButton({ scopeType, scopeId }: Props) {
  const muted = useMutesStore((s) => s.muted).has(`${scopeType}:${scopeId}`);
  const toggle = useMutesStore((s) => s.toggle);

  return (
    <button
      className="icon-btn"
      onClick={() => toggle(scopeType, scopeId)}
      aria-label={muted ? 'unmute notifications' : 'mute notifications'}
      aria-pressed={muted}
    >
      {muted ? <BellOffIcon size={18} /> : <BellIcon size={18} />}
    </button>
  );
}
