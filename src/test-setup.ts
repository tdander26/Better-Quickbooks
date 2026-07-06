// Vitest setup: ensure DB-backed tests have a datasource + encryption key.
// Uses the local SQLite dev database (schema pushed via `npm run db:push`).
process.env.DATABASE_URL ||= "file:./dev.db";
process.env.ENCRYPTION_KEY ||= "0".repeat(64);
process.env.AUTH_SECRET ||= "test-secret";
