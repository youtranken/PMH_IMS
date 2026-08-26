-- Kỳ hạn license: thuê bao (có hạn, phải gia hạn) hay mua đứt (dùng mãi).
--
-- Vì sao cần: `software-rules.ts` bắt MỌI license phải có ngày hết hạn. License mua đứt
-- (AutoCad, Office bản vĩnh viễn…) vì thế không khai vào hệ thống được — người dùng buộc phải
-- bịa một ngày, rồi tới ngày đó cỗ máy nhắc hạn đi giục gia hạn một thứ không cần gia hạn.
-- Nhắc sai còn tệ hơn không nhắc: vài lần như vậy là người ta bỏ qua mọi email nhắc còn lại.
--
-- Mặc định `subscription` cho mọi hàng đang có: đó đúng là thứ dữ liệu cũ mô tả (hàng nào
-- cũng đang có end_date bắt buộc). Không đoán ngược hàng nào là mua đứt — để người dùng tự
-- đánh dấu, vì đoán sai thì lặng lẽ tắt cảnh báo hạn của một hồ sơ thật.
ALTER TABLE software
  ADD COLUMN license_model text NOT NULL DEFAULT 'subscription';

ALTER TABLE software
  ADD CONSTRAINT software_license_model_check
  CHECK (license_model IN ('subscription', 'perpetual'));

-- Hai lời khẳng định ngược nhau không được cùng tồn tại ở tầng DB, không chỉ ở tầng ứng dụng:
-- hàng rào cuối cùng phải nằm sát dữ liệu (đường import và mọi script sau này đều đi qua đây).
ALTER TABLE software
  ADD CONSTRAINT software_perpetual_has_no_end_check
  CHECK (license_model <> 'perpetual' OR end_date IS NULL);

-- Chỉ license mới có bản mua đứt; SSL/tên miền luôn có kỳ hạn của nhà cung cấp.
ALTER TABLE software
  ADD CONSTRAINT software_perpetual_only_license_check
  CHECK (license_model <> 'perpetual' OR kind = 'license');
