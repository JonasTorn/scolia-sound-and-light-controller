import { Application } from './Application';

const app = new Application();
app.start().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});

