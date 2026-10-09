import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseMdWith } from '../../shared/md'
import { agentSchema } from '../../shared/schemas'
import type { AgentFrontmatter } from '../../shared/schemas'
import { readMd, writeMd } from '../store/atomic'

export interface AgentDef {
  /** File name without `.md`, for example `screenwriter-pip-quill`. */
  id: string
  file: string
  data: AgentFrontmatter
  /** The persona: the body of the agent file. */
  body: string
}

/** Agents are files in agents/ (a fixed crew, edited by hand or through the UI). This class keeps them in memory and writes changes back to the files. */
export class AgentStore {
  private agents = new Map<string, AgentDef>()

  constructor(private readonly dataDir: string) {}

  get dir(): string {
    return path.join(this.dataDir, 'agents')
  }
  fileFor(id: string): string {
    return path.join(this.dir, `${id}.md`)
  }

  list(): AgentDef[] {
    return [...this.agents.values()].sort((a, b) => a.id.localeCompare(b.id))
  }
  get(id: string): AgentDef | undefined {
    return this.agents.get(id)
  }

  /** Loads every agent file. Invalid files are reported and skipped. */
  async loadAll(onError?: (file: string, err: Error) => void): Promise<void> {
    let names: string[] = []
    try {
      names = (await fs.readdir(this.dir)).filter((f) => f.endsWith('.md'))
    } catch {
      /* no agents folder yet */
    }
    const next = new Map<string, AgentDef>()
    for (const n of names) {
      const id = n.slice(0, -3)
      try {
        next.set(id, await this.parse(id))
      } catch (err) {
        onError?.(path.join(this.dir, n), err as Error)
        const old = this.agents.get(id)
        if (old) next.set(id, old)
      }
    }
    this.agents = next
  }

  /** Reloads one file after a change on disk. Returns the new definition, or undefined when the file is gone. */
  async reloadFile(id: string): Promise<AgentDef | undefined> {
    try {
      const def = await this.parse(id)
      this.agents.set(id, def)
      return def
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.agents.delete(id)
        return undefined
      }
      throw err
    }
  }

  private async parse(id: string): Promise<AgentDef> {
    const file = this.fileFor(id)
    const text = await fs.readFile(file, 'utf8')
    const doc = parseMdWith(text, agentSchema, file)
    return { id, file, data: doc.data, body: doc.body }
  }

  /** Changes frontmatter fields of an agent file, keeping the body and unknown fields. */
  async patch(id: string, patch: Partial<AgentFrontmatter>): Promise<AgentDef | undefined> {
    const file = this.fileFor(id)
    let doc
    try {
      doc = await readMd(file)
    } catch {
      return undefined
    }
    await writeMd(file, { ...doc.data, ...patch }, doc.body)
    return this.reloadFile(id)
  }
}
