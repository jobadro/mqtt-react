import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import mqtt from 'mqtt';
import type { MqttClient, IClientOptions } from 'mqtt';

export type MqttUrl = string;
export type MqttConnectionStatus = 'offline' | 'connecting' | 'online' | 'reconnecting' | 'error';
export type QoSLevel = 0 | 1 | 2;

export interface MqttProviderProps {
  url: MqttUrl;
  options?: IClientOptions;
  children: React.ReactNode;
  onError?: (error: Error) => void;
}

interface MqttContextValue {
  client: MqttClient | null;
  status: MqttConnectionStatus;
  publisherId: string;
  recentSelfMessages: React.MutableRefObject<{ topic: string; hash: string; ts: number }[]>;
}

const MqttContext = createContext<MqttContextValue | undefined>(undefined);

export function MqttProvider({ url, options, children, onError }: MqttProviderProps) {
  const [status, setStatus] = useState<MqttConnectionStatus>('offline');
  const clientRef = useRef<MqttClient | null>(null);
  const publisherIdRef = useRef<string>(`self-${Math.random().toString(36).slice(2)}-${Date.now()}`);
  const recentSelfMessagesRef = useRef<{ topic: string; hash: string; ts: number }[]>([]);

  useEffect(() => {
    setStatus('connecting');
    const client = mqtt.connect(url, options);
    clientRef.current = client;

    const handleConnect = () => setStatus('online');
    const handleReconnect = () => setStatus((s) => (s === 'online' ? 'reconnecting' : 'connecting'));
    const handleClose = () => setStatus('offline');
    const handleError = (err: Error) => {
      setStatus('error');
      onError?.(err);
    };

    client.on('connect', handleConnect);
    client.on('reconnect', handleReconnect);
    client.on('close', handleClose);
    client.on('error', handleError);

    return () => {
      client.removeListener('connect', handleConnect);
      client.removeListener('reconnect', handleReconnect);
      client.removeListener('close', handleClose);
      client.removeListener('error', handleError);
      client.end(true);
      clientRef.current = null;
    };
  }, [url, JSON.stringify(options)]);

  const value = useMemo<MqttContextValue>(() => ({ client: clientRef.current, status, publisherId: publisherIdRef.current, recentSelfMessages: recentSelfMessagesRef }), [status]);

  return <MqttContext.Provider value={value}>{children}</MqttContext.Provider>;
}

export function useMqttClient(): MqttClient | null {
  const ctx = useContext(MqttContext);
  if (!ctx) throw new Error('useMqttClient must be used within MqttProvider');
  return ctx.client;
}

export function useMqttConnectionStatus(): MqttConnectionStatus {
  const ctx = useContext(MqttContext);
  if (!ctx) throw new Error('useMqttConnectionStatus must be used within MqttProvider');
  return ctx.status;
}

export interface PublishOptions {
  qos?: QoSLevel;
  retain?: boolean;
  // Additional MQTT 5 properties can be passed through as-is
  // eslint-disable-next-line @typescript-eslint/ban-types
  properties?: Record<string, unknown>;
}

export function useMqttPublish() {
  const client = useMqttClient();
  const ctx = useContext(MqttContext);
  return useCallback(
    (topic: string, payload: string | Buffer | Uint8Array, options?: PublishOptions) => {
      if (!client) throw new Error('MQTT client not ready');
      // Inject a publisherId marker (MQTT v5 userProperties) to enable self-filtering downstream
      const mergedOptions: any = { ...(options || {}) };
      const properties = { ...(mergedOptions.properties || {}) } as any;
      const userProperties = { ...(properties.userProperties || {}) } as any;
      if (ctx?.publisherId) userProperties.publisherId = ctx.publisherId;
      properties.userProperties = userProperties;
      mergedOptions.properties = properties;
      // Track locally for brokers without MQTT v5 support
      try {
        const bytes: Uint8Array = typeof payload === 'string' ? new TextEncoder().encode(payload) : (payload as any instanceof Uint8Array ? (payload as Uint8Array) : new Uint8Array(payload as any));
        const hash = btoa(String.fromCharCode(...bytes.slice(0, 512)));
        const now = Date.now();
        ctx?.recentSelfMessages.current.push({ topic, hash, ts: now });
        // prune > 7s old or keep last 100 entries
        ctx && (ctx.recentSelfMessages.current = ctx.recentSelfMessages.current.filter(m => now - m.ts < 7000).slice(-100));
      } catch {}
      client.publish(topic, payload as any, mergedOptions);
    },
    [client]
  );
}

export interface SubscriptionOptions {
  qos?: QoSLevel;
  excludeSelf?: boolean;
  // Window to suppress self-echoed messages when broker doesn't support MQTT5 noLocal; default 100ms
  selfWindowMs?: number;
}

export function useMqttSubscription<T = string>(topic: string | string[], options?: SubscriptionOptions, parser?: (message: Uint8Array) => T) {
  const client = useMqttClient();
  const ctx = useContext(MqttContext);
  const [message, setMessage] = useState<T | null>(null);

  useEffect(() => {
    if (!client) return;
    const topics = Array.isArray(topic) ? topic : [topic];
    const { excludeSelf, selfWindowMs = 100, ...rest } = (options || {}) as any;
    const subscribeOptions = excludeSelf ? { ...rest, nl: true } : rest; // MQTT v5 noLocal
    client.subscribe(topics, subscribeOptions);

    const onMessage = (msgTopic: string, payload: Buffer, packet?: any) => {
      if (topics.includes(msgTopic)) {
        if (options?.excludeSelf) {
          const publisherId = packet?.properties?.userProperties?.publisherId;
          if (publisherId && ctx?.publisherId && publisherId === ctx.publisherId) {
            return; // skip messages published by this provider instance
          }
          // Fallback local filter for non-MQTT5 brokers
          try {
            const bytes = new Uint8Array(payload);
            const hash = btoa(String.fromCharCode(...bytes.slice(0, 512)));
            const now = Date.now();
            const hit = ctx?.recentSelfMessages.current.find(m => m.topic === msgTopic && m.hash === hash && now - m.ts < selfWindowMs);
            if (hit) return;
          } catch {}
        }
        const bytes = new Uint8Array(payload);
        const value = parser ? parser(bytes) : (new TextDecoder().decode(bytes) as unknown as T);
        setMessage(value);
      }
    };

    client.on('message', onMessage);

    return () => {
      client.removeListener('message', onMessage);
      client.unsubscribe(topics);
    };
  }, [client, JSON.stringify(topic), JSON.stringify(options)]);

  return message;
}

export type { MqttClient };

