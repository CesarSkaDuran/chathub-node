import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html'],
      include: ['src/**/*.js'],
      exclude: [
        'src/index.js',
        'src/db/knex.js',
        'src/db/migrations.js',
        'src/db/seed.js',
        'src/db/reset.js',
      ],
    },
  },
})
