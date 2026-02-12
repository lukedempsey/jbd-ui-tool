/**
 * JBD BMS packet decoder — shared logic used by DecoderPanel and TrafficConsole.
 */
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
} from './jbd-protocol';

// ── Types ────────────────────────────────────────────────────────────────────

export interface Field {
  label: string;
  value: string;
  detail?: string;
}

export interface DecodeResult {
  type: 'request' | 'response';
  valid: boolean;
  errors: string[];
  summary: string;
  fields: Field[];
  packetFields: Field[];
  dataFields: Field[];
}

// ── Utilities ────────────────────────────────────────────────────────────────

export function hex(byte: number): string {
  return '0x' + byte.toString(16).padStart(2, '0').toUpperCase();
}

export function hexArr(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join(' ');
}

function readUint16(data: Uint8Array, offset: number): number {
  return (data[offset] << 8) | data[offset + 1];
}

// Reverse lookup register name from number
const REG_NAMES: Record<number, string> = {};
for (const [name, num] of Object.entries(JBD_REG)) {
  REG_NAMES[num] = name;
}

export function getRegisterName(reg: number): string {
  if (reg === JBD_CMD_HWINFO) return 'HWINFO (0x03)';
  if (reg === JBD_CMD_CELLINFO) return 'CELLINFO (0x04)';
  if (reg === JBD_CMD_HWVER) return 'HWVER (0x05)';
  if (REG_NAMES[reg]) return `${REG_NAMES[reg]} (${hex(reg)})`;
  return hex(reg);
}

function formatBalanceBits(mask: number): string {
  const cells: number[] = [];
  for (let i = 0; i < 16; i++) {
    if ((mask & (1 << i)) !== 0) cells.push(i + 1);
  }
  return `Cells: ${cells.join(', ')}`;
}

// ── Packet splitter ──────────────────────────────────────────────────────────

/**
 * Split a raw byte stream into individual JBD packets.
 * Packets start with 0xDD and end with 0x77. Uses the length field
 * at byte[3] to determine packet boundaries precisely.
 */
export function splitPackets(bytes: Uint8Array): Uint8Array[] {
  const packets: Uint8Array[] = [];
  let i = 0;

  while (i < bytes.length) {
    if (bytes[i] !== JBD_START) {
      i++;
      continue;
    }

    if (i + 6 >= bytes.length) {
      packets.push(bytes.slice(i));
      break;
    }

    const len = bytes[i + 3];
    const pktLen = 7 + len;

    if (i + pktLen <= bytes.length) {
      packets.push(bytes.slice(i, i + pktLen));
      i += pktLen;
    } else {
      packets.push(bytes.slice(i));
      break;
    }
  }

  return packets;
}

// ── Packet decoder ───────────────────────────────────────────────────────────

export function decodePacket(bytes: Uint8Array): DecodeResult {
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

  const dataFields: Field[] = [];
  if (isWrite && len > 0) {
    decodeWriteData(reg, data, dataFields);
  }

  const summary = isWrite
    ? `Write to ${getRegisterName(reg)}${len > 0 ? ` — ${len} byte(s)` : ''}`
    : `Read ${getRegisterName(reg)}`;

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

  const dataFields: Field[] = [];
  if (len > 0 && status === 0) {
    decodeResponseData(reg, data, dataFields);
  }

  const summary = `Response ${getRegisterName(reg)}${status === 0 ? '' : ' (ERROR)'}`;

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

  if (data.length === 2) {
    const val = readUint16(data, 0);
    fields.push({ label: 'Value (uint16)', value: `${val} (${hex(val >> 8)} ${hex(val & 0xff)})` });
    addConfigContext(reg, val, fields);
  }

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

  if (reg === JBD_REG.ManufacturerName || reg === JBD_REG.DeviceName || reg === JBD_REG.BarCode) {
    fields.push({ label: 'Text', value: decodeString(data) });
    return;
  }

  if (data.length === 2) {
    const val = readUint16(data, 0);
    fields.push({ label: 'Value (uint16)', value: `${val} (${hex(val >> 8)} ${hex(val & 0xff)})` });
    addConfigContext(reg, val, fields);
    return;
  }

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
