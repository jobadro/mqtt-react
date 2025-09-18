import { useEffect, useMemo, useState } from 'react';
import { MqttProvider, useMqttConnectionStatus, useMqttPublish, useMqttSubscription } from 'mqtt-react-hooks';

const Demo = () => {
  const status = useMqttConnectionStatus();
  const publish = useMqttPublish();
  const lastEcho = useMqttSubscription<string>('test/echo', { excludeSelf: false });
  const [text, setText] = useState('hello');

  return (
    <div style={{ fontFamily: 'system-ui', padding: 24, maxWidth: 720, margin: '0 auto' }}>
      <h1>MQTT React Hooks - Example</h1>
      <p>Status: <strong>{status}</strong></p>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="message" />
        <button onClick={() => publish('test/echo', text)}>Publish</button>
      </div>
      <p>Last message on <code>test/echo</code>: {lastEcho ?? '—'}</p>
      <p style={{ marginTop: 24, opacity: 0.7 }}>
        Tip: You can connect your broker to echo this topic back, or open two tabs.
      </p>
    </div>
  );
};

export const App = () => {
  const url = useMemo(() => {
    // Adjust to your broker; many browsers require secure wss when page is https
    return (import.meta.env.VITE_MQTT_URL as string) || 'ws://test.mosquitto.org:8080/mqtt';
  }, []);

  return (
    <MqttProvider url={url}>
      <Demo />
    </MqttProvider>
  );
};


