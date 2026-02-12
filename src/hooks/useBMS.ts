import { useState, useCallback, useRef, useEffect } from 'react';
import {
  bmsSerial,
  BMSSerial,
  type ConnectionState,
  type DetectedPort,
} from '../lib/serial';
import type { BMSHardwareInfo, BMSCellInfo, BMSConfig } from '../lib/jbd-protocol';

export interface BMSState {
  connectionState: ConnectionState;
  hardware: BMSHardwareInfo | null;
  cells: BMSCellInfo | null;
  version: string | null;
  config: BMSConfig | null;
  error: string | null;
  isPolling: boolean;
  lastUpdate: Date | null;
  detectedPorts: DetectedPort[];
  isScanning: boolean;
  scanStatus: string | null;
}

export function useBMS() {
  const [state, setState] = useState<BMSState>({
    connectionState: 'disconnected',
    hardware: null,
    cells: null,
    version: null,
    config: null,
    error: null,
    isPolling: false,
    lastUpdate: null,
    detectedPorts: [],
    isScanning: false,
    scanStatus: null,
  });

  const pollingRef = useRef(false);
  const pollingTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    bmsSerial.setOnStateChange((connectionState) => {
      setState((prev) => ({ ...prev, connectionState }));
    });
  }, []);

  // Auto-detect on mount: list previously-granted ports
  useEffect(() => {
    if (!BMSSerial.isSupported()) return;
    BMSSerial.getDetectedPorts().then((ports) => {
      if (ports.length > 0) {
        setState((prev) => ({ ...prev, detectedPorts: ports }));
      }
    });
  }, []);

  // ── Port scanning ──────────────────────────────────────────────────────────

  /** Refresh the list of previously-granted ports (no probe) */
  const refreshPorts = useCallback(async () => {
    const ports = await BMSSerial.getDetectedPorts();
    setState((prev) => ({ ...prev, detectedPorts: ports }));
  }, []);

  /** Full autodetect: probe each port for a JBD BMS */
  const autodetect = useCallback(async (baudRate: number = 9600) => {
    setState((prev) => ({
      ...prev,
      isScanning: true,
      scanStatus: 'Scanning ports...',
      error: null,
    }));
    try {
      const ports = await BMSSerial.autodetect(baudRate, (msg) => {
        setState((prev) => ({ ...prev, scanStatus: msg }));
      });
      setState((prev) => ({
        ...prev,
        detectedPorts: ports,
        isScanning: false,
        scanStatus: null,
      }));

      // Auto-connect to the first confirmed BMS
      const bmsPort = ports.find((p) => p.isBMS);
      if (bmsPort) {
        setState((prev) => ({
          ...prev,
          error: null,
          scanStatus: `Auto-connecting to ${bmsPort.label}...`,
        }));
        try {
          await bmsSerial.connectToPort(bmsPort.port, { baudRate });
          setState((prev) => ({ ...prev, scanStatus: null }));
        } catch (err) {
          const msg =
            err instanceof Error ? err.message : 'Auto-connect failed';
          setState((prev) => ({ ...prev, error: msg, scanStatus: null }));
        }
      }

      return ports;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Scan failed';
      setState((prev) => ({
        ...prev,
        isScanning: false,
        scanStatus: null,
        error: msg,
      }));
      return [];
    }
  }, []);

  // ── Connection ─────────────────────────────────────────────────────────────

  /** Connect via browser port picker */
  const connect = useCallback(async (baudRate: number = 9600) => {
    setState((prev) => ({ ...prev, error: null }));
    try {
      await bmsSerial.connect({ baudRate });
      // Refresh detected ports after granting a new one
      const ports = await BMSSerial.getDetectedPorts();
      setState((prev) => ({ ...prev, detectedPorts: ports }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection failed';
      setState((prev) => ({ ...prev, error: msg }));
    }
  }, []);

  /** Connect to a specific detected port by index */
  const connectToPort = useCallback(
    async (portIndex: number, baudRate: number = 9600) => {
      const dp = state.detectedPorts[portIndex];
      if (!dp) return;
      setState((prev) => ({ ...prev, error: null }));
      try {
        await bmsSerial.connectToPort(dp.port, { baudRate });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Connection failed';
        setState((prev) => ({ ...prev, error: msg }));
      }
    },
    [state.detectedPorts]
  );

  const disconnect = useCallback(async () => {
    pollingRef.current = false;
    if (pollingTimerRef.current) clearTimeout(pollingTimerRef.current);
    await bmsSerial.disconnect();
    setState((prev) => ({
      ...prev,
      hardware: null,
      cells: null,
      version: null,
      config: null,
      isPolling: false,
      error: null,
      lastUpdate: null,
    }));
  }, []);

  // ── Data reading ───────────────────────────────────────────────────────────

  const readAll = useCallback(async () => {
    if (!bmsSerial.isConnected) return;
    setState((prev) => ({ ...prev, error: null }));
    try {
      const data = await bmsSerial.readAll();
      setState((prev) => ({
        ...prev,
        hardware: data.hardware,
        cells: data.cells,
        version: data.version,
        lastUpdate: new Date(),
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Read failed';
      setState((prev) => ({ ...prev, error: msg }));
    }
  }, []);

  const startPolling = useCallback(
    (intervalMs: number = 1000) => {
      if (pollingRef.current) return;
      pollingRef.current = true;
      setState((prev) => ({ ...prev, isPolling: true }));

      const poll = async () => {
        if (!pollingRef.current || !bmsSerial.isConnected) {
          pollingRef.current = false;
          setState((prev) => ({ ...prev, isPolling: false }));
          return;
        }
        await readAll();
        if (pollingRef.current) {
          pollingTimerRef.current = setTimeout(poll, intervalMs);
        }
      };

      poll();
    },
    [readAll]
  );

  // Auto-start polling at 1 Hz when connected
  useEffect(() => {
    if (state.connectionState === 'connected' && !pollingRef.current) {
      startPolling(1000);
    }
  }, [state.connectionState, startPolling]);

  const stopPolling = useCallback(() => {
    pollingRef.current = false;
    if (pollingTimerRef.current) clearTimeout(pollingTimerRef.current);
    setState((prev) => ({ ...prev, isPolling: false }));
  }, []);

  const readConfig = useCallback(async () => {
    if (!bmsSerial.isConnected) return;
    setState((prev) => ({ ...prev, error: null }));
    try {
      const config = await bmsSerial.readConfig();
      setState((prev) => ({ ...prev, config }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Config read failed';
      setState((prev) => ({ ...prev, error: msg }));
    }
  }, []);

  const writeRegister = useCallback(
    async (register: number, value: number) => {
      if (!bmsSerial.isConnected) return;
      setState((prev) => ({ ...prev, error: null }));
      try {
        await bmsSerial.writeRegister(register, value);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Write failed';
        setState((prev) => ({ ...prev, error: msg }));
        throw err;
      }
    },
    []
  );

  const writeTempRegister = useCallback(
    async (register: number, celsius: number) => {
      if (!bmsSerial.isConnected) return;
      setState((prev) => ({ ...prev, error: null }));
      try {
        await bmsSerial.writeTempRegister(register, celsius);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Write failed';
        setState((prev) => ({ ...prev, error: msg }));
        throw err;
      }
    },
    []
  );

  const setMosfet = useCallback(
    async (charge: boolean, discharge: boolean) => {
      if (!bmsSerial.isConnected) return;
      setState((prev) => ({ ...prev, error: null }));
      try {
        await bmsSerial.setMosfet(charge, discharge);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : 'MOSFET control failed';
        setState((prev) => ({ ...prev, error: msg }));
        throw err;
      }
    },
    []
  );

  return {
    ...state,
    connect,
    connectToPort,
    disconnect,
    readAll,
    startPolling,
    stopPolling,
    readConfig,
    writeRegister,
    writeTempRegister,
    setMosfet,
    autodetect,
    refreshPorts,
    isSupported: BMSSerial.isSupported(),
  };
}
