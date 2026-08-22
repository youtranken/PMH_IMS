-- NFR-03: mọi login / giải mã / thay đổi. Giữ vĩnh viễn.
CREATE TABLE audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor       text NOT NULL,
  action      text NOT NULL,
  object_type text,
  object_id   text,
  ip          text,
  detail      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created_idx ON audit_log (created_at DESC);
CREATE INDEX audit_log_object_idx  ON audit_log (object_type, object_id);
CREATE INDEX audit_log_actor_idx   ON audit_log (actor, created_at DESC);
