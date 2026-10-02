/* SidAli HAL runtime — the freestanding primitives the compiler lowers to.
 * sid_write / sid_mmio_write / sid_read / sid_mmio_read are platform-specific:
 * these defaults target a generic MMIO UART (e.g. STM32 USART1 at 0x40011000).
 * Swap this file per board; the SidAli program above it never changes.
 */

typedef unsigned long long sid_u64;

#ifndef SID_UART_BASE
#define SID_UART_BASE 0x40011000UL
#endif

/* STM32-like USART: SR at +0x00 (TXE = bit 7), DR at +0x04 */
static inline void sid_uart_putc(unsigned char c) {
  volatile unsigned int *sr = (volatile unsigned int *)(SID_UART_BASE + 0x00);
  volatile unsigned int *dr = (volatile unsigned int *)(SID_UART_BASE + 0x04);
  while (!((*sr) & (1u << 7))) { }
  *dr = c;
}

void sid_write(const char *s, sid_u64 len) {
  if (!s) return;
  if (len == 0) {
    for (const char *p = s; *p; p++) sid_uart_putc((unsigned char)*p);
  } else {
    for (sid_u64 i = 0; i + 1 < len; i++) sid_uart_putc((unsigned char)s[i]);
  }
}

sid_u64 sid_read(void) { return (sid_u64)-1; }

void sid_mmio_write(sid_u64 addr, sid_u64 val) {
  *(volatile sid_u64 *)addr = val;
}

sid_u64 sid_mmio_read(sid_u64 addr) {
  return *(volatile sid_u64 *)addr;
}
