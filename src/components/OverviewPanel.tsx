import type { BMSHardwareInfo, BMSCellInfo } from '../lib/jbd-protocol';

interface Props {
  hardware: BMSHardwareInfo | null;
  cells: BMSCellInfo | null;
  version: string | null;
}

function StatCard({
  label,
  value,
  unit,
  color = 'text-white',
  sub,
}: {
  label: string;
  value: string;
  unit: string;
  color?: string;
  sub?: string;
}) {
  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4 flex flex-col">
      <span className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
        {label}
      </span>
      <div className="mt-1 flex items-baseline gap-1">
        <span className={`text-2xl font-bold ${color}`}>{value}</span>
        <span className="text-sm text-[var(--color-text-muted)]">{unit}</span>
      </div>
      {sub && <span className="text-xs text-[var(--color-text-muted)] mt-1">{sub}</span>}
    </div>
  );
}

function SOCGauge({ rsoc }: { rsoc: number }) {
  const circumference = 2 * Math.PI * 52;
  const offset = circumference - (rsoc / 100) * circumference;
  const color =
    rsoc > 60 ? '#22c55e' : rsoc > 30 ? '#f59e0b' : '#ef4444';

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4 flex flex-col items-center justify-center">
      <span className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
        State of Charge
      </span>
      <div className="relative w-32 h-32">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
          <circle
            cx="60"
            cy="60"
            r="52"
            fill="none"
            stroke="var(--color-surface-light)"
            strokeWidth="8"
          />
          <circle
            cx="60"
            cy="60"
            r="52"
            fill="none"
            stroke={color}
            strokeWidth="8"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className="transition-all duration-700 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold" style={{ color }}>
            {rsoc}
          </span>
          <span className="text-xs text-[var(--color-text-muted)]">%</span>
        </div>
      </div>
    </div>
  );
}

export function OverviewPanel({ hardware, version }: Props) {
  if (!hardware) {
    return (
      <div className="flex items-center justify-center h-64 text-[var(--color-text-muted)]">
        <div className="text-center">
          <svg className="w-16 h-16 mx-auto mb-4 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <p className="text-lg">Connect to a BMS and read data to begin</p>
        </div>
      </div>
    );
  }

  const currentColor =
    hardware.current > 0
      ? 'text-emerald-400'
      : hardware.current < 0
        ? 'text-orange-400'
        : 'text-white';

  const currentLabel = hardware.current > 0 ? 'Charging' : hardware.current < 0 ? 'Discharging' : 'Idle';

  const { year, month, day } = hardware.manufactureDate;

  return (
    <div className="space-y-4">
      {/* Version banner */}
      {version && (
        <div className="text-xs text-[var(--color-text-muted)] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-3 py-2">
          Hardware: <span className="text-[var(--color-text)] font-medium">{version}</span>
          <span className="mx-2">|</span>
          Cells: <span className="text-[var(--color-text)] font-medium">{hardware.cellCount}S</span>
          <span className="mx-2">|</span>
          Version: <span className="text-[var(--color-text)] font-medium">0x{hardware.version.toString(16).padStart(2, '0')}</span>
          <span className="mx-2">|</span>
          Date: <span className="text-[var(--color-text)] font-medium">{year}-{String(month).padStart(2, '0')}-{String(day).padStart(2, '0')}</span>
        </div>
      )}

      {/* Main stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <SOCGauge rsoc={hardware.rsoc} />

        <StatCard
          label="Pack Voltage"
          value={hardware.voltage.toFixed(2)}
          unit="V"
          color="text-blue-400"
        />

        <StatCard
          label="Current"
          value={Math.abs(hardware.current).toFixed(2)}
          unit="A"
          color={currentColor}
          sub={currentLabel}
        />

        <StatCard
          label="Remaining"
          value={hardware.remainingCapacity.toFixed(2)}
          unit="Ah"
          sub={`/ ${hardware.fullCapacity.toFixed(2)} Ah`}
        />

        <StatCard
          label="Cycles"
          value={hardware.cycles.toString()}
          unit=""
          color="text-purple-400"
        />
      </div>

      {/* Temperatures */}
      {hardware.temperatures.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          {hardware.temperatures.map((temp, i) => {
            const tempColor =
              temp > 45 ? 'text-red-400' : temp > 35 ? 'text-amber-400' : temp < 5 ? 'text-blue-400' : 'text-emerald-400';
            return (
              <StatCard
                key={i}
                label={`Temp ${i + 1}`}
                value={temp.toFixed(1)}
                unit="°C"
                color={tempColor}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
