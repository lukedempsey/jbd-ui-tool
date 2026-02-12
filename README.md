# JBD BMS Monitor

Browser-based dashboard for JBD/Xiaoxiang Battery Management Systems over USB serial. No backend — communicates directly from the browser using the Web Serial API.

**Live site: [bms.hldesign.io](https://bms.hldesign.io)**

## Screenshots

| Overview | Cells |
|----------|-------|
| ![Overview](docs/screenshots/overview.png) | ![Cells](docs/screenshots/cells.png) |

| Protection & FET | Configuration |
|------------------|---------------|
| ![Protection & FET](docs/screenshots/protection.png) | ![Configuration](docs/screenshots/configuration.png) |

| Serial Console |
|----------------|
| ![Serial Console](docs/screenshots/serial-console.png) |

## Requirements

- **Chrome or Edge** (Web Serial API is not supported in Firefox/Safari)
- USB serial adapter connected to the BMS UART port (e.g. FTDI, CH340, CP210x)

## Features

- **Live monitoring** — pack voltage, current, SOC, temperatures, cycle count
- **Per-cell voltages** — bar chart with min/max/delta stats and balance indicators
- **Protection & FET control** — view all 13 protection flags, toggle charge/discharge MOSFETs
- **Configuration** — full EEPROM read/write for protection limits, balance settings, device info
- **Packet decoder** — paste raw hex bytes for offline protocol analysis (no hardware required)
- **Serial console** — real-time TX/RX hex dump with decoded protocol fields

## Quick Start

```bash
npm install
npm run dev
```

Open **http://localhost:5173** in Chrome. Click **Pick Port** or **Autodetect** to connect to your BMS.

## Protocol

Implements the JBD UART protocol: `DD [CMD] [REG] [LEN] [DATA] [CRC] 77`

- Read command: `0xA5`, Write command: `0x5A`
- CRC: `uint16`, computed as `0 - sum(REG, LEN, DATA...)`, big-endian

## Contact

Luke Dempsey — [luke.b.dempsey@gmail.com](mailto:luke.b.dempsey@gmail.com)

GitHub: [github.com/lukedempsey/jbd-ui-tool](https://github.com/lukedempsey/jbd-ui-tool)
