import { useState, useMemo } from 'react';
import {
  JBD_CMD_READ,
  JBD_CMD_WRITE,
} from '../lib/jbd-protocol';
import {
  decodePacket,
  splitPackets,
  type DecodeResult,
  type Field,
} from '../lib/jbd-decoder';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Detect if the input looks like a C-style escaped string.
 * Matches patterns like \xDD, \0, \n, or raw ASCII mixed in.
 */
function looksLikeCEscaped(input: string): boolean {
  return /\\x[0-9a-fA-F]{2}/.test(input) || /\\0/.test(input);
}

/**
 * Parse a C-style escaped string into bytes.
 * Handles: \xNN (hex byte), \0 (null), \n \r \t \\ (standard escapes),
 * and literal ASCII characters (e.g. 'w' = 0x77, 'Z' = 0x5A).
 */
function parseCEscaped(input: string): Uint8Array | null {
  const bytes: number[] = [];
  let i = 0;
  while (i < input.length) {
    if (input[i] === '\\') {
      if (i + 1 >= input.length) {
        // trailing backslash — skip it
        i++;
        continue;
      }
      const next = input[i + 1];
      if (next === 'x' || next === 'X') {
        // \xNN
        if (i + 3 < input.length) {
          const hexPart = input.substring(i + 2, i + 4);
          if (/^[0-9a-fA-F]{2}$/.test(hexPart)) {
            bytes.push(parseInt(hexPart, 16));
            i += 4;
            continue;
          }
        }
        // malformed \x — skip
        i += 2;
      } else if (next === '0') {
        bytes.push(0);
        i += 2;
      } else if (next === 'n') {
        bytes.push(0x0a);
        i += 2;
      } else if (next === 'r') {
        bytes.push(0x0d);
        i += 2;
      } else if (next === 't') {
        bytes.push(0x09);
        i += 2;
      } else if (next === '\\') {
        bytes.push(0x5c);
        i += 2;
      } else {
        // unknown escape — treat backslash as literal
        bytes.push(input.charCodeAt(i));
        i++;
      }
    } else {
      bytes.push(input.charCodeAt(i) & 0xff);
      i++;
    }
  }
  return bytes.length > 0 ? new Uint8Array(bytes) : null;
}

/** Parse a hex string into bytes. Accepts "DD A5 03 00 FF C9 77", "DD:A5:03", or "DDA50300FFC977". */
function parseHexInput(input: string): Uint8Array | null {
  const cleaned = input.trim();
  if (!cleaned) return null;

  // Try C-style escaped string first
  if (looksLikeCEscaped(cleaned)) {
    return parseCEscaped(cleaned);
  }

  let hexStr: string;
  if (cleaned.includes(' ') || cleaned.includes(':') || cleaned.includes('\t')) {
    hexStr = cleaned.replace(/[\s:,\t]+/g, '');
  } else {
    hexStr = cleaned;
  }

  // strip leading "0x" if present
  hexStr = hexStr.replace(/^0x/i, '');

  if (!/^[0-9a-fA-F]+$/.test(hexStr)) return null;
  if (hexStr.length % 2 !== 0) return null;

  const bytes = new Uint8Array(hexStr.length / 2);
  for (let i = 0; i < hexStr.length; i += 2) {
    bytes[i / 2] = parseInt(hexStr.substring(i, i + 2), 16);
  }
  return bytes;
}

// ── Examples ─────────────────────────────────────────────────────────────────

const EXAMPLES = [
  {
    label: 'Read HWINFO request',
    hex: 'DD A5 03 00 FF FC 77',
  },
  {
    label: 'Read CELLINFO request',
    hex: 'DD A5 04 00 FF FB 77',
  },
  {
    label: 'MOSFET control (all on)',
    hex: 'DD 5A E1 02 00 00 FF 1D 77',
  },
  {
    label: 'C-escaped (multi-packet)',
    hex: '\\xDD\\xA5\\x10\\0\\xFF\\xF0w\\xDD\\x10\\0\\x02\\x0B\\xB8\\xFF;w',
  },
];

// ── Component ────────────────────────────────────────────────────────────────

interface DecodedPacket {
  bytes: Uint8Array;
  result: DecodeResult;
}

export function DecoderPanel() {
  const [input, setInput] = useState('');

  const { bytes, packets, detectedFormat } = useMemo(() => {
    const raw = parseHexInput(input);
    if (!raw || raw.length === 0) return { bytes: null, packets: [] as DecodedPacket[], detectedFormat: '' };

    const fmt = looksLikeCEscaped(input.trim()) ? 'C-escaped string' : 'hex';
    const split = splitPackets(raw);
    const decoded = split.map((pktBytes) => ({
      bytes: pktBytes,
      result: decodePacket(pktBytes),
    }));

    return { bytes: raw, packets: decoded, detectedFormat: fmt };
  }, [input]);

  return (
    <div className="space-y-4">
      {/* Input area */}
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4">
        <label className="block text-sm font-medium text-[var(--color-text)] mb-2">
          Paste hex bytes or escaped string from the serial console
        </label>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={'e.g. DD A5 03 00 FF FC 77\n  or  \\xDD\\xA5\\x03\\0\\xFF\\xF0w\n  or  DDA50300FFFC77'}
          spellCheck={false}
          className="w-full h-24 px-3 py-2 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-text)] font-mono text-sm placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] resize-y"
        />
        <div className="flex items-center flex-wrap gap-2 mt-2">
          <span className="text-xs text-[var(--color-text-muted)]">Examples:</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex.label}
              onClick={() => setInput(ex.hex)}
              className="text-xs px-2 py-1 rounded bg-[var(--color-surface-light)] text-[var(--color-primary)] hover:bg-[var(--color-border)] transition-colors cursor-pointer"
            >
              {ex.label}
            </button>
          ))}
          {input && (
            <button
              onClick={() => setInput('')}
              className="text-xs px-2 py-1 rounded bg-[var(--color-surface-light)] text-[var(--color-text-muted)] hover:bg-[var(--color-border)] transition-colors cursor-pointer ml-auto"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Parse error */}
      {input.trim() && !bytes && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-600 text-sm">
          Could not parse input. Supported formats: space/colon-separated hex bytes, continuous hex string, or C-style escaped strings (<code className="bg-red-100 px-1 rounded">\xDD\xA5...</code>).
        </div>
      )}

      {/* Format detection + total bytes */}
      {bytes && bytes.length > 0 && (
        <div className="flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
          <span>Detected format: <span className="text-[var(--color-text)] font-medium">{detectedFormat}</span></span>
          <span>{bytes.length} total bytes</span>
          {packets.length > 1 && (
            <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded font-medium">
              {packets.length} packets found
            </span>
          )}
        </div>
      )}

      {/* Decode results — one card per packet */}
      {packets.map((pkt, pktIdx) => (
        <div key={pktIdx} className="space-y-3">
          {/* Packet header when multiple */}
          {packets.length > 1 && (
            <div className="flex items-center gap-2 pt-2">
              <span className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">
                Packet {pktIdx + 1} of {packets.length}
              </span>
              <span className="flex-1 border-t border-[var(--color-border)]" />
            </div>
          )}

          {/* Byte visualization */}
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4">
            <h3 className="text-sm font-medium text-[var(--color-text)] mb-2">
              {packets.length > 1 ? `Packet ${pktIdx + 1}` : 'Packet'} Bytes ({pkt.bytes.length})
            </h3>
            <ByteVisualization bytes={pkt.bytes} />
          </div>

          {/* Summary */}
          <div
            className={`rounded-xl p-4 border ${
              pkt.result.valid
                ? 'bg-emerald-50 border-emerald-200'
                : 'bg-amber-50 border-amber-200'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span
                className={`px-2 py-0.5 text-[10px] font-bold rounded ${
                  pkt.result.type === 'request'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-blue-600 text-white'
                }`}
              >
                {pkt.result.type === 'request' ? 'TX REQUEST' : 'RX RESPONSE'}
              </span>
              {pkt.result.valid ? (
                <span className="text-emerald-600 text-xs font-medium">Valid</span>
              ) : (
                <span className="text-amber-600 text-xs font-medium">Issues found</span>
              )}
            </div>
            <p className="text-sm font-medium text-[var(--color-text)]">{pkt.result.summary}</p>
            {pkt.result.errors.length > 0 && (
              <ul className="mt-2 space-y-1">
                {pkt.result.errors.map((err, i) => (
                  <li key={i} className="text-xs text-red-600 flex items-start gap-1">
                    <span className="mt-0.5">&#x26A0;</span>
                    {err}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Packet fields */}
          {pkt.result.packetFields.length > 0 && (
            <FieldTable title="Packet Structure" fields={pkt.result.packetFields} />
          )}

          {/* Data fields */}
          {pkt.result.dataFields.length > 0 && (
            <FieldTable title="Decoded Data" fields={pkt.result.dataFields} />
          )}
        </div>
      ))}

      {/* Empty state */}
      {!input.trim() && (
        <div className="text-center py-12 text-[var(--color-text-muted)]">
          <svg
            className="w-12 h-12 mx-auto mb-3 opacity-30"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
            />
          </svg>
          <p className="text-sm">Paste a JBD protocol message above to decode it</p>
          <p className="text-xs mt-1 opacity-60">
            Supports hex bytes, C-escaped strings (<code className="opacity-80">\xDD\xA5...</code>), and multi-packet streams
          </p>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function ByteVisualization({ bytes }: { bytes: Uint8Array }) {
  // Color segments of the packet
  const getByteClass = (i: number): string => {
    if (i === 0) return 'bg-purple-100 text-purple-800'; // START
    if (i === bytes.length - 1) return 'bg-purple-100 text-purple-800'; // END

    const isRequest = bytes[1] === JBD_CMD_READ || bytes[1] === JBD_CMD_WRITE;

    if (i === 1) return isRequest ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'; // CMD or REG
    if (i === 2) return isRequest ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800'; // REG or STATUS
    if (i === 3) return 'bg-cyan-100 text-cyan-800'; // LEN

    const len = bytes[3];
    if (i >= 4 && i < 4 + len) return 'bg-slate-200 text-slate-700'; // DATA
    if (i === 4 + len || i === 5 + len) return 'bg-orange-100 text-orange-800'; // CRC

    return 'bg-[var(--color-surface-light)] text-[var(--color-text-muted)]';
  };

  const isRequest = bytes[1] === JBD_CMD_READ || bytes[1] === JBD_CMD_WRITE;
  const len = bytes.length >= 4 ? bytes[3] : 0;

  return (
    <div>
      <div className="flex flex-wrap gap-1">
        {Array.from(bytes).map((b, i) => (
          <span
            key={i}
            className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-mono font-medium ${getByteClass(i)}`}
            title={getByteLabel(i, bytes)}
          >
            {b.toString(16).padStart(2, '0').toUpperCase()}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-2 text-[10px]">
        <Legend color="bg-purple-100" label="Start/End" />
        {isRequest ? (
          <Legend color="bg-emerald-100" label="Command" />
        ) : null}
        <Legend color="bg-blue-100" label={isRequest ? 'Register' : 'Register'} />
        {!isRequest && <Legend color="bg-amber-100" label="Status" />}
        <Legend color="bg-cyan-100" label="Length" />
        {len > 0 && <Legend color="bg-slate-200" label="Data" />}
        <Legend color="bg-orange-100" label="CRC" />
      </div>
    </div>
  );
}

function getByteLabel(i: number, bytes: Uint8Array): string {
  if (i === 0) return 'Start byte (0xDD)';
  if (i === bytes.length - 1) return 'End byte (0x77)';
  const isRequest = bytes[1] === JBD_CMD_READ || bytes[1] === JBD_CMD_WRITE;
  if (i === 1) return isRequest ? 'Command' : 'Register';
  if (i === 2) return isRequest ? 'Register' : 'Status';
  if (i === 3) return 'Data length';
  const len = bytes[3];
  if (i >= 4 && i < 4 + len) return `Data byte ${i - 3}`;
  if (i === 4 + len) return 'CRC high';
  if (i === 5 + len) return 'CRC low';
  return '';
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1 text-[var(--color-text-muted)]">
      <span className={`inline-block w-2.5 h-2.5 rounded-sm ${color}`} />
      {label}
    </span>
  );
}

function FieldTable({ title, fields }: { title: string; fields: Field[] }) {
  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4">
      <h3 className="text-sm font-medium text-[var(--color-text)] mb-3">{title}</h3>
      <div className="space-y-0">
        {fields.map((f, i) => (
          <div
            key={i}
            className={`flex items-baseline gap-3 py-1.5 ${
              i < fields.length - 1 ? 'border-b border-[var(--color-border)]' : ''
            }`}
          >
            <span className="text-xs text-[var(--color-text-muted)] w-36 shrink-0">{f.label}</span>
            <span className="text-sm text-[var(--color-text)] font-mono">{f.value}</span>
            {f.detail && (
              <span className="text-xs text-[var(--color-text-muted)] italic">{f.detail}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
