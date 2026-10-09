import { spawn } from 'node:child_process'

export interface RunOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  signal?: AbortSignal
  /** Called for every complete stdout line (for example JSON progress lines from Blender). */
  onLine?: (line: string) => void
  /** Called for every complete stderr line. */
  onErrLine?: (line: string) => void
}

export interface RunResult {
  code: number | null
  /** The last lines of stderr, for error messages. */
  stderrTail: string
}

/** Splits a stream into lines and calls `fn` for each. `end()` flushes the last partial line. */
function lineSplitter(fn: (line: string) => void): { push(chunk: string): void; end(): void } {
  let buf = ''
  return {
    push(chunk) {
      buf += chunk
      let i = buf.indexOf('\n')
      while (i !== -1) {
        fn(buf.slice(0, i).replace(/\r$/, ''))
        buf = buf.slice(i + 1)
        i = buf.indexOf('\n')
      }
    },
    end() {
      if (buf) fn(buf.replace(/\r$/, ''))
      buf = ''
    }
  }
}

/**
 * Runs a child process for a tool job and streams its output line by line. The process is killed on abort.
 * Resolves with the exit code and does not reject for a non-zero exit (the caller decides).
 * Rejects when the program cannot start, or with an AbortError when stopped.
 */
export function runProcess(command: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    const child = spawn(command, args, { cwd: opts.cwd, env: opts.env ?? process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const tail: string[] = []
    const out = lineSplitter((l) => opts.onLine?.(l))
    const err = lineSplitter((l) => {
      tail.push(l)
      if (tail.length > 20) tail.shift()
      opts.onErrLine?.(l)
    })
    child.stdout.setEncoding('utf8').on('data', (c: string) => out.push(c))
    child.stderr.setEncoding('utf8').on('data', (c: string) => err.push(c))
    const onAbort = () => child.kill()
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    child.on('error', (e) => {
      opts.signal?.removeEventListener('abort', onAbort)
      reject(e)
    })
    child.on('close', (code) => {
      opts.signal?.removeEventListener('abort', onAbort)
      out.end()
      err.end()
      if (opts.signal?.aborted) return reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      resolve({ code, stderrTail: tail.join('\n') })
    })
  })
}
