-- Stars from copies of the app Apple DeviceCheck does not vouch for (sideloaded
-- or self-built) are kept with verified = 0, so they can be left out of the
-- counts (COUNT_UNVERIFIED_STARS = "false") or deleted if they are abused.
-- Apply with:
--   npx wrangler d1 migrations apply scriptwell-stars --remote
ALTER TABLE stars ADD COLUMN verified INTEGER NOT NULL DEFAULT 1;
