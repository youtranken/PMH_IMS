-- Số hợp đồng và chi phí của TỪNG lượt gia hạn (Q-15, SW-049).
--
-- Nằm ở sổ gia hạn chứ không phải cột của hồ sơ: mỗi năm một hợp đồng, một mức giá. Để ở hồ
-- sơ thì lượt gia hạn năm sau đè mất hợp đồng năm trước, và câu hỏi quyết toán "năm 2026
-- license này gia hạn theo hợp đồng nào, hết bao nhiêu" không còn trả lời được.
--
-- Cả hai cột nullable: bỏ trống là chưa khai, KHÁC 0 đồng. `cost` là bigint tiền đồng như
-- `license_assignment.cost` (0027) — VND không có phần lẻ.
--
-- Bảng vẫn chỉ-thêm: REVOKE và trigger chặn UPDATE/DELETE của 0017 áp cho cả bảng, gồm cột mới.
ALTER TABLE renewal_history
  ADD COLUMN contract text,
  ADD COLUMN cost bigint;

ALTER TABLE renewal_history
  ADD CONSTRAINT renewal_history_cost_check
  CHECK (cost IS NULL OR cost >= 0);
