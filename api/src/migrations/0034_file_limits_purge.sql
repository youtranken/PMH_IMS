-- file.purged_at + ba tham số giấy tờ đính kèm (Q-18).
--
-- purged_at: nội dung (blob) của một file đã xoá mềm đã bị gỡ khỏi ổ đĩa. Hàng được GIỮ để lịch
-- sử và nhật ký còn nói được "ai đã đính kèm gì, ai đã xoá"; chỉ nội dung là không còn. Cột thêm
-- vào không có DEFAULT nên Postgres không viết lại bảng.
--
-- Không có index cho lượt dọn: bảng `file` chỉ vài nghìn hàng, quét hết mỗi phút rẻ hơn giữ thêm
-- một index trên mọi lần tải lên.
ALTER TABLE file ADD COLUMN purged_at timestamp with time zone;

INSERT INTO system_config (key, value, description) VALUES
  ('file.max_size_mb', '25', 'Dung lượng tối đa của MỘT file đính kèm, tính bằng MB (mọi loại: ảnh, PDF, Word, Excel, PowerPoint)'),
  ('file.max_files_per_batch', '6', 'Số file tối đa mỗi lượt chọn / kéo thả để đính kèm'),
  ('file.purge_after_days', '30', 'File đã xoá quá ngần này ngày thì gỡ nội dung khỏi ổ đĩa. Hàng và nhật ký vẫn giữ; qua mốc này không khôi phục được nội dung');
