-- Tài khoản dịch vụ: tài khoản DÙNG CHUNG và tài khoản VPN.
--
-- Vì sao cần một bảng riêng: két sắt chỉ gắn được vào thiết bị hoặc hồ sơ phần mềm, nên mật
-- khẩu email dùng chung của Kế toán, tài khoản cổng VNPT, tài khoản ngân hàng… không có chỗ
-- nào để đứng. Chúng không phải một cái máy, cũng không phải một license.
--
-- Vì sao MỘT bảng cho cả hai loại chứ không hai bảng: cả hai đều là "một tài khoản có mật
-- khẩu cất trong két + có người chịu trách nhiệm", chỉ khác vài ô. Dự án đã có sẵn khuôn này
-- ở bảng `software` (một cột `kind`, ô nào chỉ thuộc một loại thì chỉ hiện với loại đó — ô
-- `seat_total` chỉ dành cho license). Tách hai bảng thì mọi thứ dùng chung — tab két sắt, tab
-- giấy tờ, lịch sử, phân quyền — phải viết hai lần và sẽ trôi lệch nhau.
CREATE TABLE service_account (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text NOT NULL,
  kind           text NOT NULL,
  name           text NOT NULL,
  -- Tên đăng nhập: email với tài khoản dùng chung, username với VPN.
  login          text,
  department     text,
  -- Người chịu trách nhiệm. Text tự do chứ KHÔNG phải khóa ngoại sang `users`: người phụ
  -- trách một tài khoản dùng chung có thể là một bộ phận ("Kế toán"), có thể là người chưa
  -- có tài khoản IMS, và ép thành khóa ngoại là ép khai sai cho vừa cái ô.
  owner_name     text,
  -- CHỈ dành cho loại 'vpn' — nhóm trên máy chủ VPN và dải IP được phép kết nối.
  group_name     text,
  allowed_ips    text,
  note           text,
  status         text NOT NULL DEFAULT 'active',
  created_by     text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_account_kind_check   CHECK (kind IN ('shared', 'vpn')),
  CONSTRAINT service_account_status_check CHECK (status IN ('active', 'disabled'))
);

-- Mã là thứ người ta gọi tên tài khoản trong biên bản; trùng mã là hai hồ sơ không phân biệt
-- được. So sánh KHÔNG phân biệt hoa/thường vì "TK-KETOAN" và "tk-ketoan" là cùng một thứ.
CREATE UNIQUE INDEX service_account_code_uq ON service_account (lower(code));
CREATE INDEX service_account_kind_idx ON service_account (kind) WHERE status = 'active';

-- Lịch sử nghiệp vụ (AD-13): append-only, không sửa không xóa.
CREATE TABLE service_account_history (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_account_id uuid NOT NULL REFERENCES service_account (id) ON DELETE RESTRICT,
  action             text NOT NULL,
  actor              text NOT NULL,
  changes            jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX service_account_history_idx
  ON service_account_history (service_account_id, created_at DESC);

-- Cùng khuôn với `device_history` / `software_history`: chặn UPDATE/DELETE ở tầng DB, không
-- trông vào việc code nhớ đừng làm.
CREATE OR REPLACE FUNCTION service_account_history_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'service_account_history là append-only (AD-13)';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER service_account_history_no_delete
  BEFORE UPDATE OR DELETE ON service_account_history
  FOR EACH ROW EXECUTE FUNCTION service_account_history_no_delete();
