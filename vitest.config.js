import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      exclude: [
        'src/index.js',        // Entry point — just wires modules together
        'src/events.js',       // Discord event handlers — requires live client to test
        'src/commands/index.js', // Slash command registration — requires Discord API
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 65,
        statements: 70,
      },
    },
  },
});
