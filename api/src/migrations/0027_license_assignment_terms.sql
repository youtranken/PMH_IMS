-- Kỳ hạn và chi phí RIÊNG của từng chỗ ngồi (ghế) trên một license.
--
-- Vì sao cần: một license 10 ghế hầu như không bao giờ mua một lần. Kế toán mua 3 ghế theo
-- hợp đồng HD-2026-014 giá 3,5tr/ghế kỳ 2026; Xưởng mua thêm 2 ghế hợp đồng khác, giá khác,
-- kỳ khác. Trước migration này mọi con số ấy chỉ có MỘT ô duy nhất ở tầng hồ sơ, nên câu hỏi
-- hay gặp nhất lúc quyết toán — "ghế này thuộc hợp đồng nào, hết hạn khi nào, tốn bao nhiêu"
-- — không trả lời được, dù dữ liệu vốn có thật.
--
-- `cost` là bigint tiền ĐỒNG, không phải numeric: VND không có phần lẻ, và số nguyên thì
-- cộng dồn không bao giờ lệch xu như kiểu dấu phẩy động.
ALTER TABLE license_assignment
  ADD COLUMN cost bigint,
  ADD COLUMN contract text,
  ADD COLUMN start_date date,
  ADD COLUMN end_date date;

-- Chi phí âm không phải chi phí. 0 thì hợp lệ: license tặng kèm máy vẫn phải ghi nhận.
ALTER TABLE license_assignment
  ADD CONSTRAINT license_assignment_cost_check
  CHECK (cost IS NULL OR cost >= 0);

-- Hàng rào cuối cùng phải nằm sát dữ liệu, không chỉ ở tầng ứng dụng: đường import và mọi
-- script vá tay sau này đều đi qua đây.
ALTER TABLE license_assignment
  ADD CONSTRAINT license_assignment_period_check
  CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date);
