import { useNavigate } from 'react-router';
import { useVoiceStore } from '../stores/voice';
import { useChannelsStore } from '../stores/channels';
import { useClubsStore } from '../stores/clubs';
import { useCallStore } from '../stores/call';
import { useDmsStore } from '../stores/dms';
import { useAuthStore } from '../stores/auth';
import { api } from '../lib/api';
import { MicIcon, MicMutedIcon, HeadphonesIcon, PhoneIcon } from './icons';
import './VoicePanel.css';

export function VoicePanel() {
  const channelId = useVoiceStore((s) => s.channelId);
  const callType = useVoiceStore((s) => s.callType);
  const dmChannelId = useVoiceStore((s) => s.dmChannelId);
  const connected = useVoiceStore((s) => s.connected);
  const muted = useVoiceStore((s) => s.muted);
  const deafened = useVoiceStore((s) => s.deafened);
  const toggleMute = useVoiceStore((s) => s.toggleMute);
  const toggleDeafen = useVoiceStore((s) => s.toggleDeafen);
  const leaveVoice = useVoiceStore((s) => s.leaveVoice);
  const clearCallAll = useCallStore((s) => s.clearAll);
  const channels = useChannelsStore((s) => s.channels);
  const clubs = useClubsStore((s) => s.clubs);
  const dmChannels = useDmsStore((s) => s.channels);
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();

  const clubId = channelId ? Object.keys(channels).find((id) => channels[id].some((c: any) => c.id === channelId)) : undefined;
  const channel = clubId ? channels[clubId].find((c: any) => c.id === channelId) : undefined;
  const club = clubs.find((c: any) => c.id === clubId);
  const callee = dmChannels.find((c: any) => c.id === dmChannelId)?.members?.find((m: any) => m.id !== user?.id);

  if (!connected) return null;

  const handleDisconnect = async () => {
    if (callType === 'dm' && dmChannelId) {
      try { await api.endCall(dmChannelId); } catch {}
      clearCallAll();
    }
    leaveVoice();
  };

  const openCall = () => {
    if (callType === 'dm' && dmChannelId) navigate(`/dm/${dmChannelId}`);
    else if (channelId && clubId) navigate(`/club/${club?.slug || clubId}/channel/${channelId}`);
  };

  const label = callType === 'dm' ? (callee ? `call with ${callee.name}` : 'private call') : (channel?.name || 'voice');

  return (
    <div className="voice-panel">
      <button className="info" onClick={openCall}>
        <span className="status">
          <span className="dot" />
          connected
        </span>
        <span className="channel">{label}</span>
      </button>
      <div className="controls">
        <button
          className={`icon-btn ${muted ? 'active' : ''}`}
          onClick={toggleMute}
          aria-label={muted ? 'unmute' : 'mute'}
        >
          {muted ? <MicMutedIcon size={16} /> : <MicIcon size={16} />}
        </button>
        <button
          className={`icon-btn ${deafened ? 'active' : ''}`}
          onClick={toggleDeafen}
          aria-label={deafened ? 'undeafen' : 'deafen'}
        >
          <HeadphonesIcon size={16} />
        </button>
        <button
          className="icon-btn disconnect"
          onClick={handleDisconnect}
          aria-label="disconnect"
        >
          <PhoneIcon size={16} />
        </button>
      </div>
    </div>
  );
}
