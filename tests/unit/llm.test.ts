import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { chatJson, cleanProse, extractJson, jsonSchemaOf, stripThinking } from '../../src/engine/pipeline/llm'
import { render } from '../../src/engine/pipeline/prompts'
import { emptyUsage } from '../../src/engine/models/types'
import type { ChatOptions, ChatResult, JobContext } from '../../src/engine/queue/scheduler'

/** A job context whose model answers from a list, and which remembers every request. */
function fakeCtx(replies: (string | Error)[]) {
  const calls: ChatOptions[] = []
  const ctx = {
    signal: new AbortController().signal,
    chat: async (o: ChatOptions): Promise<ChatResult> => {
      calls.push(o)
      const r = replies.shift()
      if (r === undefined) throw new Error('no more replies')
      if (r instanceof Error) throw r
      return { text: r, usage: emptyUsage(), model: {} as ChatResult['model'], costUsd: 0.5 }
    }
  } as unknown as JobContext
  return { ctx, calls }
}

const shape = z.object({ title: z.string(), shots: z.number().int() })
const msgs = [{ role: 'user' as const, content: 'go' }]

describe('stripThinking / extractJson / cleanProse', () => {
  it('removes think blocks, also an unclosed opening one before the close tag', () => {
    expect(stripThinking('<think>hmm</think>\n\nhello')).toBe('hello')
    expect(stripThinking('reasoning without opener</think>answer')).toBe('answer')
  })

  it('finds the JSON object in fences and chatter', () => {
    expect(extractJson('Sure!\n```json\n{"a": 1}\n```\nDone')).toEqual({ a: 1 })
    expect(extractJson('<think>{"x":0}</think>{"a": [1, 2]}')).toEqual({ a: [1, 2] })
    expect(() => extractJson('no json here')).toThrow(/no JSON/)
  })

  it('cleans prose wrapped in fences', () => {
    expect(cleanProse('```\nOnce upon a time\n```')).toBe('Once upon a time')
  })

  it('turns a zod schema into a JSON schema without $schema', () => {
    const js = jsonSchemaOf(shape)
    expect(js.$schema).toBeUndefined()
    expect(js.type).toBe('object')
  })
})

describe('chatJson', () => {
  it('returns the validated value and passes the schema on the first call', async () => {
    const { ctx, calls } = fakeCtx(['{"title": "Tock and the wind", "shots": 18}'])
    const r = await chatJson(ctx, msgs, shape)
    expect(r.value).toEqual({ title: 'Tock and the wind', shots: 18 })
    expect(r.cost).toBe(0.5)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.schema).toBeTruthy()
  })

  it('repairs once: the second call carries the error and drops the schema', async () => {
    const { ctx, calls } = fakeCtx(['{"title": "x", "shots": "many"}', '{"title": "x", "shots": 15}'])
    const r = await chatJson(ctx, msgs, shape)
    expect(r.value.shots).toBe(15)
    expect(r.cost).toBe(1)
    expect(calls).toHaveLength(2)
    const repair = calls[1]!.messages.at(-1)!.content
    expect(repair).toMatch(/shots/)
    expect(calls[1]!.schema).toBeUndefined()
  })

  it('throws when the repair fails too', async () => {
    const { ctx } = fakeCtx(['nope', 'still nope'])
    await expect(chatJson(ctx, msgs, shape)).rejects.toThrow(/did not return valid JSON twice/)
  })

  it('retries without the schema when the provider rejects it', async () => {
    const { ctx, calls } = fakeCtx([new Error('HTTP 400: response_format not supported'), '{"title": "t", "shots": 1}'])
    const r = await chatJson(ctx, msgs, shape)
    expect(r.value.title).toBe('t')
    expect(calls[0]!.schema).toBeTruthy()
    expect(calls[1]!.schema).toBeUndefined()
  })

  it('does not retry an abort', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' })
    const { ctx, calls } = fakeCtx([abort, '{"title": "t", "shots": 1}'])
    await expect(chatJson(ctx, msgs, shape)).rejects.toThrow('aborted')
    expect(calls).toHaveLength(1)
  })
})

describe('prompt templates', () => {
  it('fills {{vars}} and blanks missing ones', () => {
    expect(render('Theme: {{theme}} / {{ missing }} / {{n}}', { theme: 'windy day', n: 3 })).toBe('Theme: windy day /  / 3')
  })
})
