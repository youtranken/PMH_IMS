-- FR-002/FR-010: file đính kèm. Nội dung nằm trên volume, DB giữ metadata.
CREATE TABLE file (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_name text NOT NULL,
  stored_name   text NOT NULL UNIQUE,
  mime_type     text NOT NULL,
  size_bytes    bigint NOT NULL,
  owner_type    text NOT NULL,
  owner_id      uuid NOT NULL,
  uploaded_by   uuid NOT NULL REFERENCES users (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE INDEX file_owner_idx ON file (owner_type, owner_id) WHERE deleted_at IS NULL;
