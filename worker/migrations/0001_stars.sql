-- Stars for gallery scripts. Apply with:
--   npx wrangler d1 migrations apply scriptwell-stars --remote

-- One row per (script, install). `voter` is sha256(<install's random secret> + ":" + <script id>),
-- so a row cannot be tied to the install, and two rows from one install cannot be tied to each other.
CREATE TABLE IF NOT EXISTS stars (
  script_id  TEXT NOT NULL,
  voter      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (script_id, voter)
) WITHOUT ROWID;

-- Stars carried over from before the service counted them (the old 👍 reactions). Added to the live count.
CREATE TABLE IF NOT EXISTS star_baseline (
  script_id TEXT PRIMARY KEY,
  stars     INTEGER NOT NULL
);

-- Daily rate-limit counters: "ip:<sha256 of address>:<day>" and "all:<day>". Old days are swept now and then.
CREATE TABLE IF NOT EXISTS star_limits (
  key   TEXT PRIMARY KEY,
  day   TEXT NOT NULL,
  count INTEGER NOT NULL
);
