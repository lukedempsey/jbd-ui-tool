import { useState } from 'react';
import { JBD_REG, FUNCTION_FLAGS } from '../lib/jbd-protocol';
import type { BMSConfig } from '../lib/jbd-protocol';

interface Props {
  config: BMSConfig | null;
  isConnected: boolean;
  onReadConfig: () => Promise<void>;
  onWriteRegister: (register: number, value: number) => Promise<void>;
  onWriteTempRegister: (register: number, celsius: number) => Promise<void>;
}

interface ConfigField {
  label: string;
  register: number;
  key: keyof BMSConfig;
  unit: string;
  type: 'voltage_mv' | 'current' | 'capacity' | 'temp' | 'raw' | 'string' | 'percent' | 'milliohm' | 'time';
  group: string;
  readOnly?: boolean;
}

const CONFIG_FIELDS: ConfigField[] = [
  // Capacity
  { label: 'Design Capacity', register: JBD_REG.DesignCapacity, key: 'designCapacity', unit: 'Ah ×100', type: 'capacity', group: 'Capacity' },
  { label: 'Cycle Capacity', register: JBD_REG.CycleCapacity, key: 'cycleCapacity', unit: 'Ah ×100', type: 'capacity', group: 'Capacity' },
  { label: 'Full Charge Voltage', register: JBD_REG.FullChargeVol, key: 'fullChargeVol', unit: 'mV', type: 'voltage_mv', group: 'Capacity' },
  { label: 'Charge End Voltage', register: JBD_REG.ChargeEndVol, key: 'chargeEndVol', unit: 'mV', type: 'voltage_mv', group: 'Capacity' },
  { label: 'Discharging Rate', register: JBD_REG.DischargingRate, key: 'dischargingRate', unit: '%', type: 'percent', group: 'Capacity' },

  // Cell voltage protection
  { label: 'Cell Overvoltage', register: JBD_REG.CellOverVoltage, key: 'cellOverVoltage', unit: 'mV', type: 'voltage_mv', group: 'Cell Voltage' },
  { label: 'Cell OV Release', register: JBD_REG.CellOVRelease, key: 'cellOVRelease', unit: 'mV', type: 'voltage_mv', group: 'Cell Voltage' },
  { label: 'Cell Undervoltage', register: JBD_REG.CellUnderVoltage, key: 'cellUnderVoltage', unit: 'mV', type: 'voltage_mv', group: 'Cell Voltage' },
  { label: 'Cell UV Release', register: JBD_REG.CellUVRelease, key: 'cellUVRelease', unit: 'mV', type: 'voltage_mv', group: 'Cell Voltage' },
  { label: 'Hard Cell OV', register: JBD_REG.HardCellOverVoltage, key: 'hardCellOverVoltage', unit: 'mV', type: 'voltage_mv', group: 'Cell Voltage' },
  { label: 'Hard Cell UV', register: JBD_REG.HardCellUnderVoltage, key: 'hardCellUnderVoltage', unit: 'mV', type: 'voltage_mv', group: 'Cell Voltage' },

  // Pack voltage protection
  { label: 'Pack Overvoltage', register: JBD_REG.PackOverVoltage, key: 'packOverVoltage', unit: 'mV', type: 'voltage_mv', group: 'Pack Voltage' },
  { label: 'Pack OV Release', register: JBD_REG.PackOVRelease, key: 'packOVRelease', unit: 'mV', type: 'voltage_mv', group: 'Pack Voltage' },
  { label: 'Pack Undervoltage', register: JBD_REG.PackUnderVoltage, key: 'packUnderVoltage', unit: 'mV', type: 'voltage_mv', group: 'Pack Voltage' },
  { label: 'Pack UV Release', register: JBD_REG.PackUVRelease, key: 'packUVRelease', unit: 'mV', type: 'voltage_mv', group: 'Pack Voltage' },

  // Current protection
  { label: 'Charge Overcurrent', register: JBD_REG.OverChargeCurrent, key: 'overChargeCurrent', unit: 'A ×100', type: 'current', group: 'Current' },
  { label: 'Discharge Overcurrent', register: JBD_REG.OverDisCurrent, key: 'overDisCurrent', unit: 'A ×100', type: 'current', group: 'Current' },

  // Temperature
  { label: 'Charge Over Temp', register: JBD_REG.ChgOverTemp, key: 'chgOverTemp', unit: '°C', type: 'temp', group: 'Temperature' },
  { label: 'Charge OT Release', register: JBD_REG.ChgOTRelease, key: 'chgOTRelease', unit: '°C', type: 'temp', group: 'Temperature' },
  { label: 'Charge Low Temp', register: JBD_REG.ChgLowTemp, key: 'chgLowTemp', unit: '°C', type: 'temp', group: 'Temperature' },
  { label: 'Charge UT Release', register: JBD_REG.ChgUTRelease, key: 'chgUTRelease', unit: '°C', type: 'temp', group: 'Temperature' },
  { label: 'Discharge Over Temp', register: JBD_REG.DisOverTemp, key: 'disOverTemp', unit: '°C', type: 'temp', group: 'Temperature' },
  { label: 'Discharge OT Release', register: JBD_REG.DsgOTRelease, key: 'dsgOTRelease', unit: '°C', type: 'temp', group: 'Temperature' },
  { label: 'Discharge Low Temp', register: JBD_REG.DisLowTemp, key: 'disLowTemp', unit: '°C', type: 'temp', group: 'Temperature' },
  { label: 'Discharge UT Release', register: JBD_REG.DsgUTRelease, key: 'dsgUTRelease', unit: '°C', type: 'temp', group: 'Temperature' },

  // Balance
  { label: 'Balance Start Voltage', register: JBD_REG.BalanceStartVoltage, key: 'balanceStartVoltage', unit: 'mV', type: 'voltage_mv', group: 'Balance' },
  { label: 'Balance Window', register: JBD_REG.BalanceWindow, key: 'balanceWindow', unit: 'mV', type: 'voltage_mv', group: 'Balance' },

  // System
  { label: 'Sense Resistor', register: JBD_REG.SenseResistor, key: 'senseResistor', unit: 'mΩ', type: 'milliohm', group: 'System' },
  { label: 'Cell Count', register: JBD_REG.PackNum, key: 'packNum', unit: '', type: 'raw', group: 'System' },
  { label: 'FET Control Time', register: JBD_REG.FetCtrlTime, key: 'fetCtrlTime', unit: 's', type: 'time', group: 'System' },
  { label: 'LED Display Time', register: JBD_REG.LedDispTime, key: 'ledDispTime', unit: 's', type: 'time', group: 'System' },
  { label: 'Serial Number', register: JBD_REG.SerialNumber, key: 'serialNumber', unit: '', type: 'raw', group: 'System', readOnly: true },
  { label: 'Cycle Count', register: JBD_REG.CycleCount, key: 'cycleCount', unit: '', type: 'raw', group: 'System', readOnly: true },

  // Info strings
  { label: 'Manufacturer', register: JBD_REG.ManufacturerName, key: 'manufacturerName', unit: '', type: 'string', group: 'Info', readOnly: true },
  { label: 'Device Name', register: JBD_REG.DeviceName, key: 'deviceName', unit: '', type: 'string', group: 'Info', readOnly: true },
  { label: 'Barcode', register: JBD_REG.BarCode, key: 'barCode', unit: '', type: 'string', group: 'Info', readOnly: true },
];

function ConfigFieldRow({
  field,
  value,
  onWrite,
}: {
  field: ConfigField;
  value: string | number;
  onWrite: (register: number, value: number, isTemp: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(String(value));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const numVal = Number(editValue);
      if (isNaN(numVal)) throw new Error('Invalid number');
      onWrite(field.register, numVal, field.type === 'temp');
      setEditing(false);
    } catch {
      // keep editing
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditValue(String(value));
    setEditing(false);
  };

  return (
    <tr className="border-t border-[var(--color-border)] hover:bg-[var(--color-surface-light)]/50">
      <td className="px-4 py-2 text-sm font-medium">{field.label}</td>
      <td className="px-4 py-2 text-right">
        {editing ? (
          <div className="flex items-center justify-end gap-2">
            <input
              type={field.type === 'string' ? 'text' : 'number'}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="w-28 px-2 py-1 bg-[var(--color-bg)] border border-[var(--color-primary)] rounded text-right text-sm font-mono text-[var(--color-text)] focus:outline-none"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave();
                if (e.key === 'Escape') handleCancel();
              }}
              autoFocus
            />
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-2 py-1 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded cursor-pointer"
            >
              Save
            </button>
            <button
              onClick={handleCancel}
              className="px-2 py-1 text-xs bg-gray-600 hover:bg-gray-700 text-white rounded cursor-pointer"
            >
              Cancel
            </button>
          </div>
        ) : (
          <span className="font-mono text-sm">{value}</span>
        )}
      </td>
      <td className="px-4 py-2 text-sm text-[var(--color-text-muted)]">{field.unit}</td>
      <td className="px-4 py-2 text-center">
        {!field.readOnly && !editing && (
          <button
            onClick={() => {
              setEditValue(String(value));
              setEditing(true);
            }}
            className="text-xs text-[var(--color-primary)] hover:text-[var(--color-primary-light)] cursor-pointer"
          >
            Edit
          </button>
        )}
      </td>
    </tr>
  );
}

export function ConfigPanel({
  config,
  isConnected,
  onReadConfig,
  onWriteRegister,
  onWriteTempRegister,
}: Props) {
  const [loading, setLoading] = useState(false);

  const handleRead = async () => {
    setLoading(true);
    try {
      await onReadConfig();
    } finally {
      setLoading(false);
    }
  };

  const handleWrite = async (register: number, value: number, isTemp: boolean) => {
    if (isTemp) {
      await onWriteTempRegister(register, value);
    } else {
      await onWriteRegister(register, value);
    }
    // Re-read config after write
    await onReadConfig();
  };

  // Group fields
  const groups = CONFIG_FIELDS.reduce<Record<string, ConfigField[]>>((acc, field) => {
    (acc[field.group] ??= []).push(field);
    return acc;
  }, {});

  // Function config flags
  const functionFlags = config
    ? FUNCTION_FLAGS.map((f) => ({
        ...f,
        active: (config.batteryConfig & (1 << f.bit)) !== 0,
      }))
    : [];

  return (
    <div className="space-y-4">
      {/* Read button */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleRead}
          disabled={!isConnected || loading}
          className="px-4 py-2 bg-[var(--color-primary)] hover:bg-[var(--color-primary-dark)] disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors cursor-pointer"
        >
          {loading ? 'Reading EEPROM...' : 'Read Configuration'}
        </button>
        {loading && (
          <span className="text-sm text-[var(--color-text-muted)] animate-pulse">
            This may take a moment...
          </span>
        )}
      </div>

      {!config ? (
        <div className="flex items-center justify-center h-48 text-[var(--color-text-muted)]">
          <div className="text-center">
            <p>Click "Read Configuration" to load EEPROM settings</p>
            <p className="text-xs mt-1">Requires active connection</p>
          </div>
        </div>
      ) : (
        <>
          {/* Function Config Flags */}
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4">
            <h3 className="text-sm font-medium text-[var(--color-text-muted)] mb-3 uppercase tracking-wider">
              Function Configuration (Reg 0x2D)
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {functionFlags.map((f) => (
                <div
                  key={f.key}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
                    f.active
                      ? 'bg-emerald-900/30 border-emerald-700 text-emerald-300'
                      : 'bg-[var(--color-surface-light)] border-[var(--color-border)] text-[var(--color-text-muted)]'
                  }`}
                >
                  <div
                    className={`w-2 h-2 rounded-full ${f.active ? 'bg-emerald-500' : 'bg-gray-600'}`}
                  />
                  <span className="text-sm">{f.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Config groups */}
          {Object.entries(groups).map(([group, fields]) => (
            <div
              key={group}
              className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl overflow-hidden"
            >
              <div className="px-4 py-3 bg-[var(--color-surface-light)] border-b border-[var(--color-border)]">
                <h3 className="text-sm font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
                  {group}
                </h3>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[var(--color-surface-light)]/50">
                    <th className="text-left px-4 py-2 text-xs font-medium text-[var(--color-text-muted)]">
                      Parameter
                    </th>
                    <th className="text-right px-4 py-2 text-xs font-medium text-[var(--color-text-muted)]">
                      Value
                    </th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-[var(--color-text-muted)]">
                      Unit
                    </th>
                    <th className="text-center px-4 py-2 text-xs font-medium text-[var(--color-text-muted)]">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((field) => (
                    <ConfigFieldRow
                      key={field.key}
                      field={field}
                      value={config[field.key]}
                      onWrite={handleWrite}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
