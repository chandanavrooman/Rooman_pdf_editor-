// SCRIPTED MODEL (TEST DOUBLE) — a tiny OpenAI-compatible /v1/chat/completions server used only by the full-stack e2e tests.
// It never calls any real model: it answers according to the last user message so the tests can exercise everything that
// comes AFTER the model for real (SSE streaming, citations, MCP tool calls, confirmations, real PDF processing).
import http from 'node:http'

const port = Number(process.env.FAKE_LLM_PORT ?? 8102)
const stats = { requests: 0, lastAuth: null, lastModel: null }

const lastOf = (messages, role) => [...messages].reverse().find((m) => m.role === role)
const uuid32 = /[0-9a-f]{32}/

function decide(body) {
  const messages = body.messages ?? []
  const lastUserIdx = messages.map((m) => m.role).lastIndexOf('user')
  const user = String(messages[lastUserIdx]?.content ?? '')
  const toolMsgs = messages.slice(lastUserIdx + 1).filter((m) => m.role === 'tool')
  const system = String(messages.find((m) => m.role === 'system')?.content ?? '')
  const docId = (system.match(uuid32) ?? [])[0]
  const tools = body.tools?.length ? body.tools : null
  const payload = (i) => {
    try {
      return JSON.parse(toolMsgs[i]?.content ?? '{}')
    } catch {
      return {}
    }
  }

  // Generic directive used by the feature matrix: "RUN_TOOL <tool name> <json args>" ("$DOC" = the chat's document id).
  // First turn: call that tool with those arguments; after the tool result: report the outcome in plain text.
  // the backend appends retrieved document text after a blank line, so only the first line is the user's directive
  const directive = /^RUN_TOOL\s+(\w+)\s*(\{.*\})?\s*$/.exec(user.split('\n')[0].trim())
  if (tools && directive) {
    if (toolMsgs.length === 0) {
      const args = JSON.parse((directive[2] ?? '{}').replaceAll('$DOC', docId ?? ''))
      return { tool: { name: directive[1], arguments: args } }
    }
    const p = payload(0)
    return { text: `TOOL_DONE ${directive[1]} ok=${p.ok !== false}${p.declined ? ' declined' : ''}` }
  }
  if (tools && /extract pages 1-3, then compress/i.test(user)) {
    if (toolMsgs.length === 0) return { tool: { name: 'extract_pages', arguments: { document_id: docId, pages: '1-3' } } }
    if (toolMsgs.length === 1) {
      const out = payload(0).documents?.[0]
      return { tool: { name: 'compress_pdf', arguments: { document_id: out?.id, level: 'medium' } } }
    }
    return { text: 'I extracted pages 1-3 and then compressed the result. The file is ready to download.' }
  }
  if (tools && /delete pages 1,2/i.test(user)) {
    if (toolMsgs.length === 0) return { tool: { name: 'delete_pages', arguments: { document_id: docId, pages: '1,2' } } }
    return { text: payload(0).ok === false ? 'Okay, I did not delete anything.' : 'I removed pages 1 and 2. The new file is ready to download.' }
  }
  if (/what is in chapter 2/i.test(user)) return { text: 'Chapter 2 is described on [p. 2], and the introduction is on [p. 1].' }
  return { text: 'This is a scripted answer based on the document [p. 1].' }
}

http
  .createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/__stats') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(stats))
      return
    }
    if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
      res.writeHead(404).end()
      return
    }
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', async () => {
      const body = JSON.parse(raw)
      stats.requests += 1
      stats.lastAuth = req.headers.authorization ?? null
      stats.lastModel = body.model ?? null
      const d = decide(body)
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      const chunk = (delta, finish = null) => res.write(`data: ${JSON.stringify({ id: 'chatcmpl-fake', object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`)
      chunk({ role: 'assistant', content: '' })
      const text = d.text ?? ''
      for (let i = 0; i < text.length; i += 6) {
        chunk({ content: text.slice(i, i + 6) })
        await new Promise((r) => setTimeout(r, 2))
      }
      if (d.tool) {
        const args = JSON.stringify(d.tool.arguments)
        const half = Math.floor(args.length / 2)
        chunk({ tool_calls: [{ index: 0, id: `call_${stats.requests}`, type: 'function', function: { name: d.tool.name, arguments: args.slice(0, half) } }] })
        chunk({ tool_calls: [{ index: 0, function: { arguments: args.slice(half) } }] })
      }
      chunk({}, d.tool ? 'tool_calls' : 'stop')
      res.write('data: [DONE]\n\n')
      res.end()
    })
  })
  .listen(port, '127.0.0.1', () => console.log(`scripted model (test double) on ${port}`))
