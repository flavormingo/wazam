import { useState, useEffect, useRef, useMemo, type CSSProperties } from 'react';
import { useVoiceStore, getRoom } from '../stores/voice';
import { useCallStore } from '../stores/call';
import { api } from '../lib/api';
import { MicIcon, MicMutedIcon, CameraIcon, CameraOffIcon, RotateCameraIcon, ScreenIcon, PhoneIcon } from './icons';
import type { Participant as LKParticipant, Track } from 'livekit-client';
import './DMCallView.css';
import './CallStage.css';

type TileDescriptor = {
  id: string;
  identity: string;
  name: string;
  type: 'participant' | 'screen';
  isSpeaking: boolean;
  isMuted: boolean;
  hasCamera: boolean;
  hasScreen: boolean;
  avatarUrl: string | null;
};

export function DMCallView({ dmChannelId }: { dmChannelId: string }) {
  const muted = useVoiceStore((s) => s.muted);
  const cameraEnabled = useVoiceStore((s) => s.cameraEnabled);
  const connected = useVoiceStore((s) => s.connected);
  const screenSharing = useVoiceStore((s) => s.screenSharing);
  const participants = useVoiceStore((s) => s.participants);
  const leaveVoice = useVoiceStore((s) => s.leaveVoice);
  const toggleMute = useVoiceStore((s) => s.toggleMute);
  const toggleCamera = useVoiceStore((s) => s.toggleCamera);
  const canFlipCamera = useVoiceStore((s) => s.canFlipCamera);
  const flipCamera = useVoiceStore((s) => s.flipCamera);
  const toggleScreenShare = useVoiceStore((s) => s.toggleScreenShare);
  const clearAll = useCallStore((s) => s.clearAll);

  const [focusedTileId, setFocusedTileId] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [gridLayout, setGridLayout] = useState({ cols: 1, w: 240, h: 150 });

  const participantList = Object.values(participants);

  const tiles: TileDescriptor[] = [];
  for (const p of participantList) {
    tiles.push({
      id: `participant:${p.identity}`,
      identity: p.identity,
      name: p.name,
      type: 'participant',
      isSpeaking: p.isSpeaking,
      isMuted: p.isMuted,
      hasCamera: p.hasCamera,
      hasScreen: p.hasScreen,
      avatarUrl: p.avatarUrl,
    });
    if (p.hasScreen) {
      tiles.push({
        id: `screen:${p.identity}`,
        identity: p.identity,
        name: p.name,
        type: 'screen',
        isSpeaking: false,
        isMuted: false,
        hasCamera: false,
        hasScreen: true,
        avatarUrl: p.avatarUrl,
      });
    }
  }

  const screenTileIds = useMemo(() => tiles.filter((t) => t.type === 'screen').map((t) => t.id), [tiles]);

  useEffect(() => {
    if (screenTileIds.length > 0) {
      setFocusedTileId((prev) => {
        if (prev && screenTileIds.includes(prev)) return prev;
        return screenTileIds[0];
      });
    } else {
      setFocusedTileId((prev) => prev?.startsWith('screen:') ? null : prev);
    }
  }, [screenTileIds.length]);

  useEffect(() => {
    const el = bodyRef.current;
    const n = tiles.length;
    if (!el || n === 0) return;
    const GAP = 12;
    const R = 16 / 10;
    const observer = new ResizeObserver((entries) => {
      const { width: W, height: H } = entries[0].contentRect;
      if (W <= 0 || H <= 0) return;
      let bestCols = 1;
      let bestArea = 0;
      let bestW = 100;
      let bestH = 62;
      for (let c = 1; c <= n; c++) {
        const rows = Math.ceil(n / c);
        let tw = (W - GAP * (c - 1)) / c;
        let th = tw / R;
        const maxH = (H - GAP * (rows - 1)) / rows;
        if (th > maxH) { th = maxH; tw = th * R; }
        if (tw > 0 && th > 0 && tw * th > bestArea) {
          bestArea = tw * th;
          bestCols = c;
          bestW = tw;
          bestH = th;
        }
      }
      setGridLayout({ cols: bestCols, w: Math.floor(bestW), h: Math.floor(bestH) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [tiles.length]);

  const focusedTile = focusedTileId ? tiles.find((t) => t.id === focusedTileId) : null;
  const validFocusId = focusedTile ? focusedTileId : null;

  const handleTileClick = (id: string) => {
    setFocusedTileId((prev) => (prev === id ? null : id));
  };

  const handleHangUp = async () => {
    try {
      await api.endCall(dmChannelId);
    } catch {}
    leaveVoice();
    clearAll();
  };

  return (
    <div className="dm-call-view">
      <div className={`body ${validFocusId ? 'has-focus' : ''}`} ref={bodyRef}>
        {validFocusId && focusedTile ? (
          <>
            <VideoTile
              key={focusedTile.id}
              tile={focusedTile}
              focused
              onClick={() => handleTileClick(focusedTile.id)}
            />
            {tiles.length > 1 && (
              <div className="strip">
                {tiles.filter((t) => t.id !== validFocusId).map((t) => (
                  <VideoTile
                    key={t.id}
                    tile={t}
                    focused={false}
                    onClick={() => handleTileClick(t.id)}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="grid" style={{ '--tile-w': `${gridLayout.w}px`, '--tile-h': `${gridLayout.h}px` } as CSSProperties}>
            {tiles.map((t) => (
              <VideoTile
                key={t.id}
                tile={t}
                focused={false}
                onClick={() => handleTileClick(t.id)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="controls">
        <button
          className={`ctrl-btn ${muted ? 'active' : ''}`}
          onClick={toggleMute}
          disabled={!connected}
          aria-label={muted ? 'unmute' : 'mute'}
        >
          {muted ? <MicMutedIcon size={20} /> : <MicIcon size={20} />}
        </button>
        <button
          className={`ctrl-btn ${cameraEnabled ? 'active' : ''}`}
          onClick={toggleCamera}
          disabled={!connected}
          aria-label={cameraEnabled ? 'turn off camera' : 'turn on camera'}
        >
          {cameraEnabled ? <CameraIcon size={20} /> : <CameraOffIcon size={20} />}
        </button>
        {cameraEnabled && canFlipCamera && (
          <button className="ctrl-btn" onClick={flipCamera} disabled={!connected} aria-label="flip camera">
            <RotateCameraIcon size={20} />
          </button>
        )}
        <button
          className={`ctrl-btn ${screenSharing ? 'active' : ''}`}
          onClick={toggleScreenShare}
          disabled={!connected}
          aria-label={screenSharing ? 'stop sharing' : 'share screen'}
        >
          <ScreenIcon size={20} />
        </button>
        <button
          className="ctrl-btn disconnect"
          onClick={handleHangUp}
          aria-label="hang up"
        >
          <PhoneIcon size={20} />
        </button>
      </div>
    </div>
  );
}

function VideoTile({ tile, focused, onClick }: { tile: TileDescriptor; focused: boolean; onClick: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [imgError, setImgError] = useState(false);
  const cameraFacing = useVoiceStore((s) => s.cameraFacing);

  const source = tile.type === 'screen' ? 'screen_share' : 'camera';
  const trackTrigger = tile.type === 'screen' ? tile.hasScreen : tile.hasCamera;

  useEffect(() => {
    const r = getRoom();
    if (!r || !videoRef.current) return;

    let lkParticipant: LKParticipant | undefined;
    if (r.localParticipant.identity === tile.identity) {
      lkParticipant = r.localParticipant;
    } else {
      lkParticipant = r.remoteParticipants.get(tile.identity);
    }
    if (!lkParticipant) return;

    let track: Track | undefined;
    for (const pub of lkParticipant.videoTrackPublications.values()) {
      if (pub.source === source && pub.track) {
        track = pub.track;
        break;
      }
    }

    const el = videoRef.current;
    if (track) {
      track.attach(el);
      return () => { track!.detach(el); };
    }
  }, [tile.identity, source, trackTrigger]);

  const isScreen = tile.type === 'screen';
  const showVideo = isScreen ? tile.hasScreen : tile.hasCamera;
  const isLocal = getRoom()?.localParticipant?.identity === tile.identity;

  return (
    <div
      className={`tile ${isScreen ? 'screen' : ''} ${tile.isSpeaking ? 'speaking' : ''} ${focused ? 'focused' : ''}`}
      onClick={onClick}
    >
      {showVideo ? (
        <video ref={videoRef} autoPlay playsInline muted className={isLocal && !isScreen && cameraFacing !== 'environment' ? 'mirror' : ''} />
      ) : (
        <div className="tile-avatar">
          <span>
            {tile.avatarUrl && !imgError ? <img src={tile.avatarUrl} alt="" onError={() => setImgError(true)} /> : tile.name[0]?.toUpperCase()}
          </span>
        </div>
      )}
      <div className="bar">
        {isScreen && <ScreenIcon size={14} />}
        <span className="name">{isScreen ? `${tile.name}'s screen` : tile.name}</span>
        {!isScreen && tile.isMuted && <MicMutedIcon size={14} className="muted" />}
      </div>
    </div>
  );
}
