-- Q-13: phần mềm Hết hạn quá số ngày này mà chưa gia hạn thì hệ thống tự Thanh lý và gỡ ghế.
-- 0 = tắt tự thanh lý (vẫn tự chuyển Hết hạn như Q-03).
INSERT INTO system_config (key, value, description) VALUES
  ('software.auto_retire_grace_days', '30',
   'Phần mềm Hết hạn quá bao nhiêu ngày thì hệ thống tự Thanh lý và gỡ ghế license (0 = tắt)');
