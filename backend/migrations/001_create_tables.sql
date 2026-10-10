-- Scenarios and their runs (system-plan.md, Runs and Per-Run Store). No arrays here: a run's
-- data lives in its folder; this is the small, queryable state.

CREATE TABLE scenarios (
    id          uuid PRIMARY KEY,
    config      jsonb NOT NULL,              -- the scenario's current configuration
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE runs (
    id             uuid PRIMARY KEY,
    scenario_id    uuid NOT NULL REFERENCES scenarios (id) ON DELETE CASCADE,
    snapshot       jsonb NOT NULL,           -- the exact submitted scenario this run computes
    status         text NOT NULL DEFAULT 'queued'
                   CHECK (status IN ('queued', 'running', 'done', 'failed')),
    phase          text CHECK (phase IN ('terrain', 'engine', 'finalizing')),
    percent        real NOT NULL DEFAULT 0,
    message        text NOT NULL DEFAULT 'Queued',
    error          jsonb,                    -- {error, message, retryable} when failed
    folder         text NOT NULL,            -- relative to the runs directory, e.g. tmp/<id>
    saved_name     text,
    view_settings  jsonb,
    created_at     timestamptz NOT NULL DEFAULT now(),
    started_at     timestamptz,
    finished_at    timestamptz
);

-- The worker's claim query: oldest queued run first.
CREATE INDEX runs_queued ON runs (created_at) WHERE status = 'queued';
CREATE INDEX runs_scenario ON runs (scenario_id);
