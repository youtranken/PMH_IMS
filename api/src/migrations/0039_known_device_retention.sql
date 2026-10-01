-- auth.known_device_retention_days: máy không đăng nhập lại quá ngần này ngày thì quên (lượt dọn
-- known-device-purge); lần quay lại được báo thư như thiết bị lạ. Bảng chỉ dùng cho thư đó.
INSERT INTO system_config (key, value, description) VALUES
  ('auth.known_device_retention_days', '180', 'Máy không đăng nhập lại quá bao nhiêu ngày thì hệ thống quên, lần sau đăng nhập sẽ báo thư như thiết bị lạ');
