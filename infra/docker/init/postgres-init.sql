-- PostgreSQL initialization for local development.
-- Creates the uuid-ossp extension and sets timezone.
-- The application schema is applied via drizzle-kit migrations (npm run db:migrate).

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
SET timezone = 'UTC';
