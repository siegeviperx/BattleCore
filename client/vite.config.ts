import { defineConfig } from 'vitest/config';

export default defineConfig({
  // ../shared holds the wire protocol used by both client and server.
  server: { fs: { allow: ['..'] } },
  worker: { format: 'es' },
  test: { environment: 'node' },
});
