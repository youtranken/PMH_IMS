-- Story 3.2 (FR-011): gán license vào thiết bị theo seat.
-- Chủ sở hữu: module `software` (AD-3) — bảng nói về "license nào đang nằm ở máy nào",
-- mà license là tài sản của software.
--
-- KHÔNG xóa dòng khi gỡ gán (convention "Xóa" + AC 3.2): đánh dấu `released_at`.
-- "Key này từng nhập máy nào" là câu hỏi kiểm toán hay gặp nhất khi rà license.
CREATE TABLE license_assignment (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  software_id  uuid NOT NULL REFERENCES software (id) ON DELETE RESTRICT,
  device_id    uuid NOT NULL REFERENCES device (id) ON DELETE RESTRICT,
  assigned_by  text NOT NULL,
  assigned_at  timestamptz NOT NULL DEFAULT now(),
  released_by  text,
  released_at  timestamptz,
  -- Lý do bắt buộc khi gán vượt số seat (AC 3.2: cho ghi đè nhưng phải nói vì sao).
  over_seat_reason text,
  note         text,
  CONSTRAINT license_assignment_release_check
    CHECK ((released_at IS NULL) = (released_by IS NULL))
);

-- MỘT license chỉ gán MỘT lần vào MỘT máy — nhưng chỉ tính dòng còn hiệu lực.
-- Gỡ ra rồi gán lại cùng máy là hợp lệ (máy cài lại), nên index phải có điều kiện.
CREATE UNIQUE INDEX license_assignment_active_key
  ON license_assignment (software_id, device_id)
  WHERE released_at IS NULL;

CREATE INDEX license_assignment_software_idx ON license_assignment (software_id)
  WHERE released_at IS NULL;
CREATE INDEX license_assignment_device_idx ON license_assignment (device_id)
  WHERE released_at IS NULL;
