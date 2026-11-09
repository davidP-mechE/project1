-- Runs once, the first time the Postgres container starts.
CREATE DATABASE coursebook_test OWNER coursebook;
\c coursebook
CREATE EXTENSION IF NOT EXISTS vector;
\c coursebook_test
CREATE EXTENSION IF NOT EXISTS vector;
