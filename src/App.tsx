import { useState } from 'react';
import { useBMS } from './hooks/useBMS';
import { ConnectionBar } from './components/ConnectionBar';
import { OverviewPanel } from './components/OverviewPanel';
import { CellsPanel } from './components/CellsPanel';
import { ProtectionPanel } from './components/ProtectionPanel';
import { ConfigPanel } from './components/ConfigPanel';
import { TrafficConsole } from './components/TrafficConsole';
import { DecoderPanel } from './components/DecoderPanel';

type Tab = 'overview' | 'cells' | 'protection' | 'config' | 'decoder';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'overview', label: 'Overview', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
  {
    id: 'cells',
    label: 'Cells',
    icon: 'M4 6h4v12H4zM10 3h4v15h-4zM16 8h4v10h-4z',
  },
  {
    id: 'protection',
    label: 'Protection & FET',
    icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
  },
  {
    id: 'config',
    label: 'Configuration',
    icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
  },
  {
    id: 'decoder',
    label: 'Decoder',
    icon: 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4',
  },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const bms = useBMS();

  return (
    <div className="min-h-screen bg-[var(--color-bg)]">
      {/* Header */}
      <header className="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="flex items-center gap-2">
            <svg
              className="w-7 h-7 text-[var(--color-primary)]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
            <h1 className="text-lg font-bold text-[var(--color-text)]">
              JBD BMS Monitor
            </h1>
          </div>
          <span className="text-xs text-[var(--color-text-muted)] bg-[var(--color-surface-light)] px-2 py-0.5 rounded-full">
            Web Serial
          </span>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-4 space-y-4">
        {/* Connection bar */}
        <ConnectionBar
          connectionState={bms.connectionState}
          isPolling={bms.isPolling}
          lastUpdate={bms.lastUpdate}
          error={bms.error}
          isSupported={bms.isSupported}
          detectedPorts={bms.detectedPorts}
          isScanning={bms.isScanning}
          scanStatus={bms.scanStatus}
          onConnect={bms.connect}
          onConnectToPort={bms.connectToPort}
          onDisconnect={bms.disconnect}
          onStartPolling={bms.startPolling}
          onStopPolling={bms.stopPolling}
          onReadOnce={bms.readAll}
          onAutodetect={bms.autodetect}
          onRefreshPorts={bms.refreshPorts}
        />

        {/* Tab navigation */}
        <div className="flex gap-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                activeTab === tab.id
                  ? 'bg-[var(--color-primary)] text-white'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-light)]'
              }`}
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d={tab.icon}
                />
              </svg>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="pb-16">
          {activeTab === 'overview' && (
            <OverviewPanel
              hardware={bms.hardware}
              cells={bms.cells}
              version={bms.version}
            />
          )}
          {activeTab === 'cells' && (
            <CellsPanel hardware={bms.hardware} cells={bms.cells} />
          )}
          {activeTab === 'protection' && (
            <ProtectionPanel
              hardware={bms.hardware}
              onSetMosfet={bms.setMosfet}
            />
          )}
          {activeTab === 'config' && (
            <ConfigPanel
              config={bms.config}
              isConnected={bms.connectionState === 'connected'}
              onReadConfig={bms.readConfig}
              onWriteRegister={bms.writeRegister}
              onWriteTempRegister={bms.writeTempRegister}
            />
          )}
          {activeTab === 'decoder' && <DecoderPanel />}
        </div>
      </div>

      {/* Serial traffic console (bottom panel) */}
      <TrafficConsole />
    </div>
  );
}
