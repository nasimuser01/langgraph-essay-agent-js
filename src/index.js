/**
 * Command-line runner.
 *
 *   npm start -- "What is the difference between LangChain and LangSmith?"
 */

import 'dotenv/config';
import { createEssayGraph } from './graph.js';

async function main() {
  const task =
    process.argv.slice(2).join(' ') ||
    'What is the difference between LangChain and LangSmith?';

  const graph = createEssayGraph();
  const config = {
    configurable: { thread_id: 'essay-cli' },
    streamMode: ['custom'],
  };

  console.log(`\nTopic: ${task}\n`);

  const stream = await graph.stream({ task, maxRevisions: 2, revisionNumber: 1 }, config);

  for await (const [, ev] of stream) {
    switch (ev.event) {
      case 'step':
        console.log(`\n--- ${ev.step.toUpperCase()}${ev.revision ? ` (revision ${ev.revision})` : ''} ---`);
        break;
      case 'search':
        if (ev.status === 'running') console.log(`Searching: ${ev.question}`);
        else if (ev.error) console.log(`  failed: ${ev.error}`);
        else console.log(`  ${ev.results.length} results`);
        break;
      case 'token':
        process.stdout.write(ev.text);
        break;
      case 'draft':
        process.stdout.write('\n');
        break;
      default:
        break;
    }
  }

  const final = await graph.getState(config);
  console.log('\n==============================');
  console.log('FINAL ESSAY');
  console.log('==============================\n');
  console.log(final.values.draft);
}

main().catch(function (error) {
  console.error('\nSomething went wrong:');
  console.error(error);
  process.exit(1);
});
