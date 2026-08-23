-- Story 5.3 (FR-017): sổ NAT / port-forward trên các thiết bị Draytek.
-- Chủ sở hữu: module `ipam` (AD-3) — cùng chủ với `ip_address` vì một rule NAT chỉ có nghĩa
-- khi gắn được với một IP trong, và ranh giới giữa hai thứ đó là ranh giới giả.
--
-- Mục tiêu của story viết rõ: auditor hỏi "port nào mở, vì sao, cho ai" là trả lời được ngay.
-- Nên `reason` và `used_by` KHÔNG phải trường tùy chọn cho đẹp — chúng là lý do bảng này tồn tại.

-- `btree_gist` để EXCLUDE dưới đây so được `=` trên uuid/text cạnh `&&` trên khoảng port.
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE nat_rule (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Thiết bị Draytek mang rule. RESTRICT: xóa router đang có rule phải là việc có ý thức.
  device_id       uuid NOT NULL REFERENCES device (id) ON DELETE RESTRICT,
  protocol        text NOT NULL,
  -- Khoảng port ngoài. Một port lẻ thì from = to — không phải hai cột kiểu khác nhau.
  external_from   integer NOT NULL,
  external_to     integer NOT NULL,
  internal_ip     inet NOT NULL,
  internal_port   integer NOT NULL,
  -- Liên kết MỀM sang hồ sơ IP: có thì bấm sang xem được chủ, không có cũng không sao.
  -- SET NULL chứ không RESTRICT: ẩn một hồ sơ IP không được phép làm kẹt cả sổ NAT.
  ip_address_id   uuid REFERENCES ip_address (id) ON DELETE SET NULL,
  used_by         text NOT NULL,
  reason          text NOT NULL,
  enabled         boolean NOT NULL DEFAULT true,
  note            text,
  created_by      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  voided_at       timestamptz,
  voided_by       text,
  void_reason     text,
  CONSTRAINT nat_protocol_check CHECK (protocol IN ('tcp', 'udp', 'both')),
  CONSTRAINT nat_external_range_check CHECK (
    external_from BETWEEN 1 AND 65535
    AND external_to BETWEEN 1 AND 65535
    AND external_from <= external_to
  ),
  CONSTRAINT nat_internal_port_check CHECK (internal_port BETWEEN 1 AND 65535),
  CONSTRAINT nat_internal_ipv4_check CHECK (family(internal_ip) = 4),
  CONSTRAINT nat_void_check CHECK (
    (voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL)
    OR (voided_at IS NOT NULL AND voided_by IS NOT NULL AND void_reason IS NOT NULL)
  )
);

/*
 * Hai rule KHÔNG được chồng port ngoài trên cùng một router.
 *
 * Đây là ràng buộc đắt nhất của bảng và cũng là ràng buộc đáng giá nhất: sổ NAT tồn tại để
 * trả lời "port 8080 mở cho ai". Có hai dòng chồng nhau thì câu trả lời là hai — và cái sổ
 * mất đúng công dụng của nó. EXCLUDE bắt được cả trường hợp chồng MỘT PHẦN (8000-8010 và
 * 8005-8020), thứ mà UNIQUE trên hai cột không bao giờ thấy.
 *
 * `both` cố ý KHÔNG chồng với `tcp`/`udp` ở tầng DB — Draytek cho phép khai riêng TCP và UDP
 * cùng port, nên chặn ở đây là chặn nhầm việc hợp lệ. Service cảnh báo chỗ đó.
 */
ALTER TABLE nat_rule ADD CONSTRAINT nat_rule_no_overlap
  EXCLUDE USING gist (
    device_id WITH =,
    protocol WITH =,
    int4range(external_from, external_to, '[]') WITH &&
  ) WHERE (voided_at IS NULL);

CREATE INDEX nat_rule_device_idx ON nat_rule (device_id) WHERE voided_at IS NULL;
CREATE INDEX nat_rule_ip_idx ON nat_rule (ip_address_id) WHERE voided_at IS NULL;
CREATE INDEX nat_rule_internal_idx ON nat_rule (internal_ip) WHERE voided_at IS NULL;
