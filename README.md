# JBD BMS Monitor

Browser-based dashboard for JBD/Xiaoxiang Battery Management Systems over USB serial. No backend — communicates directly from the browser using the Web Serial API.

## Requirements

- **Chrome or Edge** (Web Serial API is not supported in Firefox/Safari)
- USB serial adapter connected to the BMS UART port (e.g. FTDI, CH340, CP210x)

## Quick Start

```bash
cd bms-ui
npm install
npm run dev
```

Open **http://localhost:5173** in Chrome.

## Connecting

1. Click **Pick Port...** to open the browser's serial port picker and select your USB serial device.
2. Or click **Autodetect** — if no ports have been granted yet, the picker opens automatically. After selecting, it probes the port by sending a JBD read command and auto-connects if a BMS responds.
3. Default baud rate is **9600** (standard for JBD BMS). Change it in the dropdown if your BMS uses a different rate.

Once connected, click **Read Once** for a single snapshot or **Start Polling** for continuous live data at configurable intervals (0.5s–5s).

## Tabs

| Tab | What it shows |
|-----|---------------|
| **Overview** | Pack voltage, current, SOC gauge, remaining/full capacity, cycle count, temperatures |
| **Cells** | Per-cell voltage bar chart, min/max/avg/delta stats, balance status indicators, detailed table |
| **Protection & FET** | Charge/discharge MOSFET toggle switches, all 13 protection flags (OV, UV, OT, OC, short circuit, etc.) |
| **Configuration** | Full EEPROM read/write — capacity settings, voltage/current/temperature protection limits, balance config, system settings, device info |

## Serial Console

Click the **Serial Console** bar at the bottom to expand the raw traffic viewer:

- Every TX (green) and RX (blue) packet is shown as a hex dump with millisecond timestamps
- Toggle **ASCII** to see printable characters alongside hex
- **Pause** to freeze the log for inspection (new traffic is discarded while paused)
- **Clear** to reset the log
- Auto-scrolls to follow new data; scroll up manually to pause auto-scroll

## Build for Production

```bash
npm run build
```

Output is in `dist/` — serve with any static file server.

## Protocol

Implements the JBD UART protocol: `DD [CMD] [REG] [LEN] [DATA] [CRC] 77`

- CRC: `uint16`, computed as `0 - sum(REG, LEN, DATA...)`, big-endian
- Read command: `0xA5`, Write command: `0x5A`
- EEPROM must be opened (`0x56 0x78` → reg `0x00`) before reading/writing config registers, and closed (`0x00 0x00` → reg `0x01`) afterward
