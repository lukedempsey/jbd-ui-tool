import type { BMSHardwareInfo, BMSCellInfo } from '../lib/jbd-protocol';

interface Props {
  hardware: BMSHardwareInfo | null;
  cells: BMSCellInfo | null;
}

export function CellsPanel({ hardware, cells }: Props) {
  if (!cells || !hardware) {
    return (
      <div className="flex items-center justify-center h-64 text-[var(--color-text-muted)]">
        No cell data available
      </div>
    );
  }

  const voltages = cells.cellVoltages;
  const minV = Math.min(...voltages);
  const maxV = Math.max(...voltages);
  const avgV = voltages.reduce((a, b) => a + b, 0) / voltages.length;
  const delta = maxV - minV;

  // Color scale based on deviation from average
  const getCellColor = (v: number) => {
    if (v === maxV && delta > 0.01) return '#f59e0b'; // highest
    if (v === minV && delta > 0.01) return '#3b82f6'; // lowest
    return '#22c55e'; // normal
  };

  // Bar height as percentage of range
  const barMin = Math.max(0, minV - 0.05);
  const barMax = maxV + 0.05;
  const barRange = barMax - barMin;

  const getBalanceBit = (index: number): boolean => {
    if (index < 16) {
      return (hardware.balanceLow & (1 << index)) !== 0;
    }
    return (hardware.balanceHigh & (1 << (index - 16))) !== 0;
  };

  return (
    <div className="space-y-4">
      {/* Summary row */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-3">
          <span className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider">Min</span>
          <div className="text-lg font-bold text-blue-600">{(minV * 1000).toFixed(0)} mV</div>
        </div>
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-3">
          <span className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider">Max</span>
          <div className="text-lg font-bold text-amber-600">{(maxV * 1000).toFixed(0)} mV</div>
        </div>
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-3">
          <span className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider">Average</span>
          <div className="text-lg font-bold text-emerald-600">{(avgV * 1000).toFixed(0)} mV</div>
        </div>
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-3">
          <span className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider">Delta</span>
          <div className={`text-lg font-bold ${delta > 0.05 ? 'text-red-600' : delta > 0.02 ? 'text-amber-600' : 'text-emerald-600'}`}>
            {(delta * 1000).toFixed(0)} mV
          </div>
        </div>
      </div>

      {/* Cell voltage bar chart */}
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4">
        <h3 className="text-sm font-medium text-[var(--color-text-muted)] mb-4 uppercase tracking-wider">
          Cell Voltages
        </h3>

        <div className="flex items-end gap-1.5" style={{ height: '200px' }}>
          {voltages.map((v, i) => {
            const heightPct = barRange > 0 ? ((v - barMin) / barRange) * 100 : 50;
            const isBalancing = getBalanceBit(i);
            const color = getCellColor(v);

            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-1 h-full">
                {/* Voltage label */}
                <span className="text-[10px] text-[var(--color-text-muted)] font-mono">
                  {(v * 1000).toFixed(0)}
                </span>

                {/* Bar container */}
                <div className="flex-1 w-full flex items-end">
                  <div
                    className="w-full rounded-t-sm transition-all duration-500 relative"
                    style={{
                      height: `${heightPct}%`,
                      backgroundColor: color,
                      opacity: 0.85,
                      minHeight: '4px',
                    }}
                  >
                    {isBalancing && (
                      <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-2 h-2 bg-yellow-400 rounded-full animate-pulse" />
                    )}
                  </div>
                </div>

                {/* Cell number */}
                <span className="text-[10px] text-[var(--color-text-muted)]">
                  {i + 1}
                </span>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 mt-3 text-xs text-[var(--color-text-muted)]">
          <div className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-500" /> Lowest
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Normal
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-full bg-amber-500" /> Highest
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" /> Balancing
          </div>
        </div>
      </div>

      {/* Cell table */}
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[var(--color-surface-light)]">
              <th className="text-left px-4 py-2 text-xs font-medium text-[var(--color-text-muted)] uppercase">Cell</th>
              <th className="text-right px-4 py-2 text-xs font-medium text-[var(--color-text-muted)] uppercase">Voltage</th>
              <th className="text-right px-4 py-2 text-xs font-medium text-[var(--color-text-muted)] uppercase">Diff from Avg</th>
              <th className="text-center px-4 py-2 text-xs font-medium text-[var(--color-text-muted)] uppercase">Balance</th>
            </tr>
          </thead>
          <tbody>
            {voltages.map((v, i) => {
              const diff = v - avgV;
              const diffColor = Math.abs(diff) > 0.02 ? (diff > 0 ? 'text-amber-600' : 'text-blue-600') : 'text-[var(--color-text-muted)]';
              return (
                <tr key={i} className="border-t border-[var(--color-border)] hover:bg-[var(--color-surface-light)]/50">
                  <td className="px-4 py-2 font-medium">Cell {i + 1}</td>
                  <td className="px-4 py-2 text-right font-mono">{(v * 1000).toFixed(0)} mV</td>
                  <td className={`px-4 py-2 text-right font-mono ${diffColor}`}>
                    {diff >= 0 ? '+' : ''}{(diff * 1000).toFixed(1)} mV
                  </td>
                  <td className="px-4 py-2 text-center">
                    {getBalanceBit(i) ? (
                      <span className="inline-block w-2 h-2 bg-yellow-400 rounded-full animate-pulse" />
                    ) : (
                      <span className="text-[var(--color-text-muted)]">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
