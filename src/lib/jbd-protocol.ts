/**
 * JBD BMS Protocol Implementation
 *
 * Packet format: [0xDD] [CMD] [REG] [LEN] [DATA...] [CRC_H] [CRC_L] [0x77]
 * CRC = 0 - sum(bytes from CMD through DATA)
 */

// ── Constants ────────────────────────────────────────────────────────────────

export const JBD_START = 0xdd;
export const JBD_END = 0x77;
export const JBD_CMD_READ = 0xa5;
export const JBD_CMD_WRITE = 0x5a;

// Read registers
export const JBD_CMD_HWINFO = 0x03;
export const JBD_CMD_CELLINFO = 0x04;
export const JBD_CMD_HWVER = 0x05;

// EEPROM control
export const JBD_REG_EEPROM = 0x00;
export const JBD_REG_CONFIG = 0x01;

// MOSFET control
export const JBD_CMD_MOS = 0xe1;
export const JBD_MOS_CHARGE = 0x01;
export const JBD_MOS_DISCHARGE = 0x02;

// Config registers
export const JBD_REG = {
  DesignCapacity: 0x10,
  CycleCapacity: 0x11,
  FullChargeVol: 0x12,
  ChargeEndVol: 0x13,
  DischargingRate: 0x14,
  ManufactureDate: 0x15,
  SerialNumber: 0x16,
  CycleCount: 0x17,
  ChgOverTemp: 0x18,
  ChgOTRelease: 0x19,
  ChgLowTemp: 0x1a,
  ChgUTRelease: 0x1b,
  DisOverTemp: 0x1c,
  DsgOTRelease: 0x1d,
  DisLowTemp: 0x1e,
  DsgUTRelease: 0x1f,
  PackOverVoltage: 0x20,
  PackOVRelease: 0x21,
  PackUnderVoltage: 0x22,
  PackUVRelease: 0x23,
  CellOverVoltage: 0x24,
  CellOVRelease: 0x25,
  CellUnderVoltage: 0x26,
  CellUVRelease: 0x27,
  OverChargeCurrent: 0x28,
  OverDisCurrent: 0x29,
  BalanceStartVoltage: 0x2a,
  BalanceWindow: 0x2b,
  SenseResistor: 0x2c,
  BatteryConfig: 0x2d,
  NtcConfig: 0x2e,
  PackNum: 0x2f,
  FetCtrlTime: 0x30,
  LedDispTime: 0x31,
  VoltageCap80: 0x32,
  VoltageCap60: 0x33,
  VoltageCap40: 0x34,
  VoltageCap20: 0x35,
  HardCellOverVoltage: 0x36,
  HardCellUnderVoltage: 0x37,
  DoubleOCSC: 0x38,
  DelayHCOVP: 0x39,
  ChgTempDelay: 0x3a,
  DsgTempDelay: 0x3b,
  PackVoltDelay: 0x3c,
  CellVoltDelay: 0x3d,
  ChgOCDelay: 0x3e,
  DsgOCDelay: 0x3f,
  GPS_VOL: 0x40,
  GPS_TIME: 0x41,
  VoltageCap90: 0x42,
  VoltageCap70: 0x43,
  VoltageCap50: 0x44,
  VoltageCap30: 0x45,
  VoltageCap10: 0x46,
  VoltageCap100: 0x47,
  ManufacturerName: 0xa0,
  DeviceName: 0xa1,
  BarCode: 0xa2,
  Capacity: 0xe0,
  Mosfet: 0xe1,
  Balance: 0xe2,
  Reset: 0xe3,
  FRESET: 0x0a,
} as const;

// Protection bit names
export const PROTECTION_FLAGS = [
  { bit: 0, key: 'singleCellOV', label: 'Cell Overvoltage' },
  { bit: 1, key: 'singleCellUV', label: 'Cell Undervoltage' },
  { bit: 2, key: 'packOV', label: 'Pack Overvoltage' },
  { bit: 3, key: 'packUV', label: 'Pack Undervoltage' },
  { bit: 4, key: 'chargeOT', label: 'Charge Over Temp' },
  { bit: 5, key: 'chargeLT', label: 'Charge Low Temp' },
  { bit: 6, key: 'dischargeOT', label: 'Discharge Over Temp' },
  { bit: 7, key: 'dischargeLT', label: 'Discharge Low Temp' },
  { bit: 8, key: 'chargeOC', label: 'Charge Overcurrent' },
  { bit: 9, key: 'dischargeOC', label: 'Discharge Overcurrent' },
  { bit: 10, key: 'shortCircuit', label: 'Short Circuit' },
  { bit: 11, key: 'icError', label: 'IC Error' },
  { bit: 12, key: 'mosLock', label: 'MOS Lock' },
] as const;

// Function config bit names
export const FUNCTION_FLAGS = [
  { bit: 0, key: 'switch', label: 'Switch' },
  { bit: 1, key: 'scrl', label: 'SCRL' },
  { bit: 2, key: 'balanceEn', label: 'Balance Enable' },
  { bit: 3, key: 'chgBalance', label: 'Charge Balance' },
  { bit: 4, key: 'ledEn', label: 'LED Enable' },
  { bit: 5, key: 'ledNum', label: 'LED Number' },
  { bit: 6, key: 'rtc', label: 'RTC' },
  { bit: 7, key: 'edv', label: 'EDV' },
] as const;

// ── Types ────────────────────────────────────────────────────────────────────

export interface BMSHardwareInfo {
  voltage: number; // V
  current: number; // A
  remainingCapacity: number; // Ah
  fullCapacity: number; // Ah
  cycles: number;
  manufactureDate: { year: number; month: number; day: number };
  balanceLow: number; // bitmask
  balanceHigh: number; // bitmask
  protection: number; // bitmask
  protectionFlags: Record<string, boolean>;
  version: number;
  rsoc: number; // %
  fetState: number; // bitmask
  chargeEnabled: boolean;
  dischargeEnabled: boolean;
  cellCount: number;
  tempCount: number;
  temperatures: number[]; // °C
}

export interface BMSCellInfo {
  cellVoltages: number[]; // V
  cellCount: number;
}

export interface BMSConfig {
  designCapacity: number;
  cycleCapacity: number;
  fullChargeVol: number;
  chargeEndVol: number;
  dischargingRate: number;
  chgOverTemp: number;
  chgOTRelease: number;
  chgLowTemp: number;
  chgUTRelease: number;
  disOverTemp: number;
  dsgOTRelease: number;
  disLowTemp: number;
  dsgUTRelease: number;
  packOverVoltage: number;
  packOVRelease: number;
  packUnderVoltage: number;
  packUVRelease: number;
  cellOverVoltage: number;
  cellOVRelease: number;
  cellUnderVoltage: number;
  cellUVRelease: number;
  overChargeCurrent: number;
  overDisCurrent: number;
  balanceStartVoltage: number;
  balanceWindow: number;
  senseResistor: number;
  batteryConfig: number;
  ntcConfig: number;
  packNum: number;
  fetCtrlTime: number;
  ledDispTime: number;
  hardCellOverVoltage: number;
  hardCellUnderVoltage: number;
  serialNumber: number;
  cycleCount: number;
  manufactureDate: number;
  manufacturerName: string;
  deviceName: string;
  barCode: string;
}

// ── CRC ──────────────────────────────────────────────────────────────────────

/**
 * JBD CRC: start at 0, subtract each byte. Result is uint16.
 * Matches the C code: `for(i=0; i < len; i++) crc -= data[i];`
 * CRC covers bytes from pkt[2] onward: [REG, LEN, DATA...]
 * It does NOT include START (0xDD) or CMD (0xA5/0x5A).
 */
export function calcCRC(data: Uint8Array): number {
  let crc = 0;
  for (let i = 0; i < data.length; i++) {
    crc -= data[i];
  }
  return crc & 0xffff;
}

// ── Packet Builder ───────────────────────────────────────────────────────────

export function buildReadPacket(register: number): Uint8Array {
  // CRC covers [REG, LEN] — no data for reads
  const crc = calcCRC(new Uint8Array([register, 0x00]));
  return new Uint8Array([
    JBD_START,
    JBD_CMD_READ,
    register,
    0x00,
    (crc >> 8) & 0xff,
    crc & 0xff,
    JBD_END,
  ]);
}

export function buildWritePacket(
  register: number,
  data: Uint8Array
): Uint8Array {
  const len = data.length;
  // CRC covers [REG, LEN, DATA...]
  const crcPayload = new Uint8Array(2 + len);
  crcPayload[0] = register;
  crcPayload[1] = len;
  crcPayload.set(data, 2);
  const crc = calcCRC(crcPayload);

  const packet = new Uint8Array(7 + len);
  packet[0] = JBD_START;
  packet[1] = JBD_CMD_WRITE;
  packet[2] = register;
  packet[3] = len;
  packet.set(data, 4);
  packet[4 + len] = (crc >> 8) & 0xff;
  packet[5 + len] = crc & 0xff;
  packet[6 + len] = JBD_END;
  return packet;
}

// ── Packet Parser ────────────────────────────────────────────────────────────

export interface ParsedPacket {
  register: number;
  status: number;
  data: Uint8Array;
}

export function parseResponsePacket(
  buffer: Uint8Array
): ParsedPacket | null {
  // Find start byte
  let start = -1;
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === JBD_START) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;

  // Minimum packet: DD CMD REG LEN CRC_H CRC_L 77 = 7 bytes
  if (buffer.length - start < 7) return null;

  const register = buffer[start + 1];
  const status = buffer[start + 2];
  const len = buffer[start + 3];

  if (buffer.length - start < 7 + len) return null;

  const data = buffer.slice(start + 4, start + 4 + len);
  const crcHi = buffer[start + 4 + len];
  const crcLo = buffer[start + 5 + len];
  const endByte = buffer[start + 6 + len];

  if (endByte !== JBD_END) return null;

  // Verify CRC — covers [STATUS, LEN, DATA...] (buf[2..] in C code)
  const crcPayload = buffer.slice(start + 2, start + 4 + len);
  const expectedCrc = calcCRC(crcPayload);
  const actualCrc = (crcHi << 8) | crcLo;
  if (expectedCrc !== actualCrc) {
    console.warn(
      `CRC mismatch: expected 0x${expectedCrc.toString(16)}, got 0x${actualCrc.toString(16)}`
    );
    return null;
  }

  return { register, status, data };
}

// ── Data Decoders ────────────────────────────────────────────────────────────

function readUint16(data: Uint8Array, offset: number): number {
  return (data[offset] << 8) | data[offset + 1];
}

function readInt16(data: Uint8Array, offset: number): number {
  const val = (data[offset] << 8) | data[offset + 1];
  return val >= 0x8000 ? val - 0x10000 : val;
}

export function decodeTemp(raw: number): number {
  return (raw - 2731) / 10;
}

export function encodeTemp(celsius: number): number {
  return Math.round(celsius * 10 + 2731);
}

export function decodeDate(raw: number): {
  year: number;
  month: number;
  day: number;
} {
  return {
    year: 2000 + (raw >> 9),
    month: (raw >> 5) & 0x0f,
    day: raw & 0x1f,
  };
}

export function decodeHardwareInfo(data: Uint8Array): BMSHardwareInfo {
  const voltage = readUint16(data, 0) / 100;
  const current = readInt16(data, 2) / 100;
  const remainingCapacity = readUint16(data, 4) / 100;
  const fullCapacity = readUint16(data, 6) / 100;
  const cycles = readUint16(data, 8);
  const mfgDateRaw = readUint16(data, 10);
  const balanceLow = readUint16(data, 12);
  const balanceHigh = readUint16(data, 14);
  const protection = readUint16(data, 16);
  const version = data[18];
  const rsoc = data[19];
  const fetState = data[20];
  const cellCount = data[21];
  const tempCount = data[22];

  const temperatures: number[] = [];
  for (let i = 0; i < tempCount; i++) {
    const raw = readUint16(data, 23 + i * 2);
    temperatures.push(decodeTemp(raw));
  }

  const protectionFlags: Record<string, boolean> = {};
  for (const flag of PROTECTION_FLAGS) {
    protectionFlags[flag.key] = (protection & (1 << flag.bit)) !== 0;
  }

  return {
    voltage,
    current,
    remainingCapacity,
    fullCapacity,
    cycles,
    manufactureDate: decodeDate(mfgDateRaw),
    balanceLow,
    balanceHigh,
    protection,
    protectionFlags,
    version,
    rsoc,
    fetState,
    chargeEnabled: (fetState & JBD_MOS_CHARGE) !== 0,
    dischargeEnabled: (fetState & JBD_MOS_DISCHARGE) !== 0,
    cellCount,
    tempCount,
    temperatures,
  };
}

export function decodeCellInfo(data: Uint8Array): BMSCellInfo {
  const cellCount = data.length / 2;
  const cellVoltages: number[] = [];
  for (let i = 0; i < cellCount; i++) {
    cellVoltages.push(readUint16(data, i * 2) / 1000);
  }
  return { cellVoltages, cellCount };
}

export function decodeString(data: Uint8Array): string {
  return new TextDecoder().decode(data);
}

// ── EEPROM Helpers ───────────────────────────────────────────────────────────

export function buildEEPROMOpen(): Uint8Array {
  return buildWritePacket(JBD_REG_EEPROM, new Uint8Array([0x56, 0x78]));
}

export function buildEEPROMClose(): Uint8Array {
  return buildWritePacket(JBD_REG_CONFIG, new Uint8Array([0x00, 0x00]));
}

export function buildMosfetControl(
  charge: boolean,
  discharge: boolean
): Uint8Array {
  let val = 0;
  if (!charge) val |= JBD_MOS_CHARGE;
  if (!discharge) val |= JBD_MOS_DISCHARGE;
  return buildWritePacket(JBD_CMD_MOS, new Uint8Array([0x00, val]));
}

export function buildWriteUint16(
  register: number,
  value: number
): Uint8Array {
  return buildWritePacket(
    register,
    new Uint8Array([(value >> 8) & 0xff, value & 0xff])
  );
}
