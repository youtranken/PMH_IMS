-- Step-up có phạm vi (AD-17, Q-23 "nhập ở đâu tính ở đó") — chủ: auth (AD-3).
-- `stepped_up_at` giữ nghĩa két; `diagram_stepped_up_at` là mốc riêng của phạm vi sơ đồ, để mã nhập
-- khi xem sơ đồ không mở két và ngược lại. NULL = chưa nhập mã cho phạm vi đó trong phiên này.
ALTER TABLE sessions ADD COLUMN diagram_stepped_up_at timestamp with time zone;

INSERT INTO system_config (key, value, description) VALUES
  ('diagram.stepup_grace_minutes', '10', 'Nhập mã 2 lớp để xem sơ đồ xong thì bao nhiêu phút tới mở bản vẽ khác không phải nhập lại. Tính riêng với ân hạn của két');
