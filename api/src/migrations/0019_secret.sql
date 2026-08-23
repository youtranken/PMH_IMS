-- Story 4.1 (FR-021, NFR-02, AD-4): két sắt.
-- Chủ sở hữu: module `vault` — và CHỈ `vault` được đụng bảng này. dependency-cruiser có luật
-- `secret-table-only-in-vault` chặn mọi module khác import `vault/*.schema.ts`.
--
-- Plaintext KHÔNG BAO GIỜ chạm bảng này: chỉ có ciphertext + IV + tag + DEK đã bọc.
-- AAD gồm đủ ba thành phần (bảng, record_id, key_version) nên ciphertext bê từ hàng này
-- sang hàng khác là giải không ra.
CREATE TABLE secret (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Gắn vào thiết bị hoặc phần mềm. Tham chiếu LỎNG (không FK) vì vault không được biết
  -- bảng của module khác — đúng chiều AD-4: các module không chạm vault, vault cũng không
  -- chạm ngược lại.
  owner_type    text NOT NULL,
  owner_id      uuid NOT NULL,
  kind          text NOT NULL,
  -- Nhãn để phân biệt nhiều secret trên cùng một thiết bị: "admin web", "SSH root", "SNMP".
  label         text NOT NULL,
  -- Tên đăng nhập đi kèm — KHÔNG phải bí mật, để tra cứu mà không cần mở két.
  username      text,
  -- Năm cột envelope (NFR-02).
  value_ct      bytea NOT NULL,
  value_iv      bytea NOT NULL,
  value_tag     bytea NOT NULL,
  dek_wrapped   bytea NOT NULL,
  key_version   integer NOT NULL,
  note          text,
  created_by    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- Thu hồi = xóa mềm (convention "Xóa"): mật khẩu cũ phải còn vết ai từng cất, cất lúc nào.
  revoked_at    timestamptz,
  revoked_by    text,
  CONSTRAINT secret_owner_type_check CHECK (owner_type IN ('device', 'software')),
  CONSTRAINT secret_kind_check CHECK (kind IN ('password', 'license_key', 'other')),
  CONSTRAINT secret_revoke_check CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);

CREATE INDEX secret_owner_idx ON secret (owner_type, owner_id) WHERE revoked_at IS NULL;
-- Một chủ thể không nên có hai secret cùng nhãn còn hiệu lực — dễ mở nhầm cái cũ.
CREATE UNIQUE INDEX secret_label_key ON secret (owner_type, owner_id, lower(label))
  WHERE revoked_at IS NULL;
