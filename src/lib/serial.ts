/**
 * Web Serial API wrapper for JBD BMS communication
 */

import {
  buildReadPacket,
  buildWritePacket,
  buildEEPROMOpen,
  buildEEPROMClose,
  buildMosfetControl,
  buildWriteUint16,
  parseResponsePacket,
  decodeHardwareInfo,
  decodeCellInfo,
  decodeString,
  JBD_CMD_HWINFO,
  JBD_CMD_CELLINFO,
  JBD_CMD_HWVER,
  JBD_REG,
  decodeTemp,
  encodeTemp,
  type BMSHardwareInfo,
  type BMSCellInfo,
  type BMSConfig,
  type ParsedPacket,
} from './jbd-protocol';

// ── Web Serial types ─────────────────────────────────────────────────────────

declare global {
  interface Navigator {
    serial: {
      requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>;
      getPorts(): Promise<SerialPort[]>;
    };
  }

  interface SerialPortRequestOptions {
    filters?: SerialPortFilter[];
  }

  interface SerialPortFilter {
    usbVendorId?: number;
    usbProductId?: number;
  }

  interface SerialPort {
    open(options: SerialOptions): Promise<void>;
    close(): Promise<void>;
    readable: ReadableStream<Uint8Array> | null;
    writable: WritableStream<Uint8Array> | null;
    getInfo(): SerialPortInfo;
  }

  interface SerialOptions {
    baudRate: number;
    dataBits?: number;
    stopBits?: number;
    parity?: 'none' | 'even' | 'odd';
    bufferSize?: number;
    flowControl?: 'none' | 'hardware';
  }

  interface SerialPortInfo {
    usbVendorId?: number;
    usbProductId?: number;
  }
}

// ── Known USB-serial adapter vendors ─────────────────────────────────────────

const USB_SERIAL_VENDORS: Record<number, string> = {
  0x0403: 'FTDI',
  0x1a86: 'CH340',
  0x10c4: 'CP210x',
  0x067b: 'PL2303',
  0x2341: 'Arduino',
  0x1d6b: 'Linux USB',
  0x239a: 'Adafruit',
  0x2e8a: 'Raspberry Pi',
  0x0d28: 'ARM DAPLink',
  0x303a: 'Espressif',
};

// ── BMS Serial Connection ────────────────────────────────────────────────────

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface SerialConfig {
  baudRate: number;
}

/** Describes a detected serial port */
export interface DetectedPort {
  port: SerialPort;
  index: number;
  vendorId?: number;
  productId?: number;
  vendorName: string;
  label: string;
  isBMS: boolean; // true if probe confirmed JBD BMS response
}

/** A single TX or RX log entry */
export interface TrafficEntry {
  timestamp: number;
  direction: 'TX' | 'RX';
  data: Uint8Array;
  hex: string;
  ascii: string;
}

export type TrafficListener = (entry: TrafficEntry) => void;

function formatHex(data: Uint8Array): string {
  return Array.from(data)
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join(' ');
}

function formatAscii(data: Uint8Array): string {
  return Array.from(data)
    .map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.'))
    .join('');
}

function makeEntry(direction: 'TX' | 'RX', data: Uint8Array): TrafficEntry {
  return {
    timestamp: Date.now(),
    direction,
    data: new Uint8Array(data), // copy
    hex: formatHex(data),
    ascii: formatAscii(data),
  };
}

const DEFAULT_CONFIG: SerialConfig = {
  baudRate: 9600,
};

const READ_TIMEOUT = 2000;
const PROBE_TIMEOUT = 1500;
const MAX_RETRIES = 3;

export class BMSSerial {
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private _state: ConnectionState = 'disconnected';
  private onStateChange?: (state: ConnectionState) => void;
  private trafficListeners: Set<TrafficListener> = new Set();
  private commandLock: Promise<void> = Promise.resolve();

  /** Subscribe to raw TX/RX traffic. Returns unsubscribe function. */
  onTraffic(listener: TrafficListener): () => void {
    this.trafficListeners.add(listener);
    return () => this.trafficListeners.delete(listener);
  }

  private emitTraffic(direction: 'TX' | 'RX', data: Uint8Array) {
    if (this.trafficListeners.size === 0) return;
    const entry = makeEntry(direction, data);
    for (const listener of this.trafficListeners) {
      listener(entry);
    }
  }

  get state(): ConnectionState {
    return this._state;
  }

  get isConnected(): boolean {
    return this._state === 'connected';
  }

  get connectedPortInfo(): SerialPortInfo | null {
    return this.port?.getInfo() ?? null;
  }

  setOnStateChange(cb: (state: ConnectionState) => void) {
    this.onStateChange = cb;
  }

  private setState(state: ConnectionState) {
    this._state = state;
    this.onStateChange?.(state);
  }

  static isSupported(): boolean {
    return 'serial' in navigator;
  }

  // ── Port discovery ─────────────────────────────────────────────────────────

  /** Get previously-granted ports with metadata */
  static async getDetectedPorts(): Promise<DetectedPort[]> {
    if (!BMSSerial.isSupported()) return [];
    const ports = await navigator.serial.getPorts();
    return ports.map((port, index) => {
      const info = port.getInfo();
      const vendorName = info.usbVendorId
        ? USB_SERIAL_VENDORS[info.usbVendorId] ?? 'Unknown'
        : 'Unknown';
      const vid = info.usbVendorId
        ? `0x${info.usbVendorId.toString(16).padStart(4, '0')}`
        : '—';
      const pid = info.usbProductId
        ? `0x${info.usbProductId.toString(16).padStart(4, '0')}`
        : '—';
      return {
        port,
        index,
        vendorId: info.usbVendorId,
        productId: info.usbProductId,
        vendorName,
        label: `${vendorName} (${vid}:${pid})`,
        isBMS: false,
      };
    });
  }

  /**
   * Probe a port to check if a JBD BMS responds.
   * Opens the port, sends a HWINFO read, checks for a valid response,
   * then closes the port. Non-destructive.
   */
  static async probePort(
    port: SerialPort,
    baudRate: number = 9600
  ): Promise<boolean> {
    try {
      await port.open({
        baudRate,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        bufferSize: 4096,
        flowControl: 'none',
      });

      // Write HWINFO read packet
      const packet = buildReadPacket(JBD_CMD_HWINFO);
      if (port.writable) {
        const writer = port.writable.getWriter();
        await writer.write(packet);
        writer.releaseLock();
      }

      // Wait for response
      let found = false;
      if (port.readable) {
        const reader = port.readable.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        const deadline = Date.now() + PROBE_TIMEOUT;
        try {
          while (Date.now() < deadline) {
            const remaining = deadline - Date.now();
            if (remaining <= 0) break;
            const result = await Promise.race([
              reader.read(),
              new Promise<{ value: undefined; done: true }>((resolve) =>
                setTimeout(
                  () => resolve({ value: undefined, done: true }),
                  remaining
                )
              ),
            ]);
            if (result.done || !result.value) break;
            chunks.push(result.value);
            total += result.value.length;
            const merged = mergeChunks(chunks, total);
            const parsed = parseResponsePacket(merged);
            if (parsed && parsed.register === JBD_CMD_HWINFO) {
              found = true;
              break;
            }
          }
        } finally {
          reader.releaseLock();
        }
      }

      await port.close();
      return found;
    } catch {
      // Port busy, permission denied, or not a BMS
      try {
        await port.close();
      } catch {
        /* already closed */
      }
      return false;
    }
  }

  /**
   * Request a new port from the browser picker and add it to the known list.
   * Returns the newly granted port's DetectedPort entry, or null if cancelled.
   */
  static async requestAndAddPort(): Promise<DetectedPort | null> {
    try {
      const port = await navigator.serial.requestPort();
      const info = port.getInfo();
      const vendorName = info.usbVendorId
        ? USB_SERIAL_VENDORS[info.usbVendorId] ?? 'Unknown'
        : 'Unknown';
      const vid = info.usbVendorId
        ? `0x${info.usbVendorId.toString(16).padStart(4, '0')}`
        : '—';
      const pid = info.usbProductId
        ? `0x${info.usbProductId.toString(16).padStart(4, '0')}`
        : '—';
      return {
        port,
        index: 0, // will be re-indexed by caller
        vendorId: info.usbVendorId,
        productId: info.usbProductId,
        vendorName,
        label: `${vendorName} (${vid}:${pid})`,
        isBMS: false,
      };
    } catch {
      // User cancelled the picker
      return null;
    }
  }

  /**
   * Scan all previously-granted ports and probe each for a JBD BMS.
   * If no ports are granted yet, opens the browser picker first.
   * Returns detected ports with `isBMS` flag set on matches.
   */
  static async autodetect(
    baudRate: number = 9600,
    onProgress?: (msg: string) => void
  ): Promise<DetectedPort[]> {
    let ports = await BMSSerial.getDetectedPorts();

    // No ports granted yet — ask user to pick one
    if (ports.length === 0) {
      onProgress?.('No ports known — opening port picker...');
      const newPort = await BMSSerial.requestAndAddPort();
      if (!newPort) return []; // user cancelled
      // Re-read the full list (the granted port is now in getPorts())
      ports = await BMSSerial.getDetectedPorts();
    }

    for (const dp of ports) {
      onProgress?.(`Probing ${dp.label}...`);
      dp.isBMS = await BMSSerial.probePort(dp.port, baudRate);
      if (dp.isBMS) {
        onProgress?.(`Found BMS on ${dp.label}`);
      }
    }
    return ports;
  }

  // ── Connection ─────────────────────────────────────────────────────────────

  /** Connect via browser port picker (user gesture required) */
  async connect(config: SerialConfig = DEFAULT_CONFIG): Promise<void> {
    if (!BMSSerial.isSupported()) {
      throw new Error(
        'Web Serial API not supported. Use Chrome or Edge browser.'
      );
    }

    this.setState('connecting');

    try {
      this.port = await navigator.serial.requestPort();
      await this.port.open({
        baudRate: config.baudRate,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        bufferSize: 4096,
        flowControl: 'none',
      });

      this.setState('connected');
    } catch (err) {
      this.setState('error');
      throw err;
    }
  }

  /** Connect to a specific pre-detected port (no browser picker needed) */
  async connectToPort(
    port: SerialPort,
    config: SerialConfig = DEFAULT_CONFIG
  ): Promise<void> {
    this.setState('connecting');
    try {
      await port.open({
        baudRate: config.baudRate,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        bufferSize: 4096,
        flowControl: 'none',
      });
      this.port = port;
      this.setState('connected');
    } catch (err) {
      this.setState('error');
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.reader) {
        await this.reader.cancel();
        this.reader = null;
      }
      if (this.port) {
        await this.port.close();
        this.port = null;
      }
    } catch {
      // Ignore errors during disconnect
    }
    this.setState('disconnected');
  }

  // ── Low-level I/O ──────────────────────────────────────────────────────────

  private async write(data: Uint8Array): Promise<void> {
    if (!this.port?.writable) throw new Error('Port not writable');
    const writer = this.port.writable.getWriter();
    try {
      await writer.write(data);
      this.emitTraffic('TX', data);
    } finally {
      writer.releaseLock();
    }
  }

  private async readResponse(): Promise<Uint8Array> {
    if (!this.port?.readable) throw new Error('Port not readable');

    const reader = this.port.readable.getReader();
    this.reader = reader;
    const chunks: Uint8Array[] = [];
    let totalLength = 0;
    let timedOut = false;

    // Set up a timeout that cancels the reader
    const timer = setTimeout(() => {
      timedOut = true;
      reader.cancel().catch(() => {});
    }, READ_TIMEOUT);

    try {
      while (true) {
        const { value, done } = await reader.read();

        if (done || !value) break;

        chunks.push(value);
        totalLength += value.length;

        // Check if we have a complete packet
        const merged = mergeChunks(chunks, totalLength);
        const packet = parseResponsePacket(merged);
        if (packet) {
          // Emit the complete reassembled frame as a single traffic entry
          this.emitTraffic('RX', merged);
          return merged;
        }
      }

      // Emit whatever we received (incomplete frame / timeout)
      const merged = mergeChunks(chunks, totalLength);
      if (totalLength > 0) {
        this.emitTraffic('RX', merged);
      }
      return merged;
    } finally {
      clearTimeout(timer);
      // Cancel any in-flight read before releasing
      if (!timedOut) {
        try { await reader.cancel(); } catch { /* ignore */ }
      }
      try { reader.releaseLock(); } catch { /* ignore */ }
      this.reader = null;
    }
  }

  /**
   * Serialise all command access through a mutex so concurrent callers
   * (e.g. polling + user click) don't interleave TX/RX on the wire.
   */
  private async sendCommand(packet: Uint8Array): Promise<ParsedPacket> {
    // Chain onto the existing lock so commands are sequential
    const prev = this.commandLock;
    let resolve!: () => void;
    this.commandLock = new Promise<void>((r) => { resolve = r; });

    await prev; // wait for any prior command to finish

    try {
      return await this._sendCommand(packet);
    } finally {
      resolve(); // release for the next caller
    }
  }

  private async _sendCommand(packet: Uint8Array): Promise<ParsedPacket> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await this.write(packet);
        const response = await this.readResponse();
        const parsed = parseResponsePacket(response);
        if (!parsed) {
          throw new Error('Invalid response packet');
        }
        if (parsed.status !== 0) {
          throw new Error(`BMS error status: 0x${parsed.status.toString(16)}`);
        }
        return parsed;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < MAX_RETRIES - 1) {
          await sleep(100 * (attempt + 1));
        }
      }
    }

    throw lastError || new Error('Command failed after retries');
  }

  // ── Read Operations ────────────────────────────────────────────────────────

  async readHardwareInfo(): Promise<BMSHardwareInfo> {
    const packet = buildReadPacket(JBD_CMD_HWINFO);
    const response = await this.sendCommand(packet);
    return decodeHardwareInfo(response.data);
  }

  async readCellInfo(): Promise<BMSCellInfo> {
    const packet = buildReadPacket(JBD_CMD_CELLINFO);
    const response = await this.sendCommand(packet);
    return decodeCellInfo(response.data);
  }

  async readHardwareVersion(): Promise<string> {
    const packet = buildReadPacket(JBD_CMD_HWVER);
    const response = await this.sendCommand(packet);
    return decodeString(response.data);
  }

  async readRegisterUint16(register: number): Promise<number> {
    const response = await this.sendCommand(buildReadPacket(register));
    return (response.data[0] << 8) | response.data[1];
  }

  async readRegisterString(register: number): Promise<string> {
    const response = await this.sendCommand(buildReadPacket(register));
    return decodeString(response.data);
  }

  // ── EEPROM Read (config) ───────────────────────────────────────────────────

  async readConfig(): Promise<BMSConfig> {
    // Open EEPROM
    await this.sendCommand(buildEEPROMOpen());
    await sleep(50);

    try {
      const readReg = async (reg: number) => {
        const val = await this.readRegisterUint16(reg);
        await sleep(30);
        return val;
      };

      const readStr = async (reg: number) => {
        const val = await this.readRegisterString(reg);
        await sleep(30);
        return val;
      };

      const config: BMSConfig = {
        designCapacity: await readReg(JBD_REG.DesignCapacity),
        cycleCapacity: await readReg(JBD_REG.CycleCapacity),
        fullChargeVol: await readReg(JBD_REG.FullChargeVol),
        chargeEndVol: await readReg(JBD_REG.ChargeEndVol),
        dischargingRate: await readReg(JBD_REG.DischargingRate),
        chgOverTemp: decodeTemp(await readReg(JBD_REG.ChgOverTemp)),
        chgOTRelease: decodeTemp(await readReg(JBD_REG.ChgOTRelease)),
        chgLowTemp: decodeTemp(await readReg(JBD_REG.ChgLowTemp)),
        chgUTRelease: decodeTemp(await readReg(JBD_REG.ChgUTRelease)),
        disOverTemp: decodeTemp(await readReg(JBD_REG.DisOverTemp)),
        dsgOTRelease: decodeTemp(await readReg(JBD_REG.DsgOTRelease)),
        disLowTemp: decodeTemp(await readReg(JBD_REG.DisLowTemp)),
        dsgUTRelease: decodeTemp(await readReg(JBD_REG.DsgUTRelease)),
        packOverVoltage: await readReg(JBD_REG.PackOverVoltage),
        packOVRelease: await readReg(JBD_REG.PackOVRelease),
        packUnderVoltage: await readReg(JBD_REG.PackUnderVoltage),
        packUVRelease: await readReg(JBD_REG.PackUVRelease),
        cellOverVoltage: await readReg(JBD_REG.CellOverVoltage),
        cellOVRelease: await readReg(JBD_REG.CellOVRelease),
        cellUnderVoltage: await readReg(JBD_REG.CellUnderVoltage),
        cellUVRelease: await readReg(JBD_REG.CellUVRelease),
        overChargeCurrent: await readReg(JBD_REG.OverChargeCurrent),
        overDisCurrent: await readReg(JBD_REG.OverDisCurrent),
        balanceStartVoltage: await readReg(JBD_REG.BalanceStartVoltage),
        balanceWindow: await readReg(JBD_REG.BalanceWindow),
        senseResistor: await readReg(JBD_REG.SenseResistor),
        batteryConfig: await readReg(JBD_REG.BatteryConfig),
        ntcConfig: await readReg(JBD_REG.NtcConfig),
        packNum: await readReg(JBD_REG.PackNum),
        fetCtrlTime: await readReg(JBD_REG.FetCtrlTime),
        ledDispTime: await readReg(JBD_REG.LedDispTime),
        hardCellOverVoltage: await readReg(JBD_REG.HardCellOverVoltage),
        hardCellUnderVoltage: await readReg(JBD_REG.HardCellUnderVoltage),
        serialNumber: await readReg(JBD_REG.SerialNumber),
        cycleCount: await readReg(JBD_REG.CycleCount),
        manufactureDate: await readReg(JBD_REG.ManufactureDate),
        manufacturerName: await readStr(JBD_REG.ManufacturerName),
        deviceName: await readStr(JBD_REG.DeviceName),
        barCode: await readStr(JBD_REG.BarCode),
      };

      return config;
    } finally {
      // Always close EEPROM
      await this.sendCommand(buildEEPROMClose()).catch(() => {});
    }
  }

  // ── Write Operations ───────────────────────────────────────────────────────

  async writeRegister(register: number, value: number): Promise<void> {
    await this.sendCommand(buildEEPROMOpen());
    await sleep(50);
    try {
      await this.sendCommand(buildWriteUint16(register, value));
    } finally {
      await this.sendCommand(buildEEPROMClose()).catch(() => {});
    }
  }

  async writeTempRegister(register: number, celsius: number): Promise<void> {
    await this.writeRegister(register, encodeTemp(celsius));
  }

  async setMosfet(charge: boolean, discharge: boolean): Promise<void> {
    await this.sendCommand(buildEEPROMOpen());
    await sleep(50);
    try {
      await this.sendCommand(buildMosfetControl(charge, discharge));
    } finally {
      await this.sendCommand(buildEEPROMClose()).catch(() => {});
    }
  }

  async writeStringRegister(register: number, value: string): Promise<void> {
    const encoded = new TextEncoder().encode(value);
    await this.sendCommand(buildEEPROMOpen());
    await sleep(50);
    try {
      await this.sendCommand(buildWritePacket(register, encoded));
    } finally {
      await this.sendCommand(buildEEPROMClose()).catch(() => {});
    }
  }

  // ── All-in-one read ────────────────────────────────────────────────────────

  async readAll(): Promise<{
    hardware: BMSHardwareInfo;
    cells: BMSCellInfo;
    version: string;
  }> {
    const hardware = await this.readHardwareInfo();
    await sleep(50);
    const cells = await this.readCellInfo();
    await sleep(50);
    const version = await this.readHardwareVersion();
    return { hardware, cells, version };
  }
}

// ── Utilities ────────────────────────────────────────────────────────────────

function mergeChunks(chunks: Uint8Array[], totalLength: number): Uint8Array {
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Singleton instance
export const bmsSerial = new BMSSerial();
