#!/usr/bin/env node
// Anthropic Messages API -> OpenCode Zen (OpenAI chat/completions) bridge.
//
// Why this exists: Zen's own /v1/messages shim mangles tool schemas
// ("tools[0].function: missing field `name`") on every free model, but the
// same models handle tools correctly on /v1/chat/completions. Claude Code
// only speaks Anthropic, so we translate in the middle.
//
//   ZEN_API_KEY=sk-... node zen-proxy.mjs
//   -> listens on http://127.0.0.1:8787


import http from 'node:http'
import { createHash } from 'node:crypto'


// Prefix every log line with an ISO timestamp so the proxy log is greppable.
const _error = console.error
console.error = (...a) => _error(new Date().toISOString(), ...a)


const UPSTREAM = process.env.ZEN_BASE_URL ?? 'https://opencode.ai/zen/v1'
const API_KEY = process.env.ZEN_API_KEY
const PORT = Number(process.env.PORT ?? 8787)
const DEBUG = process.env.ZEN_DEBUG === '1'
// Models to try, in order, when the primary fails (free-usage limit or an
// upstream error). Set by the launcher (space-separated); empty means "no
// fallback, pass the error up".
const FALLBACK = (process.env.ZEN_FALLBACK_MODELS ?? '').split(/[\s,]+/).filter(Boolean)


if (!API_KEY) {
  console.error('ZEN_API_KEY is not set')
  process.exit(1)
}


const textOf = (content) =>
  typeof content === 'string'
    ? content
    : (content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('')


// DeepSeek-style reasoning models reject a replayed assistant turn unless its
// original `reasoning_content` comes back with it. Claude Code has no such
// concept, so we stash it here and re-attach on the way back up. Keyed by
// tool_call id when the turn called tools, and by a hash of the reply text
// otherwise -- a text-only turn has no id to hang it on. Bounded so a long
// session can't grow this without limit.
const reasoningByKey = new Map()
const REASONING_MAX = 500

// Stand-in for reasoning we don't have: after a proxy restart the cache is
// empty but Claude Code still replays the whole conversation, and every turn
// then 400s. Upstream only checks the field is present, so a stub keeps the
// session alive instead of wedging it permanently.
const REASONING_STUB = '(reasoning omitted)'

const textKey = (text) =>
  'text:' + createHash('sha1').update(text).digest('hex').slice(0, 16)

function remember(key, reasoning) {
  if (!key || !reasoning) return
  reasoningByKey.set(key, reasoning)
  if (reasoningByKey.size > REASONING_MAX) {
    reasoningByKey.delete(reasoningByKey.keys().next().value)
  }
}


function rememberReasoning(toolCalls, text, reasoning) {
  if (!reasoning) return
  for (const call of toolCalls ?? []) {
    if (call.id) remember('call:' + call.id, reasoning)
  }
  if (text) remember(textKey(text), reasoning)
}


function recallReasoning(toolUses, text) {
  for (const t of toolUses) {
    const hit = reasoningByKey.get('call:' + t.id)
    if (hit) return hit
  }
  return (text && reasoningByKey.get(textKey(text))) || null
}


// Fill in every assistant turn still missing a `reasoning_content`. Returns
// false when there was nothing to fill, so the caller knows a retry is futile.
function fillReasoningStubs(payload) {
  let filled = 0
  for (const m of payload.messages) {
    if (m.role === 'assistant' && !m.reasoning_content) {
      m.reasoning_content = REASONING_STUB
      filled++
    }
  }
  return filled > 0
}

// Models already seen to demand the replay -- stub up front for those so the
// conversation doesn't burn a failed round trip on every single turn.
const demandsReasoning = new Set()


/** Anthropic request -> OpenAI request. */
function toOpenAI(body) {
  const messages = []


  if (body.system) {
    const sys = textOf(body.system)
    if (sys) messages.push({ role: 'system', content: sys })
  }


  for (const msg of body.messages ?? []) {
    const blocks = typeof msg.content === 'string'
      ? [{ type: 'text', text: msg.content }]
      : (msg.content ?? [])


    // tool_result blocks must each become their own OpenAI `tool` message.
    const results = blocks.filter((b) => b.type === 'tool_result')
    for (const r of results) {
      messages.push({
        role: 'tool',
        tool_call_id: r.tool_use_id,
        content: typeof r.content === 'string' ? r.content : textOf(r.content),
      })
    }


    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('')
    const toolUses = blocks.filter((b) => b.type === 'tool_use')


    if (toolUses.length) {
      const assistant = {
        role: 'assistant',
        content: text || null,
        tool_calls: toolUses.map((t) => ({
          id: t.id,
          type: 'function',
          function: { name: t.name, arguments: JSON.stringify(t.input ?? {}) },
        })),
      }
      const reasoning = recallReasoning(toolUses, text)
      if (reasoning) assistant.reasoning_content = reasoning
      messages.push(assistant)
    } else if (text || !results.length) {
      const plain = { role: msg.role, content: text }
      // A text-only assistant turn needs its reasoning replayed just the same.
      if (msg.role === 'assistant') {
        const reasoning = recallReasoning([], text)
        if (reasoning) plain.reasoning_content = reasoning
      }
      messages.push(plain)
    }
  }


  const out = {
    model: body.model,
    messages,
    max_tokens: body.max_tokens,
    stream: !!body.stream,
  }
  if (body.temperature != null) out.temperature = body.temperature
  if (body.top_p != null) out.top_p = body.top_p
  if (body.stop_sequences) out.stop = body.stop_sequences


  if (body.tools?.length) {
    out.tools = body.tools
      // Claude Code sends server-side tool stubs with no schema; skip those.
      .filter((t) => t.name && t.input_schema)
      .map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description ?? '',
          parameters: t.input_schema,
        },
      }))
    if (!out.tools.length) delete out.tools
  }


  if (body.tool_choice) {
    const tc = body.tool_choice
    out.tool_choice =
      tc.type === 'any' ? 'required'
      : tc.type === 'tool' ? { type: 'function', function: { name: tc.name } }
      : tc.type === 'none' ? 'none'
      : 'auto'
  }


  return out
}


const STOP = { stop: 'end_turn', length: 'max_tokens', tool_calls: 'tool_use' }


/** OpenAI (non-streaming) response -> Anthropic response. */
function toAnthropic(oai, model) {
  const choice = oai.choices?.[0] ?? {}
  const msg = choice.message ?? {}
  const content = []


  rememberReasoning(msg.tool_calls, msg.content, msg.reasoning_content)


  if (msg.content) content.push({ type: 'text', text: msg.content })


  for (const call of msg.tool_calls ?? []) {
    let input = {}
    try { input = JSON.parse(call.function.arguments || '{}') } catch {}
    content.push({ type: 'tool_use', id: call.id, name: call.function.name, input })
  }


  if (!content.length) content.push({ type: 'text', text: '' })


  return {
    id: oai.id ?? 'msg_zen',
    type: 'message',
    role: 'assistant',
    model,
    content,
    stop_reason: STOP[choice.finish_reason] ?? 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: oai.usage?.prompt_tokens ?? 0,
      output_tokens: oai.usage?.completion_tokens ?? 0,
    },
  }
}


const sse = (res, event, data) =>
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)


/** Pipe an OpenAI SSE stream out as an Anthropic SSE stream. If the upstream
 *  stalls or errors before any content is emitted, retry via `reResolve` (which
 *  can swap to a different model); once content has started it just ends cleanly. */
async function relayStream(upstream, res, model, reResolve) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })


  const id = 'msg_' + Math.random().toString(36).slice(2)
  sse(res, 'message_start', {
    type: 'message_start',
    message: {
      id, type: 'message', role: 'assistant', model, content: [],
      stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  })


  let index = -1          // current Anthropic content block index
  let textOpen = false
  let contentStarted = false
  const tools = new Map() // OpenAI tool_call index -> Anthropic block index
  const callIds = []      // tool_call ids seen, for the reasoning cache
  let reasoning = ''
  let replyText = ''      // reply text, the cache key for a tool-less turn
  let finish = 'stop'
  let usage = null
  let current = upstream


  const closeBlock = () => {
    if (index >= 0) sse(res, 'content_block_stop', { type: 'content_block_stop', index })
  }


  // End the stream exactly once, sending message_stop so Claude Code doesn't
  // hang when the upstream stalls or errors mid-stream.
  const STREAM_IDLE_MS = Number(process.env.ZEN_STREAM_IDLE_MS ?? 60000)
  const MAX_ATTEMPTS = Number(process.env.ZEN_STREAM_ATTEMPTS ?? 2)
  let done = false
  let idle = null
  const endStream = () => {
    if (done) return
    done = true
    clearTimeout(idle)
    try {
      const b = current?.body
      if (b && b.cancel) b.cancel().catch(() => {})
      else if (b && b.destroy) b.destroy()
    } catch {}
    closeBlock()
    rememberReasoning(callIds, replyText, reasoning)
    sse(res, 'message_delta', {
      type: 'message_delta',
      delta: { stop_reason: STOP[finish] ?? 'end_turn', stop_sequence: null },
      usage: { output_tokens: usage?.completion_tokens ?? 0 },
    })
    sse(res, 'message_stop', { type: 'message_stop' })
    res.end()
  }

  const armIdle = () => {
    clearTimeout(idle)
    idle = setTimeout(() => {
      console.error(`upstream stream stalled (${STREAM_IDLE_MS}ms), closing`)
      endStream()
    }, STREAM_IDLE_MS)
  }

  let decoder = new TextDecoder()
  let buf = ''
  let attempts = 0


  while (!done && attempts < MAX_ATTEMPTS) {
    attempts++
    armIdle()

    let completed = false
    try {
      for await (const chunk of current.body) {
        if (done) break
        armIdle()

        buf += decoder.decode(chunk, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''


        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (!payload || payload === '[DONE]') continue


          let ev
          try { ev = JSON.parse(payload) } catch { continue }
          if (ev.usage) usage = ev.usage


          const choice = ev.choices?.[0]
          if (!choice) continue
          if (choice.finish_reason) finish = choice.finish_reason
          const delta = choice.delta ?? {}
          if (delta.reasoning_content) reasoning += delta.reasoning_content


          if (delta.content) {
            replyText += delta.content
            if (!textOpen) {
              closeBlock()
              index++
              textOpen = true
              contentStarted = true
              sse(res, 'content_block_start', {
                type: 'content_block_start', index,
                content_block: { type: 'text', text: '' },
              })
            }
            sse(res, 'content_block_delta', {
              type: 'content_block_delta', index,
              delta: { type: 'text_delta', text: delta.content },
            })
          }


          for (const call of delta.tool_calls ?? []) {
            const key = call.index ?? 0
            if (!tools.has(key)) {
              closeBlock()
              textOpen = false
              index++
              contentStarted = true
              tools.set(key, index)
              const id = call.id ?? `call_${key}`
              callIds.push({ id })
              sse(res, 'content_block_start', {
                type: 'content_block_start', index,
                content_block: {
                  type: 'tool_use',
                  id,
                  name: call.function?.name ?? '',
                  input: {},
                },
              })
            }
            if (call.function?.arguments) {
              sse(res, 'content_block_delta', {
                type: 'content_block_delta', index: tools.get(key),
                delta: { type: 'input_json_delta', partial_json: call.function.arguments },
              })
            }
          }
        }
      }
      completed = true
    } catch (err) {
      console.error(`upstream stream error: ${err.message ?? err}`)
    }

    if (done || completed || contentStarted) break

    // stream died before any content: swap to a (possibly different) model
    if (reResolve) {
      let next = null
      try { next = await reResolve() } catch (err) {
        if (!(err instanceof UpstreamError)) console.error(`re-resolve error: ${err.message ?? err}`)
      }
      if (next) {
        console.error('stream stalled before content, swapping model')
        current = next
        decoder = new TextDecoder()
        buf = ''
        reasoning = ''
        usage = null
        finish = 'stop'
        continue
      }
    }

    break
  }

  endStream()
}


const UPSTREAM_TIMEOUT_MS = Number(process.env.ZEN_TIMEOUT_MS ?? 120000)
const RETRY_DELAY_MS = 250

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Consume a response body so its socket is released back to the pool.
const drain = async (resp) => {
  try { await resp.text() } catch {}
}

// POST to the upstream. Times out only if the response *headers* don't arrive
// in time, so long streaming generations aren't cut off. Throws on timeout or
// network errors.
const send = async (payload) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
  try {
    return await fetch(`${UPSTREAM}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}


const fail = (res, status, detail) => {
  console.error(`upstream ${status}: ${detail.slice(0, 500)}`)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({
    type: 'error',
    error: { type: 'api_error', message: detail.slice(0, 1000) },
  }))
}


// Should we fail over to a fallback model? True for free-usage/rate limits AND
// upstream provider failures (flaky channels) -- but not genuine request
// errors, which will just repeat on any model.
const isFailover = (status, text) => {
  const t = text ?? ''
  if (status === 429 || /FreeUsageLimitError|rate limit|free usage/i.test(t)) return true
  if (/server_error|upstream request failed|endpoint is unavailable|provider returned error|internal server error/i.test(t)) return true
  if (status === 500 || status === 502 || status === 503 || status === 504) return true
  return false
}


// Send, swallowing connection errors/timeouts (returns null on failure).
const trySend = async (payload) => {
  try { return await send(payload) } catch { return null }
}


// Try each fallback model until one answers.
const tryFallback = async (payload) => {
  for (const alt of FALLBACK) {
    if (alt === payload.model) continue
    const up = await trySend({ ...payload, model: alt })
    if (!up) continue
    if (up.ok) {
      console.error(`failover: ${payload.model} -> ${alt}`)
      return up
    }
    await drain(up)
  }
  return null
}


class UpstreamError extends Error {
  constructor(status, detail) { super(detail); this.status = status }
}


// Retry the same model once (many failures are transient), then fall back to
// another model. Throws the original error if nothing works.
const retryThenFailover = async (payload, status, detail) => {
  await sleep(RETRY_DELAY_MS)
  const again = await trySend(payload)
  if (again && again.ok) {
    console.error(`retry ok: ${payload.model}`)
    return again
  }
  if (again) await drain(again)
  const alt = await tryFallback(payload)
  if (alt) return alt
  throw new UpstreamError(status, detail)
}


// Get a working upstream response for `payload`, applying retry + failover.
const resolve = async (payload) => {
  // initial attempt (retry once on connection errors/timeouts)
  let up = await trySend(payload)
  if (!up) {
    console.error(`upstream connection error, retrying ${payload.model}`)
    await sleep(RETRY_DELAY_MS)
    up = await trySend(payload)
  }

  // reasoning_content replay: a 400 mentioning it gets stubs + a retry.
  if (up && up.status === 400) {
    const detail = await up.text()
    if (detail.includes('reasoning_content')) {
      const stubbed = fillReasoningStubs(payload)
      demandsReasoning.add(payload.model)
      console.error(
        `upstream 400 (reasoning replay): retrying ${payload.model}` +
        (stubbed ? ' with stubs' : ' (nothing to stub)'))
      up = await trySend(payload)
    } else if (isFailover(400, detail)) {
      return retryThenFailover(payload, 400, detail)
    } else {
      throw new UpstreamError(400, detail)
    }
  }

  // any other failure: retry the same model once, then fail over
  if (up && !up.ok) {
    const status = up.status
    const detail = await up.text()
    if (isFailover(status, detail)) {
      return retryThenFailover(payload, status, detail)
    }
    throw new UpstreamError(status, detail)
  }

  // both transport-level attempts failed: try a different model
  if (!up) {
    const alt = await tryFallback(payload)
    if (alt) return alt
    throw new UpstreamError(502, 'upstream unreachable')
  }

  return up
}


const MAX_BODY_BYTES = 20 * 1024 * 1024

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let d = ''
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      d += c
    })
    req.on('end', () => resolve(d))
    req.on('error', reject)
  })


const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')


  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ status: 'ok' }))
  }


  // Claude Code pings this before streaming; a rough estimate is fine.
  // Guarded so a malformed/disconnected request can't crash the process.
  if (url.pathname.endsWith('/count_tokens')) {
    let estimate = 0
    try {
      const body = JSON.parse((await readBody(req)) || '{}')
      const chars = JSON.stringify(body.messages ?? []).length + JSON.stringify(body.system ?? '').length
      estimate = Math.ceil(chars / 4)
    } catch {}
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ input_tokens: estimate }))
  }


  if (req.method !== 'POST' || !url.pathname.includes('/messages')) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'Not found' } }))
  }


  try {
    const body = JSON.parse(await readBody(req))
    const payload = toOpenAI(body)
    if (demandsReasoning.has(payload.model)) fillReasoningStubs(payload)
    if (DEBUG) console.error('->', JSON.stringify(payload).slice(0, 800))


    let upstream
    try {
      upstream = await resolve(payload)
    } catch (err) {
      if (err instanceof UpstreamError) return fail(res, err.status, err.message)
      throw err
    }


    if (payload.stream) return await relayStream(upstream, res, body.model, () => resolve(payload))


    const json = await upstream.json()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(toAnthropic(json, body.model)))
  } catch (err) {
    console.error(err)
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: String(err) } }))
  }
})


server.listen(PORT, '127.0.0.1', () =>
  console.error(`zen-proxy -> ${UPSTREAM}  listening on http://127.0.0.1:${PORT}`))


// Graceful shutdown: close the server, let in-flight requests finish, and exit
// (with a force-exit fallback in case a stream hangs).
const shutdown = () => {
  console.error('shutting down')
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 3000).unref()
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
