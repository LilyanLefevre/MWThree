// S3TC (DXT1/3/5) block decompression to RGBA8.

function rgb565(v: number, out: Uint8Array, o: number) {
  out[o] = ((v >> 11) & 31) * 255 / 31 | 0
  out[o + 1] = ((v >> 5) & 63) * 255 / 63 | 0
  out[o + 2] = (v & 31) * 255 / 31 | 0
}

export type DxtKind = 'dxt1' | 'dxt3' | 'dxt5'

export function dxtBlockBytes(kind: DxtKind): number { return kind === 'dxt1' ? 8 : 16 }

export function decodeDxt(data: Uint8Array, width: number, height: number, kind: DxtKind): Uint8Array {
  const out = new Uint8Array(width * height * 4)
  const bw = Math.max(1, (width + 3) >> 2), bh = Math.max(1, (height + 3) >> 2)
  const bs = dxtBlockBytes(kind)
  const col = new Uint8Array(16) // 4 colors RGBA
  const alpha = new Uint8Array(8)
  let p = 0
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++, p += bs) {
      const c = kind === 'dxt1' ? p : p + 8
      const c0 = data[c] | (data[c + 1] << 8), c1 = data[c + 2] | (data[c + 3] << 8)
      rgb565(c0, col, 0); rgb565(c1, col, 4)
      col[3] = 255; col[7] = 255
      if (kind === 'dxt1' && c0 <= c1) {
        for (let k = 0; k < 3; k++) { col[8 + k] = (col[k] + col[4 + k]) >> 1; col[12 + k] = 0 }
        col[11] = 255; col[15] = 0
      } else {
        for (let k = 0; k < 3; k++) {
          col[8 + k] = (2 * col[k] + col[4 + k]) / 3 | 0
          col[12 + k] = (col[k] + 2 * col[4 + k]) / 3 | 0
        }
        col[11] = 255; col[15] = 255
      }
      let bits = data[c + 4] | (data[c + 5] << 8) | (data[c + 6] << 16) | (data[c + 7] << 24)
      if (kind === 'dxt5') {
        const a0 = data[p], a1 = data[p + 1]
        alpha[0] = a0; alpha[1] = a1
        if (a0 > a1) for (let k = 1; k < 7; k++) alpha[k + 1] = ((7 - k) * a0 + k * a1) / 7 | 0
        else { for (let k = 1; k < 5; k++) alpha[k + 1] = ((5 - k) * a0 + k * a1) / 5 | 0; alpha[6] = 0; alpha[7] = 255 }
      }
      for (let py = 0; py < 4; py++) {
        const y = by * 4 + py
        for (let px = 0; px < 4; px++) {
          const x = bx * 4 + px
          const idx = bits & 3
          bits >>>= 2
          if (x >= width || y >= height) continue
          const o = (y * width + x) * 4
          out[o] = col[idx * 4]; out[o + 1] = col[idx * 4 + 1]; out[o + 2] = col[idx * 4 + 2]
          if (kind === 'dxt1') out[o + 3] = col[idx * 4 + 3]
          else if (kind === 'dxt3') {
            const n = (data[p + (py * 4 + px >> 1)] >> ((px & 1) * 4)) & 15
            out[o + 3] = n * 17
          } else {
            const bitPos = (py * 4 + px) * 3
            const byte = 2 + (bitPos >> 3)
            const v = (data[p + byte] | ((data[p + byte + 1] ?? 0) << 8)) >> (bitPos & 7)
            out[o + 3] = alpha[v & 7]
          }
        }
      }
    }
  }
  return out
}
