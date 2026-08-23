-- Story 6.2 (FR-023): ma trận quyền xem secret — member × nhóm đối tượng × tầng.
-- Chủ sở hữu: module `vault` (AD-3) — cùng nhà với bảng `secret` vì nó chỉ nói về quyền trên
-- két, không phải quyền chung của hệ thống (quyền chung là `users.role`, AD-9).
--
-- Bảng PHẲNG có chủ đích: một dòng = một lời gán, đọc thẳng ra tiếng Việt ("it01 xem thẳng
-- mọi switch"). Cây phân quyền lồng nhau thì mạnh hơn nhưng sáu tháng sau không ai còn trả
-- lời nổi "vì sao người này xem được cái kia" — mà đó đúng là câu auditor sẽ hỏi.
CREATE TABLE access_list (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Lưu EMAIL chứ không FK sang `users`: nhật ký quyền phải đọc được cả khi tài khoản đã
  -- xóa, đúng nếp của `audit_log.actor`. citext để `IT01@` và `it01@` là một người.
  member_email citext NOT NULL,
  scope_type   text NOT NULL,
  -- id của site / loại thiết bị, hoặc khóa loại phần mềm ('license', 'ssl'…). Tham chiếu
  -- LỎNG: `vault` không được biết bảng của module khác (AD-4 đúng cả chiều ngược lại).
  scope_ref    text NOT NULL,
  tier         text NOT NULL,
  granted_by   text NOT NULL,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT access_scope_check CHECK (scope_type IN ('device_site', 'device_type', 'software_kind')),
  -- 'denied' KHÔNG có ở đây: cấm là MẶC ĐỊNH (không có dòng nào), không phải một lời gán.
  -- Cho gán 'denied' thì sinh ra câu hỏi "dòng cấm có thắng dòng cho phép không" — và câu trả
  -- lời nào cũng làm màn ma trận khó đọc hơn. Muốn cấm thì GỠ dòng đi.
  CONSTRAINT access_tier_check CHECK (tier IN ('whitelist', 'needs_approval'))
);

-- Một người một nhóm chỉ có MỘT tầng. Gán lại = đổi tầng, không đẻ dòng thứ hai.
CREATE UNIQUE INDEX access_list_key ON access_list (member_email, scope_type, scope_ref);
CREATE INDEX access_list_member_idx ON access_list (member_email);
