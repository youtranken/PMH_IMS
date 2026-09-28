-- Người duyệt break-glass thấy "người này đã xin N lần trong X ngày" để nhận ra người xin quá
-- thường (VLT-FLOW). X là luật của bộ phận IT, không phải hằng số hiển thị (AD-11).
INSERT INTO system_config (key, value, description) VALUES
  ('breakglass.recent_window_days', '30',
   'Cửa sổ ngày để đếm số lần một người đã xin break-glass, hiện cho người duyệt');
