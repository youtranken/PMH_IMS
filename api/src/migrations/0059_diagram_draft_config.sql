-- Bản vẽ đang vẽ dở cất (đã mã hoá) ở trình duyệt: số giờ giữ trước khi tự bỏ (AD-11, Q-23). Chỉ seed system_config.
INSERT INTO system_config (key, value, description) VALUES
  ('diagram.draft_keep_hours', '24', 'Số giờ trình duyệt giữ bản vẽ đang vẽ dở (đã mã hoá) để khôi phục khi tab đóng, mất mạng hay hết phiên; quá hạn thì bỏ');
