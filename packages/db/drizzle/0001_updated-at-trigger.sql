-- Hand-written migration: Drizzle cannot express trigger functions.
--
-- Every table with an `updated_at` column gets a BEFORE UPDATE trigger that stamps
-- `now()`. The attach helper is reusable: any future migration that adds a table with
-- `updated_at` must end with `select attach_updated_at_triggers();` so the new table is
-- covered without duplicating this loop.
--
-- Rollback (documented per docs/data-model.md): drop the triggers and the two functions.
--   select attach_updated_at_triggers(); is additive and safe to re-run.

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION attach_updated_at_triggers()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT columns.table_name
    FROM information_schema.columns AS columns
    JOIN information_schema.tables AS tables
      ON tables.table_schema = columns.table_schema
     AND tables.table_name = columns.table_name
    WHERE columns.table_schema = 'public'
      AND columns.column_name = 'updated_at'
      AND tables.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON %I', target.table_name);
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      target.table_name
    );
  END LOOP;
END;
$$;
--> statement-breakpoint

SELECT attach_updated_at_triggers();
