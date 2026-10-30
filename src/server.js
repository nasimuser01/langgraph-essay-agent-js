/**
 * Express server that streams the essay agent's steps as Server-Sent Events.
 *
 * Run:   npm run server
 * Then:  curl -N "http://localhost:3000/api/run?topic=LangGraph"
 *
 * Event types sent to the client:
 *   step      { step, status, revision? }        a node started or finished
 *   plan      { text }                            the outline
 *   queries   { step, queries }                   search queries for a research node
 *   search    { step, question, status, results?, error? }
 *   token     { step, text }                      a streamed chunk of the essay
 *   draft     { revision, text }                  a finished draft
 *   critique  { text }                            the reviewer's feedback
 *   done      { draft, plan, critique, revisions }
 *   error     { message }
 */

import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';

import { createEssayGraph } from './graph.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, '..', 'web', 'dist');

export const app = express();
const graph = createEssayGraph();

function sendEvent(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

app.get('/api/run', async function (req, res) {
  const topic = String(req.query.topic ?? '').trim();
  const maxRevisions = Math.min(Number(req.query.maxRevisions) || 2, 4);

  if (topic.length < 3 || topic.length > 300) {
    res.status(400).json({ error: 'topic must be 3 to 300 characters' });
    return;
  }

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  const controller = new AbortController();
  req.on('close', () => controller.abort());

  const config = {
    configurable: { thread_id: randomUUID() },
    signal: controller.signal,
    streamMode: ['custom', 'updates'],
  };

  try {
    const stream = await graph.stream(
      { task: topic, maxRevisions, revisionNumber: 1 },
      config,
    );

    for await (const [mode, chunk] of stream) {
      if (mode === 'custom') {
        const { event, ...data } = chunk;
        sendEvent(res, event, data);
      } else if (mode === 'updates') {
        for (const node of Object.keys(chunk)) {
          sendEvent(res, 'step', { step: node, status: 'done' });
        }
      }
    }

    const final = await graph.getState(config);
    const { draft, plan, critique, revisionNumber } = final.values;
    sendEvent(res, 'done', { draft, plan, critique, revisions: revisionNumber - 1 });
  } catch (err) {
    if (!controller.signal.aborted) {
      sendEvent(res, 'error', { message: `${err.name}: ${err.message}` });
    }
  } finally {
    res.end();
  }
});

// Serve the built React app when `npm run web:build` has been run.
if (existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get('/{*splat}', (_req, res) => res.sendFile(path.join(DIST, 'index.html')));
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => console.log(`Essay agent server on http://localhost:${port}`));
}
