import { createDbMock } from './dbMock.js'

// Per-test-file singleton. Vitest isolates the module graph per test file, so
// each test file gets its own db mock instance. The `vi.mock` factory for
// `src/db/knex.js` and the test body both import this same module, ensuring the
// code under test and the assertions share one mock.
export const db = createDbMock()
