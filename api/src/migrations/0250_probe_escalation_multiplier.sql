/*
 * Lá cảnh báo leo thang trong thời gian nghỉ của canh dò két (OLD-SEC-01).
 *
 * Thời gian nghỉ (`secret.probe_cooldown_minutes`) chặn ngập hộp thư, nhưng nghỉ tuyệt đối thì
 * kẻ dò bắn thêm hàng trăm lượt sau lá đầu mà không ai biết. Vượt hệ số × ngưỡng trong lúc nghỉ
 * thì đi thêm đúng một lá. 3 = gấp ba ngưỡng, con số checklist go-live đặt ra.
 */
INSERT INTO system_config (key, value, description) VALUES
  ('secret.probe_escalation_multiplier', '3',
   'Trong thời gian nghỉ sau một lá cảnh báo dò két, số lượt thất bại vượt hệ số này × ngưỡng thì gửi thêm MỘT lá leo thang. Tối thiểu 2')
ON CONFLICT (key) DO NOTHING;
