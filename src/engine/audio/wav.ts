import { promises as fs } from 'node:fs'
import path from 'node:path'
import { renameRetry } from '../store/atomic'
import { SR } from './dsp'

export interface WavData {
  sampleRate: number
  /** One Float32Array per channel, values in [-1, 1]. */
  channels: Float32Array[]
}

/** Encodes 16-bit PCM WAV (mono or stereo). Samples are clamped to [-1, 1]. */
export function encodeWav(channels: Float32Array[] | Float32Array, sampleRate = SR): Buffer {
  const chs = Array.isArray(channels) ? channels : [channels]
  if (chs.length < 1 || chs.length > 2) throw new Error('wav: only mono or stereo is supported')
  const frames = chs[0]!.length
  for (const c of chs) if (c.length !== frames) throw new Error('wav: channel length mismatch')
  const nCh = chs.length
  const dataBytes = frames * nCh * 2
  const buf = Buffer.alloc(44 + dataBytes)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(36 + dataBytes, 4)
  buf.write('WAVE', 8, 'ascii')
  buf.write('fmt ', 12, 'ascii')
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(nCh, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * nCh * 2, 28)
  buf.writeUInt16LE(nCh * 2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36, 'ascii')
  buf.writeUInt32LE(dataBytes, 40)
  let o = 44
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nCh; c++) {
      const v = Math.max(-1, Math.min(1, chs[c]![i]!))
      buf.writeInt16LE(Math.round(v < 0 ? v * 32768 : v * 32767), o)
      o += 2
    }
  }
  return buf
}

/** Decodes PCM WAV: 8/16/24/32-bit integer or 32-bit float, any channel count (kept as is). */
export function decodeWav(buf: Buffer): WavData {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('wav: not a RIFF/WAVE file')
  }
  let pos = 12
  let fmt: { format: number; nCh: number; rate: number; bits: number } | undefined
  let data: Buffer | undefined
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4)
    let size = buf.readUInt32LE(pos + 4)
    const start = pos + 8
    if (start + size > buf.length) size = buf.length - start // truncated or streaming header
    if (id === 'fmt ') {
      let format = buf.readUInt16LE(start)
      const nCh = buf.readUInt16LE(start + 2)
      const rate = buf.readUInt32LE(start + 4)
      const bits = buf.readUInt16LE(start + 14)
      if (format === 0xfffe && size >= 26) format = buf.readUInt16LE(start + 24)
      fmt = { format, nCh, rate, bits }
    } else if (id === 'data') {
      data = buf.subarray(start, start + size)
    }
    pos = start + size + (size % 2)
  }
  if (!fmt || !data) throw new Error('wav: missing fmt or data chunk')
  const { format, nCh, rate, bits } = fmt
  const bytes = bits / 8
  if (!((format === 1 && [8, 16, 24, 32].includes(bits)) || (format === 3 && bits === 32))) {
    throw new Error(`wav: unsupported format ${format} / ${bits} bit`)
  }
  const frames = Math.floor(data.length / (bytes * nCh))
  const channels = Array.from({ length: nCh }, () => new Float32Array(frames))
  let o = 0
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nCh; c++) {
      let v: number
      if (format === 3) v = data.readFloatLE(o)
      else if (bits === 16) v = data.readInt16LE(o) / 32768
      else if (bits === 8) v = (data.readUInt8(o) - 128) / 128
      else if (bits === 24) v = data.readIntLE(o, 3) / 8388608
      else v = data.readInt32LE(o) / 2147483648
      channels[c]![i] = v
      o += bytes
    }
  }
  return { sampleRate: rate, channels }
}

/** Mono mix-down of a decoded file, resampled (linear) to 44.1 kHz when needed. */
export function toMono44k(w: WavData): Float32Array {
  const frames = w.channels[0]?.length ?? 0
  const mono = new Float32Array(frames)
  for (const c of w.channels) for (let i = 0; i < frames; i++) mono[i] = mono[i]! + c[i]! / w.channels.length
  if (w.sampleRate === SR) return mono
  const outLen = Math.round((frames * SR) / w.sampleRate)
  const out = new Float32Array(outLen)
  const ratio = w.sampleRate / SR
  for (let i = 0; i < outLen; i++) {
    const x = i * ratio
    const i0 = Math.floor(x)
    const f = x - i0
    out[i] = mono[i0]! * (1 - f) + (mono[Math.min(frames - 1, i0 + 1)] ?? 0) * f
  }
  return out
}

/** Writes a WAV through a temp file and a rename. */
export async function writeWavFile(file: string, channels: Float32Array[] | Float32Array, sampleRate = SR): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(16).slice(2, 8)}`
  await fs.writeFile(tmp, encodeWav(channels, sampleRate))
  try {
    await renameRetry(tmp, file)
  } catch (err) {
    await fs.rm(tmp, { force: true })
    throw err
  }
}

export async function readWavFile(file: string): Promise<WavData> {
  return decodeWav(await fs.readFile(file))
}
