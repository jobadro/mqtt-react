/**
 * @module mqtt-react-hooks
 *
 * Module exports:
 * - {@link MqttProvider}
 * - {@link useMqttClient}
 * - {@link useMqttConnectionStatus}
 * - {@link useMqttPublish}
 * - {@link useMqttSubscription}
 * - Types: {@link MqttUrl}, {@link MqttConnectionStatus}, {@link QoSLevel}, {@link PublishOptions}, {@link SubscriptionOptions}
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import mqtt from 'mqtt';
import type { MqttClient, IClientOptions } from 'mqtt';

/** URL of the MQTT broker. In browsers this must be ws:// or wss://. */
export type MqttUrl = string;
/** High-level connection state emitted by the provider. */
export type MqttConnectionStatus = 'offline' | 'connecting' | 'online' | 'reconnecting' | 'error';
export type QoSLevel = 0 | 1 | 2;

/** Serialization modes for publishing payloads. */
export enum SerializationMode {
  /** Default behavior: stringify objects/arrays/null; primitives stay plain text */
  Auto = 'auto',
  /** Never stringify; non-binary values coerced with String() */
  String = 'string',
  /** Force stringify any non-binary value (including primitives). Binary is decoded to UTF-8 then stringified */
  Json = 'json'
}

/**
 * Provider that creates and manages a shared MQTT client instance via context.
 *
 * Notes:
 * - In browsers only MQTT over WebSockets is supported (ws:// or wss://)
 * - Pass standard mqtt.js {@link IClientOptions} through `options`
 * - Reconnects automatically (per mqtt.js defaults)
 */
export interface MqttProviderProps {
  /** MQTT broker URL (ws:// or wss:// in the browser) */
  url: MqttUrl;
  /** mqtt.js client options (clientId, username, reconnectPeriod, etc.) */
  options?: IClientOptions;
  /** React children to render under the provider */
  children: React.ReactNode;
  /** Optional error callback for mqtt.js 'error' events */
  onError?: (error: Error) => void;
}

interface MqttContextValue {
  client: MqttClient | null;
  status: MqttConnectionStatus;
  publisherId: string;
  recentSelfMessages: React.MutableRefObject<{ topic: string; hash: string; ts: number }[]>;
}

const MqttContext = createContext<MqttContextValue | undefined>(undefined);

/**
 * See {@link MqttProviderProps}.
 *
 * @param url - MQTT broker URL. In browsers this must be `ws://` or `wss://`.
 * @param options - Standard mqtt.js {@link IClientOptions} such as `clientId`, `username`, `password`,
 *                  `reconnectPeriod`, `clean`, `protocolVersion` (5 recommended for WebSockets), etc.
 * @param children - React nodes that will have access to the MQTT context.
 * @param onError - Optional callback for unexpected mqtt.js errors (not all connection-time errors are surfaced by browsers).
 */
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

/** Access the underlying mqtt.js client from context (or null before connect). */
export function useMqttClient(): MqttClient | null {
  const ctx = useContext(MqttContext);
  if (!ctx) throw new Error('useMqttClient must be used within MqttProvider');
  return ctx.client;
}

/**
 * Track the provider's high-level connection status.
 *
 * @returns One of {@link MqttConnectionStatus} indicating current state.
 */
export function useMqttConnectionStatus(): MqttConnectionStatus {
  const ctx = useContext(MqttContext);
  if (!ctx) throw new Error('useMqttConnectionStatus must be used within MqttProvider');
  return ctx.status;
}

/** Options for publish. Forwarded to mqtt.js `publish`. */
export interface PublishOptions {
  /** Quality of Service level (0, 1, 2) */
  qos?: QoSLevel;
  /** Retained publish */
  retain?: boolean;
  /** Additional MQTT 5 properties (forwarded) */
  // eslint-disable-next-line @typescript-eslint/ban-types
  properties?: Record<string, unknown>;
  /**
   * JSON serialization mode for non-binary payloads (default: Auto).
   * - Auto: stringify objects/arrays/null; primitives as plain text; binary unchanged
   * - String: never stringify; non-binary coerced with String()
   * - Json: force stringify any non-binary value; binary decoded to UTF-8 then stringified
   */
  serializationMode?: SerializationMode;
}

/**
 * Returns a stable function to publish messages via the shared client.
 *
 * @returns `(topic, payload, options?) => void` publisher function.
 *
 * @example
 * const publish = useMqttPublish();
 * publish('sensors/led', JSON.stringify({ on: true }), { qos: 1, retain: false });
 */
export function useMqttPublish() {
  const client = useMqttClient();
  const ctx = useContext(MqttContext);
  return useCallback(
    (topic: string, payload: unknown, options?: PublishOptions) => {
      if (!client) throw new Error('MQTT client not ready');
      // Inject a publisherId marker (MQTT v5 userProperties) to enable self-filtering downstream
      const mergedOptions: any = { ...(options || {}) };
      const properties = { ...(mergedOptions.properties || {}) } as any;
      const userProperties = { ...(properties.userProperties || {}) } as any;
      if (ctx?.publisherId) userProperties.publisherId = ctx.publisherId;
      properties.userProperties = userProperties;
      mergedOptions.properties = properties;
      // Normalize payload with optional auto JSON
      let normalized: string | Uint8Array | Buffer;
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore - Buffer runtime check
      const isBuffer = typeof Buffer !== 'undefined' && typeof Buffer.isBuffer === 'function' && Buffer.isBuffer(payload);
      const isUint8 = payload instanceof Uint8Array;

      const mode: SerializationMode = mergedOptions.serializationMode ?? SerializationMode.Auto;
      if (mode === SerializationMode.Json) {
        // Force JSON for any value. If binary, decode to UTF-8 string first then JSON.stringify.
        if (isUint8 || isBuffer) {
          // Normalize to Uint8Array view
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          const bytes: Uint8Array = isUint8 ? (payload as Uint8Array) : new Uint8Array(payload as any);
          const text = new TextDecoder().decode(bytes);
          normalized = JSON.stringify(text);
        } else {
          normalized = JSON.stringify(payload);
        }
      } else if (isUint8 || isBuffer) {
        // Keep binary as-is when not forcing JSON
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        normalized = payload as Uint8Array | Buffer;
      } else if (typeof payload === 'string') {
        normalized = payload;
      } else if (typeof payload === 'number' || typeof payload === 'boolean' || typeof payload === 'bigint') {
        // Do not JSON-encode primitives when not forcing
        normalized = String(payload);
      } else if (mode === SerializationMode.Auto) {
        // autoJson true: JSON for objects/arrays/null
        normalized = JSON.stringify(payload);
      } else {
        normalized = String(payload);
      }
      // Track locally for brokers without MQTT v5 support
      try {
        const bytes: Uint8Array = typeof normalized === 'string' ? new TextEncoder().encode(normalized) : (normalized as any instanceof Uint8Array ? (normalized as Uint8Array) : new Uint8Array(normalized as any));
        const hash = btoa(String.fromCharCode(...bytes.slice(0, 512)));
        const now = Date.now();
        ctx?.recentSelfMessages.current.push({ topic, hash, ts: now });
        // prune > 7s old or keep last 100 entries
        ctx && (ctx.recentSelfMessages.current = ctx.recentSelfMessages.current.filter(m => now - m.ts < 7000).slice(-100));
      } catch {}
      client.publish(topic, normalized as any, mergedOptions);
    },
    [client]
  );
}

/** Options for subscriptions created by the hook. */
export interface SubscriptionOptions {
  /** QoS level to request */
  qos?: QoSLevel;
  /**
   * If true, avoid receiving messages published by this provider instance:
   * - Uses MQTT 5 `noLocal` if supported by the broker
   * - Falls back to a local suppression window match
   */
  excludeSelf?: boolean;
  /** Suppression window for fallback filtering (ms). Default: 100. */
  selfWindowMs?: number;
  /**
   * Optional callback invoked for every matched message after parsing.
   * Useful for streaming handling without relying on the returned last value.
   */
  onMessage?: (value: unknown, topic?: string, raw?: Uint8Array, packet?: any) => void;
  /**
   * JSON handling mode when no custom parser is supplied.
   * - Auto (default): attempt JSON.parse of UTF-8 text; fallback to string
   * - String: never JSON.parse; always return string
   * - Json: always attempt JSON.parse; fallback to string if it fails
   */
  serializationMode?: SerializationMode;
}

/**
 * Subscribe to one or more topics and receive the last payload.
 *
 * Overloads:
 * - With `parser`: returns `T | null`.
 * - With `serializationMode: SerializationMode.String` and no `parser`: returns `string | null`.
 * - With other modes and no `parser`: returns `unknown | string | null` (best-effort JSON parse).
 *
 * @typeParam T - The parsed message type when a custom `parser` is provided.
 * @param topic - A topic string or an array of topics to subscribe to.
 * @param options - Subscription behavior. See {@link SubscriptionOptions}.
 * @param options.qos - Requested QoS level (0, 1, or 2).
 * @param options.excludeSelf - If true, avoid receiving messages published by this provider instance. Uses MQTT 5 `noLocal` when available; otherwise falls back to a local suppression window.
 * @param options.selfWindowMs - Suppression window in milliseconds for the fallback self-filter (default 100ms).
 * @param options.serializationMode - Parsing behavior for the default decoder when no `parser` is given.
 * @param parser - Optional function to convert the raw bytes (Uint8Array) into a domain value of type `T`.
 *
 * @returns See overloads above.
 */
export function useMqttSubscription<T>(topic: string | string[], options: SubscriptionOptions | undefined, parser: (message: Uint8Array) => T): T | null;
export function useMqttSubscription(topic: string | string[], options: Omit<SubscriptionOptions, 'serializationMode'> & { serializationMode: SerializationMode.String }): string | null;
export function useMqttSubscription(topic: string | string[], options?: SubscriptionOptions): unknown | string | null;
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
        let parsed: unknown;
        if (parser) {
          parsed = parser(bytes);
        } else {
          const text = new TextDecoder().decode(bytes);
          const mode: SerializationMode = options?.serializationMode ?? SerializationMode.Auto;
          if (mode === SerializationMode.String) {
            parsed = text;
          } else {
            // Default and Force behave the same here: best-effort JSON parse
            try { parsed = JSON.parse(text); } catch { parsed = text; }
          }
        }
        if (options?.onMessage) {
          try { (options.onMessage as (v: T, t?: string, r?: Uint8Array, p?: any) => void)(parsed as T, msgTopic, bytes, packet); } catch {}
        }
        setMessage(parsed as T);
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

