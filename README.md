# mqtt-react-hooks

React hooks for MQTT over WebSockets with a context-based provider.

## Packages

- `packages/mqtt-react-hooks`: the library
- `apps/example`: Vite React example consuming the library

## Install (npm / pnpm)

```bash
# with pnpm
pnpm add mqtt-react-hooks

# with npm
npm install mqtt-react-hooks
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
    <div>
      <div>Status: {status}</div>
      <button onClick={() => publish('test/echo', 'hello')}>Send</button>
      <div>Last: {msg ?? '—'}</div>
    </div>
  );
}
```

Notes:
- Browser requires MQTT over WebSockets (`ws://` or `wss://`).
- `excludeSelf` uses MQTT v5 `noLocal` where available and falls back to local filtering.

## Development

```bash
pnpm install
pnpm -r build
pnpm dev
```

The example app uses `VITE_MQTT_URL` or defaults to `ws://test.mosquitto.org:8080/mqtt`.

