// SidAli HAL — the hardware abstraction layer.
//
// The compiler lowers `mmio_write` / `mmio_read` and freestanding `print` to the
// primitives below. Each execution substrate has its own device map, so the same
// SidAli program drives a UART on silicon, an optical modulator on photonics, a
// qubit gate controller, a fluidic valve, a field emitter in vacuum, a voxel
// projector, a plasma arc, or an energy transducer — the program text is identical.

export interface HalDevice {
  name: string;
  base: number;
  /** Byte offset of the data register from `base`. */
  dataOffset: number;
  /** Byte offset of the status register, when the device has one. */
  statusOffset?: number;
  /** Status bit that must be set before a write is accepted. */
  readyBit?: number;
  /** Human-readable unit of one register write. */
  unit: string;
}

export interface HalSpec {
  substrate: string;
  devices: HalDevice[];
  /** The device `print` is routed through. */
  console: string;
}

export const HAL_SPECS: Record<string, HalSpec> = {
  electron: {
    substrate: 'electron',
    console: 'uart',
    devices: [{ name: 'uart', base: 0x40011000, dataOffset: 0x04, statusOffset: 0x00, readyBit: 7, unit: 'byte' }],
  },
  photon: {
    substrate: 'photon',
    console: 'modulator',
    devices: [{ name: 'modulator', base: 0x50020000, dataOffset: 0x08, statusOffset: 0x00, readyBit: 1, unit: 'pulse' }],
  },
  qubit: {
    substrate: 'qubit',
    console: 'gate',
    devices: [{ name: 'gate', base: 0x60000000, dataOffset: 0x04, statusOffset: 0x00, readyBit: 2, unit: 'gate-op' }],
  },
  fluidic: {
    substrate: 'fluidic',
    console: 'valve',
    devices: [{ name: 'valve', base: 0x70000000, dataOffset: 0x00, unit: 'drop' }],
  },
  vacuum: {
    substrate: 'vacuum',
    console: 'emitter',
    devices: [{ name: 'emitter', base: 0x80000000, dataOffset: 0x04, statusOffset: 0x00, readyBit: 0, unit: 'field-pulse' }],
  },
  holographic: {
    substrate: 'holographic',
    console: 'voxel',
    devices: [{ name: 'voxel', base: 0x90000000, dataOffset: 0x0c, unit: 'voxel' }],
  },
  plasma: {
    substrate: 'plasma',
    console: 'arc',
    devices: [{ name: 'arc', base: 0xa0000000, dataOffset: 0x08, statusOffset: 0x00, readyBit: 3, unit: 'arc-pulse' }],
  },
  energy: {
    substrate: 'energy',
    console: 'transducer',
    devices: [{ name: 'transducer', base: 0xb0000000, dataOffset: 0x00, unit: 'joule-step' }],
  },
  generic: {
    substrate: 'generic',
    console: 'uart',
    devices: [{ name: 'uart', base: 0x40011000, dataOffset: 0x04, statusOffset: 0x00, readyBit: 7, unit: 'byte' }],
  },
};

export function halSpec(substrate: string): HalSpec {
  return HAL_SPECS[substrate] || HAL_SPECS.generic;
}

/** The C runtime the freestanding backend links against, specialised per substrate. */
export function halRuntimeC(substrate: string): string {
  const spec = halSpec(substrate);
  const dev = spec.devices[0];
  const ready = dev.statusOffset !== undefined
    ? `  while (!((*status) & (1u << ${dev.readyBit ?? 0}))) { }\n`
    : '';
  const statusDecl = dev.statusOffset !== undefined
    ? `  volatile unsigned int *status = (volatile unsigned int *)(SID_DEVICE_BASE + 0x${dev.statusOffset.toString(16)});\n`
    : '';
  return `/* SidAli HAL runtime — substrate: ${spec.substrate} (console: ${spec.console}, unit: ${dev.unit}). */
typedef unsigned long long sid_u64;

#ifndef SID_DEVICE_BASE
#define SID_DEVICE_BASE 0x${dev.base.toString(16)}UL
#endif

/* ${spec.console}: data register at +0x${dev.dataOffset.toString(16)}${dev.statusOffset !== undefined ? `, status at +0x${dev.statusOffset.toString(16)} (ready = bit ${dev.readyBit ?? 0})` : ''} */
static inline void sid_device_write(unsigned char c) {
${statusDecl}  volatile unsigned int *data = (volatile unsigned int *)(SID_DEVICE_BASE + 0x${dev.dataOffset.toString(16)});
${ready}  *data = (unsigned int)c;
}

void sid_write(const char *s, sid_u64 len) {
  if (!s) return;
  if (len == 0) {
    for (const char *p = s; *p; p++) sid_device_write((unsigned char)*p);
  } else {
    for (sid_u64 i = 0; i + 1 < len; i++) sid_device_write((unsigned char)s[i]);
  }
}

sid_u64 sid_read(void) { return (sid_u64)-1; }

void sid_mmio_write(sid_u64 addr, sid_u64 val) {
  *(volatile sid_u64 *)addr = val;
}

sid_u64 sid_mmio_read(sid_u64 addr) {
  return *(volatile sid_u64 *)addr;
}

/* Substrate actuation: one ${dev.unit}. */
void sid_emit(sid_u64 unit) {
  *(volatile sid_u64 *)(SID_DEVICE_BASE + 0x${dev.dataOffset.toString(16)}) = unit;
}
`;
}

/** Address map for a substrate, used by the browser MMIO simulator. */
export function halAddressMap(substrate: string): Array<{ name: string; addr: number; kind: 'data' | 'status' }> {
  const spec = halSpec(substrate);
  const out: Array<{ name: string; addr: number; kind: 'data' | 'status' }> = [];
  for (const d of spec.devices) {
    out.push({ name: `${d.name}.data`, addr: d.base + d.dataOffset, kind: 'data' });
    if (d.statusOffset !== undefined) out.push({ name: `${d.name}.status`, addr: d.base + d.statusOffset, kind: 'status' });
  }
  return out;
}
