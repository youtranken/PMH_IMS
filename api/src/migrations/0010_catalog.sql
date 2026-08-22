-- Story 2.1 (FR-004): danh mục dùng chung — site, tủ mạng, loại thiết bị, nhà cung cấp.
-- Chủ sở hữu: module `catalog` (AD-3). Module khác đọc qua CatalogApiService, không query thẳng.
--
-- Vì sao FK có ON DELETE RESTRICT ở mọi bảng tham chiếu tới đây (device ở migration sau):
-- AC 2.1 "mục đang được thiết bị tham chiếu không xóa được, chỉ vô hiệu". Tầng nền `catalog`
-- KHÔNG được biết tầng nghiệp vụ `devices` (AD-2) nên không thể tự đi đếm — để Postgres chặn,
-- service bắt lỗi 23503 và trả CATALOG_IN_USE.

CREATE TABLE site (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       citext NOT NULL UNIQUE,
  name       text NOT NULL,
  address    text,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cabinet (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id     uuid NOT NULL REFERENCES site (id) ON DELETE RESTRICT,
  code        citext NOT NULL,
  description text,
  u_height    integer,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  -- Mã tủ chỉ cần duy nhất TRONG một site: "R01" ở văn phòng và "R01" ở nhà máy là hai tủ khác nhau.
  CONSTRAINT cabinet_code_per_site_key UNIQUE (site_id, code),
  CONSTRAINT cabinet_u_height_check CHECK (u_height IS NULL OR (u_height > 0 AND u_height <= 60))
);
CREATE INDEX cabinet_site_idx ON cabinet (site_id);

CREATE TABLE device_type (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         citext NOT NULL UNIQUE,
  -- Loại này có bảng port map ở trang chi tiết không (FR-006).
  has_port_map boolean NOT NULL DEFAULT false,
  description  text,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE vendor (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       citext NOT NULL UNIQUE,
  supplies   text,
  phone      text,
  contact    text,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- AD-13: lịch sử thay đổi danh mục, APPEND-ONLY. `audit_log` là nhật ký an ninh cho SA;
-- bảng này là lịch sử nghiệp vụ hiện ngay trên màn danh mục (HistoryPanel dùng chung).
CREATE TABLE catalog_history (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity     text NOT NULL,
  entity_id  uuid NOT NULL,
  action     text NOT NULL,
  actor      text NOT NULL,
  changes    jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalog_history_entity_check
    CHECK (entity IN ('site', 'cabinet', 'device_type', 'vendor'))
);
CREATE INDEX catalog_history_entity_idx ON catalog_history (entity, entity_id, created_at DESC);

-- Hàm chặn UPDATE/DELETE dùng chung cho MỌI bảng lịch sử (AD-13) — device_history ở
-- migration sau gắn trigger vào đúng hàm này, không viết lại.
CREATE OR REPLACE FUNCTION history_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Bảng % là append-only (AD-13): cấm %', TG_TABLE_NAME, TG_OP;
END $$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user) THEN
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON catalog_history FROM %I', current_user);
  END IF;
END $$;

CREATE TRIGGER catalog_history_no_update BEFORE UPDATE ON catalog_history
  FOR EACH ROW EXECUTE FUNCTION history_append_only();
CREATE TRIGGER catalog_history_no_delete BEFORE DELETE ON catalog_history
  FOR EACH ROW EXECUTE FUNCTION history_append_only();
