#!/bin/sh
# Retain Freemail messages for 3 days. Empty legacy mailboxes (no access code)
# older than 3 days are pruned; mailboxes with an access code are kept so the
# public lookup code always resolves to the same address.
set -eu
LOCK=/run/freemail-retention-cleanup.lock
exec 9>"$LOCK"
flock -n 9 || { echo "Another retention cleanup is already running" >&2; exit 0; }

container=freemail-postgres
user=$(docker inspect "$container" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^POSTGRES_USER=//p')
db=$(docker inspect "$container" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^POSTGRES_DB=//p')
[ -n "$user" ] && [ -n "$db" ]

# received_at and created_at are ISO-8601 timestamps. Deleting messages first
# preserves the foreign-key relation before pruning now-empty old mailboxes.
docker exec -i -e PGUSER="$user" -e PGOPTIONS='-c maintenance_work_mem=16MB -c max_parallel_maintenance_workers=0' "$container" psql -v ON_ERROR_STOP=1 -d "$db" <<'SQL'
BEGIN;
WITH deleted AS (
  DELETE FROM public.messages
  WHERE received_at::timestamptz < now() - interval '3 days'
  RETURNING 1
)
SELECT count(*) AS deleted_expired_messages FROM deleted;
WITH deleted AS (
  DELETE FROM public.mailboxes m
  WHERE m.created_at::timestamptz < now() - interval '3 days'
    AND m.access_code IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.messages msg WHERE msg.mailbox_id = m.id)
  RETURNING 1
)
SELECT count(*) AS deleted_empty_expired_mailboxes FROM deleted;
COMMIT;
VACUUM (ANALYZE) public.messages;
VACUUM (ANALYZE) public.mailboxes;
SQL
