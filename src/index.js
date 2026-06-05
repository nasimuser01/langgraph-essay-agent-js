import 'dotenv/config';
import { createEssayGraph } from './graph.js';

async function main() {
  const graph = createEssayGraph();

  const threadConfig = {
    configurable: {
      thread_id: 'essay-thread-1',
    },
  };

  const input = {
    task: 'What is the difference between LangChain and LangSmith?',
    maxRevisions: 2,
    revisionNumber: 1,
  };

  console.log('\nStarting Essay Writer Agent...\n');

  let finalState = null;

  /**
   * streamMode: "updates" means:
   * show only what each node updates.
   */
  const stream = await graph.stream(input, {
    ...threadConfig,
    streamMode: 'updates',
  });

  for await (const chunk of stream) {
    console.log('\n==============================');
    console.log('GRAPH UPDATE');
    console.log('==============================');

    console.dir(chunk, {
      depth: null,
      colors: true,
    });
  }

  /**
   * Get the final state after the graph completes.
   */
  finalState = await graph.getState(threadConfig);

  console.log('\n\n==============================');
  console.log('FINAL ESSAY');
  console.log('==============================\n');

  console.log(finalState.values.draft);

  console.log('\n\n==============================');
  console.log('FINAL PLAN');
  console.log('==============================\n');

  console.log(finalState.values.plan);

  console.log('\n\n==============================');
  console.log('FINAL CRITIQUE');
  console.log('==============================\n');

  console.log(finalState.values.critique);
}

main().catch(function (error) {
  console.error('\nSomething went wrong:');
  console.error(error);
  process.exit(1);
});
