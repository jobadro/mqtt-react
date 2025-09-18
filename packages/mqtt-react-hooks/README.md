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

Notes:
- Browser requires `ws://` or `wss://` (WebSockets). Port 1883 (`mqtt://`) won’t work in browsers.
- `{ excludeSelf: true }` uses MQTT v5 `noLocal` when available; otherwise a local fallback suppresses quick self-echoes.

## License

MIT
