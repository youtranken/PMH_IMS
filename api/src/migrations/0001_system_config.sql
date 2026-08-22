-- AD-11: tham số vận hành sống trong DB, sửa qua UI Admin, KHÔNG hardcode, KHÔNG env.
CREATE TABLE system_config (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  description text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text
);
