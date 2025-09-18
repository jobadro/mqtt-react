# mqtt-react-hooks

React hooks for MQTT over WebSockets with a context-based provider.

## Install

```bash
npm install mqtt-react-hooks
# or
pnpm add mqtt-react-hooks
```

## Usage

```tsx
import { MqttProvider, useMqttPublish, useMqttSubscription, useMqttConnectionStatus } from 'mqtt-react-hooks';

export function App() {
  return (
    <MqttProvider url="wss://broker.example.com/mqtt">
      <Demo />
    </MqttProvider>
  );
}

function Demo() {
  const status = useMqttConnectionStatus();
  const publish = useMqttPublish();
  const msg = useMqttSubscription<string>('test/echo', { excludeSelf: true });
  return (
    <>
      <div>Status: {status}</div>
      <button onClick={() => publish('test/echo', 'hello')}>Send</button>
      <div>Last: {msg ?? '—'}</div>
    </>
  );
}
```

## Examples

### Subscribe to JSON and publish objects
```tsx
import { useMqttSubscription, useMqttPublish, SerializationMode } from 'mqtt-react-hooks';

type Sensor = { id: string; temp: number };

// Auto: bytes → utf8 → JSON.parse if possible (fallback string)
const last = useMqttSubscription('sensors/data', { serializationMode: SerializationMode.Auto });

// Publish object (Auto: objects stringified, primitives plain text)
const publish = useMqttPublish();
publish('sensors/data', { id: 'a1', temp: 21.3 });
```

### Strong typing via custom parser
```tsx
const parsed = useMqttSubscription<Sensor>(
  'sensors/data',
  { serializationMode: SerializationMode.String },
  (bytes) => JSON.parse(new TextDecoder().decode(bytes)) as Sensor
);
```

### Streaming callback without storing last value
```tsx
useMqttSubscription<Sensor>('sensors/data', {
  onMessage: (value) => console.log('stream', value)
});
```

### Avoid self-echo
```tsx
useMqttSubscription('chat/room1', { excludeSelf: true });
```

### Control JSON handling on publish
```tsx
import { useMqttPublish, SerializationMode } from 'mqtt-react-hooks';
const publish = useMqttPublish();

// Default (Auto): objects JSON, numbers/booleans as plain text
publish('t/auto', { a: 1 });       // => "{\"a\":1}"
publish('t/auto', 42);             // => "42"

// Force: JSON stringify everything (binary decoded to utf8 then JSON stringified)
publish('t/force', 42, { serializationMode: SerializationMode.Json });     // => "\"42\""

// String: never JSON, coerce to string (non-binary)
publish('t/string', { a: 1 }, { serializationMode: SerializationMode.String }); // => "[object Object]"
```

### Control JSON handling on subscribe
```tsx
import { useMqttSubscription, SerializationMode } from 'mqtt-react-hooks';

// Always string
const s = useMqttSubscription('t', { serializationMode: SerializationMode.String }); // string | null

// Best-effort JSON (default)
const v = useMqttSubscription('t'); // unknown | string | null
```

Notes:
- Browser requires `ws://` or `wss://` (WebSockets). Port 1883 (`mqtt://`) won’t work in browsers.
- `{ excludeSelf: true }` uses MQTT v5 `noLocal` when available; otherwise a local fallback suppresses quick self-echoes.

## License

MIT
