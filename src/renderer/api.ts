import type { Command, EngineEvent, ToyboxApi } from '../shared/protocol'
import { mediaUrl, type HostApi } from './hostApi'
import { toyStore } from './store/store'

/** The host (Electron preload) API. Every extra is optional, because the browser harness supplies only some. */
export type RendererApi = ToyboxApi & Partial<HostApi> & { mediaUrl?(rel: string): string }

declare global {
  interface Window {
    toybox: RendererApi
  }
}

export function sendCommand(command: Command): void {
  window.toybox.send(command)
}

export const files = {
  /** The whole file as UTF-8 text, or null when it does not exist. */
  async readFile(rel: string): Promise<string | null> {
    const api = window.toybox
    return api.readFile ? api.readFile(rel) : null
  },
  /** Text from a byte offset to the end of the file, with the file's size. A negative offset means the last N bytes. */
  async tailFile(rel: string, fromByte: number): Promise<{ text: string; size: number } | null> {
    const api = window.toybox
    if (api.tailFile) return api.tailFile(rel, fromByte)
    if (api.readFile) {
      const text = await api.readFile(rel)
      return text === null ? null : { text, size: text.length }
    }
    return null
  }
}

/** Parsed JSON file from the data folder, or null when it is missing or broken. */
export async function readJson<T = unknown>(rel: string): Promise<T | null> {
  const text = await files.readFile(rel)
  if (text === null) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

/** URL for a thumbnail, animatic or final video. The browser harness can replace it. */
export function media(rel: string): string {
  return window.toybox.mediaUrl ? window.toybox.mediaUrl(rel) : mediaUrl(rel)
}

export async function openFolder(rel: string): Promise<boolean> {
  return (await window.toybox.openFolder?.(rel)) ?? false
}

/**
 * Connects the store to the engine: events are queued and applied every 50 ms,
 * so a burst of streamed tokens causes one render, not hundreds. Returns a disconnect function.
 */
export function connectEngine(api: RendererApi = window.toybox): () => void {
  let queue: EngineEvent[] = []
  let scheduled = false
  const flush = () => {
    scheduled = false
    const batch = queue
    queue = []
    toyStore.getState().applyEvents(batch)
  }
  const off = api.on((event) => {
    queue.push(event)
    if (!scheduled) {
      scheduled = true
      setTimeout(flush, 50)
    }
  })
  api.send({ type: 'snapshot' })
  return () => {
    off()
    queue = []
  }
}
