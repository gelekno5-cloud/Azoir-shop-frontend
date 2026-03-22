# Skill: supabase-migration-check

Review a schema change for production safety.

## Steps

1. **Read the migration file.** Read existing migrations it builds on if relevant.

2. **Classify each statement:**

   | Statement | Risk |
   |---|---|
   | `CREATE TABLE` | Low |
   | `ADD COLUMN` with DEFAULT or nullable | Low |
   | `ADD COLUMN` NOT NULL, no DEFAULT | High — fails on live table |
   | `DROP COLUMN` | High — data loss |
   | `RENAME COLUMN` | High — breaks all code references |
   | `CREATE INDEX CONCURRENTLY` | Low |
   | `CREATE INDEX` (blocking) | Medium |
   | `DROP TABLE` | Critical |
   | DML (`UPDATE`/`DELETE`) in migration | High |

3. **Check RLS:** New table needs `ENABLE ROW LEVEL SECURITY` + policies. Renamed columns may break existing policies.

4. **Check Edge Function impact:** Which functions reference the changed table/columns? Will old code break if migration runs before the function is deployed?

5. **Output:**
   - Risk: Low / Medium / High / Critical
   - Blocking issues
   - Deploy order (migration first vs function first)
   - Rollback path
