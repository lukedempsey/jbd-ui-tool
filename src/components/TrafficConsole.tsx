import { useEffect, useMemo, useRef, useState } from 'react';
import { useTrafficLog } from '../hooks/useTrafficLog';
import { decodePacket } from '../lib/jbd-decoder';

export function TrafficConsole() {
  const { entries, paused, clear, togglePause } = useTrafficLog();
  const [open, setOpen] = useState(false);
  const [showAscii, setShowAscii] = useState(false);
  const [showDecoded, setShowDecoded] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  // Decode all entries (memoized so we only decode new ones)
  const decoded = useMemo(
    () => entries.map((e) => {
      try {
        if (e.data.length >= 7) return decodePacket(e.data);
      } catch { /* ignore */ }
      return null;
    }),
    [entries],
  );

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (!autoScrollRef.current || paused) return;
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [entries, paused]);

  // Detect manual scroll-up to disable auto-scroll
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    autoScrollRef.current = atBottom;
  };

  const txCount = entries.filter((e) => e.direction === 'TX').length;
  const rxCount = entries.filter((e) => e.direction === 'RX').length;

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return (
      d.toLocaleTimeString('en-US', { hour12: false }) +
      '.' +
      String(d.getMilliseconds()).padStart(3, '0')
    );
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 flex flex-col" style={{ maxHeight: open ? '50vh' : undefined }}>
      {/* Toggle bar */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-between px-4 py-2 bg-slate-100 border-t border-[var(--color-border)] text-xs cursor-pointer hover:bg-slate-200 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="font-medium text-[var(--color-text)]">Serial Console</span>
          <span className="text-emerald-600">TX {txCount}</span>
          <span className="text-blue-600">RX {rxCount}</span>
          {paused && (
            <span className="px-1.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded text-[10px] font-medium">
              PAUSED
            </span>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-[var(--color-text-muted)] transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
        </svg>
      </button>

      {/* Console body */}
      {open && (
        <div className="flex flex-col bg-slate-50 border-t border-[var(--color-border)]" style={{ height: '40vh' }}>
          {/* Toolbar */}
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--color-border)] bg-slate-100">
            <button
              onClick={togglePause}
              className={`px-2.5 py-1 text-[11px] font-medium rounded cursor-pointer transition-colors ${
                paused
                  ? 'bg-emerald-700 hover:bg-emerald-600 text-white'
                  : 'bg-amber-700 hover:bg-amber-600 text-white'
              }`}
            >
              {paused ? 'Resume' : 'Pause'}
            </button>
            <button
              onClick={clear}
              className="px-2.5 py-1 text-[11px] font-medium rounded bg-[var(--color-surface-light)] hover:bg-[var(--color-border)] text-[var(--color-text-muted)] cursor-pointer transition-colors"
            >
              Clear
            </button>
            <label className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)] cursor-pointer ml-2">
              <input
                type="checkbox"
                checked={showDecoded}
                onChange={(e) => setShowDecoded(e.target.checked)}
                className="accent-[var(--color-primary)]"
              />
              Decoded
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)] cursor-pointer">
              <input
                type="checkbox"
                checked={showAscii}
                onChange={(e) => setShowAscii(e.target.checked)}
                className="accent-[var(--color-primary)]"
              />
              ASCII
            </label>
            <span className="ml-auto text-[10px] text-[var(--color-text-muted)]">
              {entries.length} entries (max {500})
            </span>
          </div>

          {/* Log entries */}
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto overflow-x-hidden font-mono text-[11px] leading-[18px]"
          >
            {entries.length === 0 ? (
              <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-xs">
                No traffic yet — connect and read from BMS to see raw data
              </div>
            ) : (
              <table className="w-full">
                <tbody>
                  {entries.map((entry, i) => {
                    const result = decoded[i];
                    return (
                      <tr
                        key={i}
                        className={`border-b border-slate-200 hover:bg-slate-100 ${
                          entry.direction === 'TX' ? 'text-emerald-700' : 'text-blue-700'
                        }`}
                      >
                        {/* Timestamp */}
                        <td className="px-2 py-0.5 text-[var(--color-text-muted)] whitespace-nowrap w-[90px] align-top">
                          {formatTime(entry.timestamp)}
                        </td>
                        {/* Direction */}
                        <td className="px-2 py-0.5 font-bold whitespace-nowrap w-[28px] align-top">
                          {entry.direction}
                        </td>
                        {/* Length */}
                        <td className="px-2 py-0.5 text-[var(--color-text-muted)] whitespace-nowrap w-[40px] align-top">
                          [{entry.data.length}]
                        </td>
                        {/* Hex data + decoded */}
                        <td className="px-2 py-0.5 break-all">
                          <span>{entry.hex}</span>
                          {showAscii && (
                            <span className="ml-3 text-[var(--color-text-muted)]">
                              | {entry.ascii}
                            </span>
                          )}
                          {showDecoded && result && (
                            <div className="mt-0.5 text-[10px] text-[var(--color-text-muted)] leading-tight">
                              <span className={`font-semibold ${result.valid ? 'text-[var(--color-text)]' : 'text-red-500'}`}>
                                {result.summary}
                              </span>
                              {result.dataFields.length > 0 && (
                                <span className="ml-1.5">
                                  — {result.dataFields.slice(0, 4).map((f) => `${f.label}: ${f.value}`).join(', ')}
                                  {result.dataFields.length > 4 && ` (+${result.dataFields.length - 4} more)`}
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
