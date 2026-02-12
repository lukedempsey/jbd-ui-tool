import { useState, useEffect, useCallback, useRef } from 'react';
import { bmsSerial, type TrafficEntry } from '../lib/serial';

const MAX_ENTRIES = 500;

export function useTrafficLog() {
  const [entries, setEntries] = useState<TrafficEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    const unsub = bmsSerial.onTraffic((entry) => {
      if (pausedRef.current) return;
      setEntries((prev) => {
        const next = [...prev, entry];
        return next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next;
      });
    });
    return unsub;
  }, []);

  const clear = useCallback(() => setEntries([]), []);
  const togglePause = useCallback(() => setPaused((p) => !p), []);

  return { entries, paused, clear, togglePause };
}
