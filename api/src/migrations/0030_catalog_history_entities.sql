-- Nới ràng buộc `entity` của `catalog_history` cho ba danh mục mới của 0028.
--
-- Bẫy đã sập: 0028 thêm ba bảng nhưng để nguyên CHECK này, nên thêm một dịch vụ chạy tới câu
-- ghi lịch sử rồi mới nổ — 500, transaction rollback, và người dùng chỉ thấy "Internal server
-- error". Ràng buộc đã làm ĐÚNG việc của nó: chặn một giá trị chưa được khai báo là hợp lệ.
--
-- Bài học ghi lại ở đây vì lần sau vẫn dễ vấp: thêm một loại danh mục là phải sờ tới CẢ danh
-- sách trắng của bảng lịch sử, không chỉ bảng dữ liệu.
ALTER TABLE catalog_history DROP CONSTRAINT catalog_history_entity_check;

ALTER TABLE catalog_history
  ADD CONSTRAINT catalog_history_entity_check
  CHECK (entity IN (
    'site',
    'cabinet',
    'device_type',
    'vendor',
    'department',
    'isp_provider',
    'service_port'
  ));
