-- AD-5: mọi email đi qua outbox, commit chung transaction nghiệp vụ.
CREATE TABLE outbox (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic          text NOT NULL,
  payload        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  claimed_at     timestamptz,
  processed_at   timestamptz,
  fail_count     integer NOT NULL DEFAULT 0,
  last_error     text,
  last_failed_at timestamptz
);
-- Relay chỉ quét việc chưa xử; index partial giữ nó nhỏ mãi mãi.
CREATE INDEX outbox_pending_idx ON outbox (created_at) WHERE processed_at IS NULL;
