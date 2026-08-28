-- Số điện thoại và mã nhân viên của tài khoản.
--
-- Vì sao cần: khi một máy báo hỏng lúc 2 giờ sáng, người trực phải gọi được người giữ máy.
-- Trước đây IMS chỉ có email — mà email thì không ai đọc lúc đang chạy sự cố. Mã nhân viên
-- là khoá đối chiếu với bảng lương / hệ thống chấm công của Nhân sự, thứ mà email không thay
-- thế được vì email có thể đổi khi đổi tên miền.
--
-- Cả hai đều CHO PHÉP RỖNG: tài khoản đã tạo từ trước không có sẵn hai giá trị này, và bắt
-- buộc ngay sẽ khoá luôn màn Sửa tài khoản cho tới khi ai đó đi điền đủ cho mọi người.
ALTER TABLE users ADD COLUMN phone         text;
ALTER TABLE users ADD COLUMN employee_code text;
-- `date` chứ không phải `timestamptz`: ngày sinh không có giờ, và nhét nó vào một mốc thời
-- gian có múi giờ là cách chắc chắn để 01/01 thành 31/12 khi đổi máy chủ.
ALTER TABLE users ADD COLUMN birth_date    date;

-- Mã nhân viên là DUY NHẤT khi có khai — hai người cùng mã thì mọi đối chiếu sang bảng lương
-- đều sai, và sai kiểu không ai báo. Index một phần để nhiều dòng NULL vẫn hợp lệ.
CREATE UNIQUE INDEX users_employee_code_uq
  ON users (employee_code)
  WHERE employee_code IS NOT NULL;
