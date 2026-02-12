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
              className="w-7 h-7 text-orange-500"
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

        {/* Footer */}
        <footer className="border-t border-[var(--color-border)] py-4 flex items-center justify-center gap-4 text-xs text-[var(--color-text-muted)]">
          <a
            href="mailto:luke.b.dempsey@gmail.com"
            className="hover:text-[var(--color-text)] transition-colors"
          >
            luke.b.dempsey@gmail.com
          </a>
          <span className="opacity-30">|</span>
          <a
            href="https://github.com/lukedempsey/jbd-ui-tool"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 hover:text-[var(--color-text)] transition-colors"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            GitHub
          </a>
        </footer>
      </div>

      {/* Serial traffic console (bottom panel) */}
      <TrafficConsole />
    </div>
  );
}
