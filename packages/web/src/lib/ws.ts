import type { ClientOp, ServerOp } from '@wazam/shared';

type EventHandler = (op: ServerOp) => void;

class WsClient {
  private ws: WebSocket | null = null;
  private handlers = new Set<EventHandler>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private connected = false;
  private pendingSubscriptions = new Set<string>();
  private lastFocus: string | null = null;

  connect() {
    if (this.ws || this.reconnectTimer) return;

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${protocol}//${location.host}/ws`);

    this.ws.onopen = () => {
      this.connected = true;
      this.reconnectDelay = 1000;
      this.startPing();

      for (const channelId of this.pendingSubscriptions) {
        this.send({ op: 'subscribe', d: { channel_id: channelId } });
      }
      if (this.lastFocus) {
        this.send({ op: 'focus', d: { conversation_id: this.lastFocus } });
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const op = JSON.parse(event.data) as ServerOp;
        for (const handler of this.handlers) {
          handler(op);
        }
      } catch {
      }
    };

    this.ws.onclose = () => {
      this.connected = false;
      this.ws = null;
      this.stopPing();
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
    };
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopPing();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.pendingSubscriptions.clear();
  }

  send(op: ClientOp) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(op));
    }
  }

  subscribeChannel(channelId: string) {
    this.pendingSubscriptions.add(channelId);
    this.send({ op: 'subscribe', d: { channel_id: channelId } });
  }

  unsubscribeChannel(channelId: string) {
    this.pendingSubscriptions.delete(channelId);
    this.send({ op: 'unsubscribe', d: { channel_id: channelId } });
  }

  subscribe(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  sendDmTyping(dmChannelId: string) {
    this.send({ op: 'dm.typing.start', d: { dm_channel_id: dmChannelId } });
  }

  focus(conversationId: string | null) {
    this.lastFocus = conversationId;
    this.send({ op: 'focus', d: { conversation_id: conversationId } });
  }

  isConnected() {
    return this.connected;
  }

  private startPing() {
    this.pingTimer = setInterval(() => {
      this.send({ op: 'ping' });
    }, 25000);
  }

  private stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect() {
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }
}

export const wsClient = new WsClient();
