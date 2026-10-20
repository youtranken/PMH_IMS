-- Trần số điểm ảnh của ảnh tải lên (AD-11): xét từ header lúc tải lên và trước khi thu nhỏ ảnh,
-- để ảnh nén nhỏ mà khai cỡ khổng lồ không làm api giải mã cả GB rồi bị OOM-kill.
INSERT INTO system_config (key, value, description) VALUES
  ('file.max_image_megapixels', '50', 'Số triệu điểm ảnh tối đa của một ảnh tải lên; lớn hơn thì từ chối, ảnh cũ vượt trần thì không hiện ảnh xem trước');
