import { useState, useMemo } from 'react';
import {
  JBD_START,
  JBD_END,
  JBD_CMD_READ,
  JBD_CMD_WRITE,
  JBD_CMD_HWINFO,
  JBD_CMD_CELLINFO,
  JBD_CMD_HWVER,
  JBD_CMD_MOS,
  JBD_REG_EEPROM,
  JBD_REG_CONFIG,
  JBD_REG,
  PROTECTION_FLAGS,
  calcCRC,
  decodeHardwareInfo,
  decodeCellInfo,
  decodeTemp,
  decodeDate,
  decodeString,
} from '../lib/jbd-protocol';

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

/**
 * Split a raw byte stream into individual JBD packets.
 * Packets start with 0xDD and end with 0x77. Uses the length field
 * at byte[3] to determine packet boundaries precisely.
 */
function splitPackets(bytes: Uint8Array): Uint8Array[] {
  const packets: Uint8Array[] = [];
  let i = 0;

  while (i < bytes.length) {
    // Scan for next 0xDD start byte
    if (bytes[i] !== JBD_START) {
      i++;
      continue;
    }

    // Need at least 7 bytes for a minimal packet
    if (i + 6 >= bytes.length) {
      // Remaining bytes form an incomplete packet — include as-is
      packets.push(bytes.slice(i));
      break;
    }

    const len = bytes[i + 3];
    const pktLen = 7 + len; // DD + byte1 + byte2 + LEN + data[len] + CRC_H + CRC_L + 0x77

    if (i + pktLen <= bytes.length) {
      packets.push(bytes.slice(i, i + pktLen));
      i += pktLen;
    } else {
      // Incomplete packet at end
      packets.push(bytes.slice(i));
      break;
    }
  }

  return packets;
}

function hex(byte: number): string {
  return '0x' + byte.toString(16).padStart(2, '0').toUpperCase();
}

function hexArr(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join(' ');
}

// Reverse lookup register name from number
const REG_NAMES: Record<number, string> = {};
for (const [name, num] of Object.entries(JBD_REG)) {
  REG_NAMES[num] = name;
}

function getRegisterName(reg: number): string {
  if (reg === JBD_CMD_HWINFO) return 'HWINFO (0x03)';
  if (reg === JBD_CMD_CELLINFO) return 'CELLINFO (0x04)';
  if (reg === JBD_CMD_HWVER) return 'HWVER (0x05)';
  if (REG_NAMES[reg]) return `${REG_NAMES[reg]} (${hex(reg)})`;
  return hex(reg);
}

// ── Decode result types ──────────────────────────────────────────────────────

interface Field {
  label: string;
  value: string;
  detail?: string;
}

interface DecodeResult {
  type: 'request' | 'response';
  valid: boolean;
  errors: string[];
  summary: string;
  fields: Field[];
  packetFields: Field[];
  dataFields: Field[];
}

// ── Packet decoder ───────────────────────────────────────────────────────────

function decodePacket(bytes: Uint8Array): DecodeResult {
  const errors: string[] = [];

  if (bytes.length < 7) {
    return {
      type: 'response',
      valid: false,
      errors: ['Packet too short (minimum 7 bytes)'],
      summary: 'Invalid packet',
      fields: [],
      packetFields: [],
      dataFields: [],
    };
  }

  // Check framing
  if (bytes[0] !== JBD_START) {
    errors.push(`Expected start byte ${hex(JBD_START)}, got ${hex(bytes[0])}`);
  }
  if (bytes[bytes.length - 1] !== JBD_END) {
    errors.push(`Expected end byte ${hex(JBD_END)}, got ${hex(bytes[bytes.length - 1])}`);
  }

  const byte1 = bytes[1];
  const isRequest = byte1 === JBD_CMD_READ || byte1 === JBD_CMD_WRITE;

  if (isRequest) {
    return decodeRequest(bytes, errors);
  } else {
    return decodeResponse(bytes, errors);
  }
}

function decodeRequest(bytes: Uint8Array, errors: string[]): DecodeResult {
  const cmd = bytes[1];
  const reg = bytes[2];
  const len = bytes[3];
  const isWrite = cmd === JBD_CMD_WRITE;

  const packetFields: Field[] = [
    { label: 'Start', value: hex(bytes[0]) },
    { label: 'Command', value: isWrite ? 'WRITE (0x5A)' : 'READ (0xA5)' },
    { label: 'Register', value: getRegisterName(reg) },
    { label: 'Data Length', value: `${len} bytes` },
  ];

  const expectedLen = 7 + len;
  if (bytes.length < expectedLen) {
    errors.push(`Packet too short: expected ${expectedLen} bytes, got ${bytes.length}`);
  }

  const data = bytes.slice(4, 4 + len);
  if (len > 0) {
    packetFields.push({ label: 'Data', value: hexArr(data) });
  }

  // CRC check
  const crcPayload = bytes.slice(2, 4 + len);
  const expectedCrc = calcCRC(crcPayload);
  const actualCrc = (bytes[4 + len] << 8) | bytes[5 + len];
  packetFields.push({
    label: 'CRC',
    value: `${hex(actualCrc >> 8)} ${hex(actualCrc & 0xff)}`,
    detail: expectedCrc === actualCrc ? 'Valid' : `INVALID — expected ${hex(expectedCrc >> 8)} ${hex(expectedCrc & 0xff)}`,
  });
  packetFields.push({ label: 'End', value: hex(bytes[bytes.length - 1]) });

  if (expectedCrc !== actualCrc) {
    errors.push('CRC mismatch');
  }

  // Decode data content for writes
  const dataFields: Field[] = [];
  if (isWrite && len > 0) {
    decodeWriteData(reg, data, dataFields);
  }

  const summary = isWrite
    ? `Write to ${getRegisterName(reg)}${len > 0 ? ` — ${len} byte(s)` : ''}`
    : `Read request for ${getRegisterName(reg)}`;

  return {
    type: 'request',
    valid: errors.length === 0,
    errors,
    summary,
    fields: [],
    packetFields,
    dataFields,
  };
}

function decodeResponse(bytes: Uint8Array, errors: string[]): DecodeResult {
  const reg = bytes[1];
  const status = bytes[2];
  const len = bytes[3];

  const packetFields: Field[] = [
    { label: 'Start', value: hex(bytes[0]) },
    { label: 'Register', value: getRegisterName(reg) },
    { label: 'Status', value: status === 0 ? '0x00 (OK)' : `${hex(status)} (ERROR)` },
    { label: 'Data Length', value: `${len} bytes` },
  ];

  const expectedLen = 7 + len;
  if (bytes.length < expectedLen) {
    errors.push(`Packet too short: expected ${expectedLen} bytes, got ${bytes.length}`);
  }

  if (status !== 0) {
    errors.push(`Response status indicates error: ${hex(status)}`);
  }

  const data = bytes.slice(4, 4 + len);
  if (len > 0) {
    packetFields.push({ label: 'Raw Data', value: hexArr(data) });
  }

  // CRC check
  const crcPayload = bytes.slice(2, 4 + len);
  const expectedCrc = calcCRC(crcPayload);
  const actualCrc = (bytes[4 + len] << 8) | bytes[5 + len];
  packetFields.push({
    label: 'CRC',
    value: `${hex(actualCrc >> 8)} ${hex(actualCrc & 0xff)}`,
    detail: expectedCrc === actualCrc ? 'Valid' : `INVALID — expected ${hex(expectedCrc >> 8)} ${hex(expectedCrc & 0xff)}`,
  });
  packetFields.push({ label: 'End', value: hex(bytes[bytes.length - 1]) });

  if (expectedCrc !== actualCrc) {
    errors.push('CRC mismatch');
  }

  // Decode response data
  const dataFields: Field[] = [];
  if (len > 0 && status === 0) {
    decodeResponseData(reg, data, dataFields);
  }

  const summary = `Response from ${getRegisterName(reg)}${status === 0 ? '' : ' (ERROR)'}`;

  return {
    type: 'response',
    valid: errors.length === 0,
    errors,
    summary,
    fields: [],
    packetFields,
    dataFields,
  };
}

// ── Data-level decoders ──────────────────────────────────────────────────────

function readUint16(data: Uint8Array, offset: number): number {
  return (data[offset] << 8) | data[offset + 1];
}

function decodeWriteData(reg: number, data: Uint8Array, fields: Field[]) {
  if (reg === JBD_REG_EEPROM && data.length === 2) {
    const val = readUint16(data, 0);
    if (val === 0x5678) {
      fields.push({ label: 'Action', value: 'Open EEPROM for writing' });
    } else {
      fields.push({ label: 'EEPROM Command', value: `0x${val.toString(16).toUpperCase()}` });
    }
    return;
  }
  if (reg === JBD_REG_CONFIG && data.length === 2) {
    const val = readUint16(data, 0);
    if (val === 0x0000) {
      fields.push({ label: 'Action', value: 'Close EEPROM (save config)' });
    } else {
      fields.push({ label: 'Config Command', value: `0x${val.toString(16).toUpperCase()}` });
    }
    return;
  }
  if (reg === JBD_CMD_MOS && data.length === 2) {
    const ctl = data[1];
    const chargeOff = (ctl & 0x01) !== 0;
    const dischargeOff = (ctl & 0x02) !== 0;
    fields.push({ label: 'Charge MOSFET', value: chargeOff ? 'OFF' : 'ON' });
    fields.push({ label: 'Discharge MOSFET', value: dischargeOff ? 'OFF' : 'ON' });
    return;
  }

  // Generic config register: show as uint16
  if (data.length === 2) {
    const val = readUint16(data, 0);
    fields.push({ label: 'Value (uint16)', value: `${val} (${hex(val >> 8)} ${hex(val & 0xff)})` });

    // Try to add context based on register
    addConfigContext(reg, val, fields);
  }

  // String registers
  if (reg === JBD_REG.ManufacturerName || reg === JBD_REG.DeviceName || reg === JBD_REG.BarCode) {
    fields.push({ label: 'Text', value: decodeString(data) });
  }
}

function decodeResponseData(reg: number, data: Uint8Array, fields: Field[]) {
  if (reg === JBD_CMD_HWINFO) {
    try {
      const info = decodeHardwareInfo(data);
      fields.push({ label: 'Pack Voltage', value: `${info.voltage.toFixed(2)} V` });
      fields.push({ label: 'Current', value: `${info.current.toFixed(2)} A`, detail: info.current > 0 ? 'Charging' : info.current < 0 ? 'Discharging' : 'Idle' });
      fields.push({ label: 'Remaining Capacity', value: `${info.remainingCapacity.toFixed(2)} Ah` });
      fields.push({ label: 'Full Capacity', value: `${info.fullCapacity.toFixed(2)} Ah` });
      fields.push({ label: 'SOC', value: `${info.rsoc}%` });
      fields.push({ label: 'Cycles', value: `${info.cycles}` });
      fields.push({ label: 'Cell Count', value: `${info.cellCount}` });
      fields.push({ label: 'Temp Sensors', value: `${info.tempCount}` });
      fields.push({
        label: 'Temperatures',
        value: info.temperatures.map((t) => `${t.toFixed(1)}°C`).join(', '),
      });
      fields.push({
        label: 'Manufacture Date',
        value: `${info.manufactureDate.year}-${String(info.manufactureDate.month).padStart(2, '0')}-${String(info.manufactureDate.day).padStart(2, '0')}`,
      });
      fields.push({ label: 'FW Version', value: `0x${info.version.toString(16).padStart(2, '0')}` });
      fields.push({ label: 'Charge FET', value: info.chargeEnabled ? 'ON' : 'OFF' });
      fields.push({ label: 'Discharge FET', value: info.dischargeEnabled ? 'ON' : 'OFF' });
      fields.push({
        label: 'Balance Low',
        value: `0x${info.balanceLow.toString(16).padStart(4, '0')}`,
        detail: info.balanceLow ? formatBalanceBits(info.balanceLow) : 'None',
      });
      fields.push({
        label: 'Balance High',
        value: `0x${info.balanceHigh.toString(16).padStart(4, '0')}`,
        detail: info.balanceHigh ? formatBalanceBits(info.balanceHigh) : 'None',
      });

      // Protection flags
      const active = PROTECTION_FLAGS.filter((f) => info.protectionFlags[f.key]);
      fields.push({
        label: 'Protection',
        value: active.length === 0 ? 'None' : `${active.length} active`,
        detail: active.length > 0 ? active.map((f) => f.label).join(', ') : undefined,
      });
    } catch {
      fields.push({ label: 'Error', value: 'Failed to decode hardware info' });
    }
    return;
  }

  if (reg === JBD_CMD_CELLINFO) {
    try {
      const info = decodeCellInfo(data);
      fields.push({ label: 'Cell Count', value: `${info.cellCount}` });
      for (let i = 0; i < info.cellCount; i++) {
        const v = info.cellVoltages[i];
        fields.push({ label: `Cell ${i + 1}`, value: `${v.toFixed(3)} V` });
      }
      if (info.cellCount > 1) {
        const min = Math.min(...info.cellVoltages);
        const max = Math.max(...info.cellVoltages);
        fields.push({ label: 'Delta (max-min)', value: `${((max - min) * 1000).toFixed(1)} mV` });
      }
    } catch {
      fields.push({ label: 'Error', value: 'Failed to decode cell info' });
    }
    return;
  }

  if (reg === JBD_CMD_HWVER) {
    fields.push({ label: 'Hardware Version', value: decodeString(data) });
    return;
  }

  // String registers
  if (reg === JBD_REG.ManufacturerName || reg === JBD_REG.DeviceName || reg === JBD_REG.BarCode) {
    fields.push({ label: 'Text', value: decodeString(data) });
    return;
  }

  // Generic config register response
  if (data.length === 2) {
    const val = readUint16(data, 0);
    fields.push({ label: 'Value (uint16)', value: `${val} (${hex(val >> 8)} ${hex(val & 0xff)})` });
    addConfigContext(reg, val, fields);
    return;
  }

  // Fallback: show raw data
  fields.push({ label: 'Raw', value: hexArr(data) });
}

function addConfigContext(reg: number, val: number, fields: Field[]) {
  const voltRegs: number[] = [
    JBD_REG.PackOverVoltage, JBD_REG.PackOVRelease, JBD_REG.PackUnderVoltage, JBD_REG.PackUVRelease,
  ];
  const cellVoltRegs: number[] = [
    JBD_REG.CellOverVoltage, JBD_REG.CellOVRelease, JBD_REG.CellUnderVoltage, JBD_REG.CellUVRelease,
    JBD_REG.BalanceStartVoltage, JBD_REG.HardCellOverVoltage, JBD_REG.HardCellUnderVoltage,
  ];
  const capRegs: number[] = [JBD_REG.DesignCapacity, JBD_REG.CycleCapacity];
  const tempRegs: number[] = [
    JBD_REG.ChgOverTemp, JBD_REG.ChgOTRelease, JBD_REG.ChgLowTemp, JBD_REG.ChgUTRelease,
    JBD_REG.DisOverTemp, JBD_REG.DsgOTRelease, JBD_REG.DisLowTemp, JBD_REG.DsgUTRelease,
  ];

  if (voltRegs.includes(reg)) {
    fields.push({ label: 'As Pack Voltage', value: `${(val / 100).toFixed(2)} V` });
  } else if (cellVoltRegs.includes(reg)) {
    fields.push({ label: 'As Cell Voltage', value: `${(val / 1000).toFixed(3)} V` });
  } else if (capRegs.includes(reg)) {
    fields.push({ label: 'As Capacity', value: `${(val / 100).toFixed(2)} Ah` });
  } else if (tempRegs.includes(reg)) {
    fields.push({ label: 'As Temperature', value: `${decodeTemp(val).toFixed(1)} °C` });
  } else if (reg === JBD_REG.ManufactureDate) {
    const d = decodeDate(val);
    fields.push({ label: 'As Date', value: `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}` });
  } else if (reg === JBD_REG.FullChargeVol || reg === JBD_REG.ChargeEndVol) {
    fields.push({ label: 'As Voltage', value: `${(val / 100).toFixed(2)} V` });
  } else if (reg === JBD_REG.OverChargeCurrent || reg === JBD_REG.OverDisCurrent) {
    fields.push({ label: 'As Current', value: `${(val / 100).toFixed(2)} A` });
  } else if (reg === JBD_REG.SenseResistor) {
    fields.push({ label: 'As Resistance', value: `${val} mΩ` });
  } else if (reg === JBD_REG.BalanceWindow) {
    fields.push({ label: 'As Voltage', value: `${val} mV` });
  }
}

function formatBalanceBits(mask: number): string {
  const cells: number[] = [];
  for (let i = 0; i < 16; i++) {
    if ((mask & (1 << i)) !== 0) cells.push(i + 1);
  }
  return `Cells: ${cells.join(', ')}`;
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
        <div className="bg-red-900/20 border border-red-800 rounded-xl p-4 text-red-300 text-sm">
          Could not parse input. Supported formats: space/colon-separated hex bytes, continuous hex string, or C-style escaped strings (<code className="bg-red-900/40 px-1 rounded">\xDD\xA5...</code>).
        </div>
      )}

      {/* Format detection + total bytes */}
      {bytes && bytes.length > 0 && (
        <div className="flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
          <span>Detected format: <span className="text-[var(--color-text)] font-medium">{detectedFormat}</span></span>
          <span>{bytes.length} total bytes</span>
          {packets.length > 1 && (
            <span className="px-1.5 py-0.5 bg-blue-900/40 text-blue-300 border border-blue-800 rounded font-medium">
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
                ? 'bg-emerald-900/20 border-emerald-800'
                : 'bg-amber-900/20 border-amber-800'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span
                className={`px-2 py-0.5 text-[10px] font-bold rounded ${
                  pkt.result.type === 'request'
                    ? 'bg-emerald-700 text-emerald-100'
                    : 'bg-blue-700 text-blue-100'
                }`}
              >
                {pkt.result.type === 'request' ? 'TX REQUEST' : 'RX RESPONSE'}
              </span>
              {pkt.result.valid ? (
                <span className="text-emerald-400 text-xs font-medium">Valid</span>
              ) : (
                <span className="text-amber-400 text-xs font-medium">Issues found</span>
              )}
            </div>
            <p className="text-sm font-medium text-[var(--color-text)]">{pkt.result.summary}</p>
            {pkt.result.errors.length > 0 && (
              <ul className="mt-2 space-y-1">
                {pkt.result.errors.map((err, i) => (
                  <li key={i} className="text-xs text-red-400 flex items-start gap-1">
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
    if (i === 0) return 'bg-purple-800/60 text-purple-200'; // START
    if (i === bytes.length - 1) return 'bg-purple-800/60 text-purple-200'; // END

    const isRequest = bytes[1] === JBD_CMD_READ || bytes[1] === JBD_CMD_WRITE;

    if (i === 1) return isRequest ? 'bg-emerald-800/60 text-emerald-200' : 'bg-blue-800/60 text-blue-200'; // CMD or REG
    if (i === 2) return isRequest ? 'bg-blue-800/60 text-blue-200' : 'bg-amber-800/60 text-amber-200'; // REG or STATUS
    if (i === 3) return 'bg-cyan-800/60 text-cyan-200'; // LEN

    const len = bytes[3];
    if (i >= 4 && i < 4 + len) return 'bg-slate-700/60 text-slate-200'; // DATA
    if (i === 4 + len || i === 5 + len) return 'bg-orange-800/60 text-orange-200'; // CRC

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
        <Legend color="bg-purple-800/60" label="Start/End" />
        {isRequest ? (
          <Legend color="bg-emerald-800/60" label="Command" />
        ) : null}
        <Legend color="bg-blue-800/60" label={isRequest ? 'Register' : 'Register'} />
        {!isRequest && <Legend color="bg-amber-800/60" label="Status" />}
        <Legend color="bg-cyan-800/60" label="Length" />
        {len > 0 && <Legend color="bg-slate-700/60" label="Data" />}
        <Legend color="bg-orange-800/60" label="CRC" />
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
