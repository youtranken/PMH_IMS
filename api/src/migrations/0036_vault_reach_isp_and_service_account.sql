-- Két sắt với tới ĐƯỜNG TRUYỀN, và ma trận quyền với tới TÀI KHOẢN DỊCH VỤ + ĐƯỜNG TRUYỀN.
--
-- Hai lỗ hổng cùng một họ, tìm ra khi rà soát liên kết 28/08/2026 (docs/DANH-GIA-LIEN-KET.md).
--
-- 1. `secret.owner_type` chưa nhận 'isp' trong khi `file.owner_type` đã nhận từ lâu. Nghĩa là
--    hợp đồng PDF của đường truyền đính vào được, còn mật khẩu PPPoE và tài khoản quản trị
--    modem nhà mạng thì không có chỗ đứng — hai thứ luôn đi cùng nhau ngoài đời. Người dùng
--    còn đúng hai đường và cả hai đều sai: gắn nhờ vào hồ sơ router (đổi router là mất dấu),
--    hoặc ghi vào ô Ghi chú của `isp_line` — chỗ KHÔNG mã hóa, đúng thứ két sắt sinh ra để dọn.
--
-- 2. `access_list.scope_type` chưa có nhóm nào phủ tài khoản dịch vụ. Nó cất được mật khẩu từ
--    migration 0033 nhưng tầng quyền của mọi Member trên mọi secret loại đó vĩnh viễn là CẤM —
--    kể cả khi SA muốn cấp thì cũng không có ô nào để chọn. Thêm 'isp_provider' luôn cho khỏi
--    lặp lại đúng lỗ hổng đó với đường truyền ngay sau khi mục 1 mở cửa cho nó.
--
-- Cả hai đều là whitelist CÓ BẢN SAO Ở TẦNG DB (bài học 0033: whitelist ba tầng, tầng DB là
-- tầng bị quên). Sửa ở đây rồi phải sửa cả `SECRET_OWNER_TYPES`, `SecretOwnerType` bên web,
-- và `SCOPE_TYPES`.

ALTER TABLE secret DROP CONSTRAINT IF EXISTS secret_owner_type_check;
ALTER TABLE secret ADD CONSTRAINT secret_owner_type_check
  CHECK (owner_type IN ('device', 'software', 'service_account', 'isp'));

ALTER TABLE access_list DROP CONSTRAINT IF EXISTS access_scope_check;
ALTER TABLE access_list ADD CONSTRAINT access_scope_check
  CHECK (scope_type IN (
    'device_site',
    'device_type',
    'software_kind',
    'service_account_kind',
    'isp_provider'
  ));
