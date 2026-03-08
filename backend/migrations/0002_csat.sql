-- Migration: US-11 — CSAT/NPS responses table
CREATE TABLE IF NOT EXISTS csat_responses (
  id TEXT PRIMARY KEY,
  ticketId TEXT NOT NULL,
  attendant TEXT,
  serviceId TEXT,
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  flagged BOOLEAN NOT NULL DEFAULT FALSE,
  skipped BOOLEAN NOT NULL DEFAULT FALSE,
  createdAt TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ticketId)
);

CREATE INDEX IF NOT EXISTS idx_csat_attendant ON csat_responses(attendant);
CREATE INDEX IF NOT EXISTS idx_csat_service ON csat_responses(serviceId);
CREATE INDEX IF NOT EXISTS idx_csat_created ON csat_responses(createdAt);
