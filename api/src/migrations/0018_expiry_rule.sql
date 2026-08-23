-- Story 3.5 (FR-013): luật gửi báo cáo tổng hợp "sắp hết hạn".
-- Chủ sở hữu: module `expiry` (AD-3).
--
-- MỘT luật = MỘT email tổng hợp gửi theo kỳ, KHÔNG phải mail lẻ từng món. Ví dụ:
-- "SSL + tên miền hết hạn trong 30 ngày → sếp + trưởng nhóm, hằng tuần thứ Hai 8 giờ".
CREATE TABLE expiry_rule (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  -- Loại nguồn hạn muốn theo dõi; mảng RỖNG = mọi loại đang đăng ký.
  kinds        jsonb NOT NULL DEFAULT '[]'::jsonb,
  within_days  integer NOT NULL DEFAULT 30,
  -- Người nhận: mảng email. Không dùng vai vì sếp có thể không có tài khoản trong IMS.
  recipients   jsonb NOT NULL DEFAULT '[]'::jsonb,
  frequency    text NOT NULL DEFAULT 'weekly',
  hour         integer NOT NULL DEFAULT 8,
  weekday      integer,
  day_of_month integer,
  active       boolean NOT NULL DEFAULT true,
  -- Mốc chống gửi trùng: sweep chạy mỗi phút, không có mốc này thì một sáng gửi 60 lần.
  last_sent_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT expiry_rule_frequency_check
    CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  CONSTRAINT expiry_rule_hour_check CHECK (hour BETWEEN 0 AND 23),
  CONSTRAINT expiry_rule_weekday_check
    CHECK (weekday IS NULL OR weekday BETWEEN 1 AND 7),
  -- Giới hạn 28 để tháng nào cũng có ngày đó (tháng 2 không có 29/30/31).
  CONSTRAINT expiry_rule_dom_check
    CHECK (day_of_month IS NULL OR day_of_month BETWEEN 1 AND 28),
  CONSTRAINT expiry_rule_within_check CHECK (within_days BETWEEN 1 AND 365)
);

CREATE INDEX expiry_rule_active_idx ON expiry_rule (active) WHERE active;
