import { useState } from 'react';
import type { ConnectionState, DetectedPort } from '../lib/serial';

interface Props {
  connectionState: ConnectionState;
  isPolling: boolean;
  lastUpdate: Date | null;
  error: string | null;
  isSupported: boolean;
  detectedPorts: DetectedPort[];
  isScanning: boolean;
  scanStatus: string | null;
  onConnect: (baudRate: number) => void;
  onConnectToPort: (portIndex: number, baudRate: number) => void;
  onDisconnect: () => void;
  onStartPolling: (interval: number) => void;
  onStopPolling: () => void;
  onReadOnce: () => void;
  onAutodetect: (baudRate: number) => void;
  onRefreshPorts: () => void;
}

const BAUD_RATES = [9600, 19200, 38400, 57600, 115200];

const stateColors: Record<ConnectionState, string> = {
  disconnected: 'bg-gray-500',
  connecting: 'bg-yellow-500 animate-pulse',
  connected: 'bg-emerald-500',
  error: 'bg-red-500',
};

const stateLabels: Record<ConnectionState, string> = {
  disconnected: 'Disconnected',
  connecting: 'Connecting...',
  connected: 'Connected',
  error: 'Error',
};

export function ConnectionBar({
  connectionState,
  isPolling,
  lastUpdate,
  error,
  isSupported,
  detectedPorts,
  isScanning,
  scanStatus,
  onConnect,
  onConnectToPort,
  onDisconnect,
  onStartPolling,
  onStopPolling,
  onReadOnce,
  onAutodetect,
  onRefreshPorts,
}: Props) {
  const [baudRate, setBaudRate] = useState(9600);
  const [pollInterval, setPollInterval] = useState(1000);
  const [selectedPort, setSelectedPort] = useState<number>(-1); // -1 = "pick new"
  const isConnected = connectionState === 'connected';
  const isBusy = connectionState === 'connecting';
  const isDisconnected = !isConnected && !isBusy;

  if (!isSupported) {
    return (
      <div className="bg-red-900/50 border border-red-700 rounded-xl p-4 text-center">
        <p className="text-red-300 font-medium">
          Web Serial API is not supported in this browser. Please use Chrome or Edge.
        </p>
      </div>
    );
  }

  const handleConnect = () => {
    if (selectedPort >= 0) {
      onConnectToPort(selectedPort, baudRate);
    } else {
      onConnect(baudRate);
    }
  };

  const bmsPort = detectedPorts.find((p) => p.isBMS);

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4 space-y-3">
      {/* Main connection row */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Status indicator */}
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full ${stateColors[connectionState]}`} />
          <span className="text-sm font-medium text-[var(--color-text-muted)]">
            {stateLabels[connectionState]}
          </span>
        </div>

        {isDisconnected && (
          <>
            {/* Port selector */}
            <select
              value={selectedPort}
              onChange={(e) => setSelectedPort(Number(e.target.value))}
              className="bg-[var(--color-surface-light)] border border-[var(--color-border)] rounded-lg px-3 py-1.5 text-sm text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            >
              <option value={-1}>Select port...</option>
              {detectedPorts.map((dp) => (
                <option key={dp.index} value={dp.index}>
                  {dp.label}
                  {dp.isBMS ? ' [BMS]' : ''}
                </option>
              ))}
            </select>

            {/* Baud rate selector */}
            <select
              value={baudRate}
              onChange={(e) => setBaudRate(Number(e.target.value))}
              className="bg-[var(--color-surface-light)] border border-[var(--color-border)] rounded-lg px-3 py-1.5 text-sm text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            >
              {BAUD_RATES.map((rate) => (
                <option key={rate} value={rate}>
                  {rate} baud
                </option>
              ))}
            </select>

            {/* Connect */}
            <button
              onClick={handleConnect}
            disabled={isBusy}
            className="px-4 py-1.5 bg-[var(--color-primary)] hover:bg-[var(--color-primary-dark)] disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors cursor-pointer"
          >
            {selectedPort >= 0 ? 'Connect' : 'Pick Port...'}
          </button>

            <div className="h-6 w-px bg-[var(--color-border)]" />

            {/* Autodetect */}
            <button
              onClick={() => onAutodetect(baudRate)}
              disabled={isScanning || isBusy}
              className="px-4 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors cursor-pointer flex items-center gap-1.5"
            >
              {isScanning ? (
                <>
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Scanning...
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  Autodetect
                </>
              )}
            </button>

            {/* Refresh ports (lightweight, no probe) */}
            <button
              onClick={onRefreshPorts}
              className="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors cursor-pointer"
              title="Refresh port list"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </>
        )}

        {isConnected && (
          <>
            <button
              onClick={onDisconnect}
              className="px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors cursor-pointer"
            >
              Disconnect
            </button>

            <div className="h-6 w-px bg-[var(--color-border)]" />

            {/* Read once */}
            <button
              onClick={onReadOnce}
              disabled={isPolling}
              className="px-4 py-1.5 bg-[var(--color-surface-light)] hover:bg-[var(--color-border)] disabled:opacity-50 text-[var(--color-text)] text-sm font-medium rounded-lg transition-colors cursor-pointer"
            >
              Read Once
            </button>

            {/* Polling controls */}
            <div className="flex items-center gap-2">
              <select
                value={pollInterval}
                onChange={(e) => setPollInterval(Number(e.target.value))}
                disabled={isPolling}
                className="bg-[var(--color-surface-light)] border border-[var(--color-border)] rounded-lg px-3 py-1.5 text-sm text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
              >
                <option value={500}>0.5s</option>
                <option value={1000}>1s</option>
                <option value={2000}>2s</option>
                <option value={5000}>5s</option>
              </select>

              {!isPolling ? (
                <button
                  onClick={() => onStartPolling(pollInterval)}
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-colors cursor-pointer"
                >
                  Start Polling
                </button>
              ) : (
                <button
                  onClick={onStopPolling}
                  className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg transition-colors cursor-pointer"
                >
                  Stop Polling
                </button>
              )}
            </div>
          </>
        )}

        {/* Last update timestamp */}
        {lastUpdate && (
          <span className="text-xs text-[var(--color-text-muted)] ml-auto">
            Last: {lastUpdate.toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Scan progress */}
      {scanStatus && (
        <div className="flex items-center gap-2 text-sm text-purple-300">
          <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          {scanStatus}
        </div>
      )}

      {/* Detected ports summary / empty help */}
      {isDisconnected && !isScanning && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {detectedPorts.length > 0 ? (
            <>
              <span className="text-[var(--color-text-muted)]">
                {detectedPorts.length} port{detectedPorts.length !== 1 ? 's' : ''} available
              </span>
              {bmsPort && (
                <span className="px-2 py-0.5 bg-emerald-900/40 text-emerald-300 border border-emerald-700 rounded-full">
                  BMS detected: {bmsPort.label}
                </span>
              )}
              {!bmsPort && detectedPorts.some((p) => p.vendorId) && (
                <span className="text-[var(--color-text-muted)]">
                  — Click Autodetect to probe for BMS
                </span>
              )}
            </>
          ) : (
            <span className="text-[var(--color-text-muted)]">
              No ports granted yet — click <strong className="text-[var(--color-text)]">Autodetect</strong> to select your serial port and scan for a JBD BMS, or <strong className="text-[var(--color-text)]">Pick Port...</strong> to connect manually.
            </span>
          )}
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="px-3 py-2 bg-red-900/30 border border-red-800 rounded-lg text-sm text-red-300">
          {error}
        </div>
      )}
    </div>
  );
}
