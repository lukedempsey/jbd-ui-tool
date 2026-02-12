import { useState } from 'react';
import { PROTECTION_FLAGS } from '../lib/jbd-protocol';
import type { BMSHardwareInfo } from '../lib/jbd-protocol';

interface Props {
  hardware: BMSHardwareInfo | null;
  onSetMosfet: (charge: boolean, discharge: boolean) => Promise<void>;
}

function ProtectionFlag({
  label,
  active,
}: {
  label: string;
  active: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
        active
          ? 'bg-red-900/40 border-red-700 text-red-300'
          : 'bg-[var(--color-surface-light)] border-[var(--color-border)] text-[var(--color-text-muted)]'
      }`}
    >
      <div
        className={`w-2.5 h-2.5 rounded-full ${
          active ? 'bg-red-500 animate-pulse' : 'bg-emerald-600'
        }`}
      />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function ProtectionPanel({ hardware, onSetMosfet }: Props) {
  const [mosLoading, setMosLoading] = useState(false);

  if (!hardware) {
    return (
      <div className="flex items-center justify-center h-64 text-[var(--color-text-muted)]">
        No data available
      </div>
    );
  }

  const hasProtection = hardware.protection !== 0;

  const handleMosfetToggle = async (
    type: 'charge' | 'discharge',
    newState: boolean
  ) => {
    setMosLoading(true);
    try {
      if (type === 'charge') {
        await onSetMosfet(newState, hardware.dischargeEnabled);
      } else {
        await onSetMosfet(hardware.chargeEnabled, newState);
      }
    } finally {
      setMosLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* MOSFET Control */}
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4">
        <h3 className="text-sm font-medium text-[var(--color-text-muted)] mb-4 uppercase tracking-wider">
          MOSFET Control
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Charge MOSFET */}
          <div className="flex items-center justify-between p-4 rounded-lg bg-[var(--color-surface-light)] border border-[var(--color-border)]">
            <div>
              <div className="font-medium">Charge MOSFET</div>
              <div className={`text-sm ${hardware.chargeEnabled ? 'text-emerald-400' : 'text-red-400'}`}>
                {hardware.chargeEnabled ? 'Enabled' : 'Disabled'}
              </div>
            </div>
            <button
              disabled={mosLoading}
              onClick={() =>
                handleMosfetToggle('charge', !hardware.chargeEnabled)
              }
              className={`relative w-14 h-7 rounded-full transition-colors cursor-pointer ${
                hardware.chargeEnabled
                  ? 'bg-emerald-600'
                  : 'bg-gray-600'
              } ${mosLoading ? 'opacity-50' : ''}`}
            >
              <div
                className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow-md transition-transform ${
                  hardware.chargeEnabled
                    ? 'translate-x-7.5'
                    : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>

          {/* Discharge MOSFET */}
          <div className="flex items-center justify-between p-4 rounded-lg bg-[var(--color-surface-light)] border border-[var(--color-border)]">
            <div>
              <div className="font-medium">Discharge MOSFET</div>
              <div className={`text-sm ${hardware.dischargeEnabled ? 'text-emerald-400' : 'text-red-400'}`}>
                {hardware.dischargeEnabled ? 'Enabled' : 'Disabled'}
              </div>
            </div>
            <button
              disabled={mosLoading}
              onClick={() =>
                handleMosfetToggle('discharge', !hardware.dischargeEnabled)
              }
              className={`relative w-14 h-7 rounded-full transition-colors cursor-pointer ${
                hardware.dischargeEnabled
                  ? 'bg-emerald-600'
                  : 'bg-gray-600'
              } ${mosLoading ? 'opacity-50' : ''}`}
            >
              <div
                className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow-md transition-transform ${
                  hardware.dischargeEnabled
                    ? 'translate-x-7.5'
                    : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Protection Status */}
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
            Protection Status
          </h3>
          {hasProtection ? (
            <span className="px-2 py-0.5 text-xs font-medium bg-red-900/50 text-red-300 border border-red-700 rounded-full">
              ACTIVE
            </span>
          ) : (
            <span className="px-2 py-0.5 text-xs font-medium bg-emerald-900/50 text-emerald-300 border border-emerald-700 rounded-full">
              CLEAR
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {PROTECTION_FLAGS.map((flag) => (
            <ProtectionFlag
              key={flag.key}
              label={flag.label}
              active={hardware.protectionFlags[flag.key] ?? false}
            />
          ))}
        </div>
      </div>

      {/* Raw values */}
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4">
        <h3 className="text-sm font-medium text-[var(--color-text-muted)] mb-3 uppercase tracking-wider">
          Raw Values
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm font-mono">
          <div>
            <span className="text-[var(--color-text-muted)]">Protection: </span>
            <span>0x{hardware.protection.toString(16).padStart(4, '0')}</span>
          </div>
          <div>
            <span className="text-[var(--color-text-muted)]">FET State: </span>
            <span>0x{hardware.fetState.toString(16).padStart(2, '0')}</span>
          </div>
          <div>
            <span className="text-[var(--color-text-muted)]">Balance Lo: </span>
            <span>0x{hardware.balanceLow.toString(16).padStart(4, '0')}</span>
          </div>
          <div>
            <span className="text-[var(--color-text-muted)]">Balance Hi: </span>
            <span>0x{hardware.balanceHigh.toString(16).padStart(4, '0')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
