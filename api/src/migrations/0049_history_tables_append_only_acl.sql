-- 0049 — ACL CHỈ-THÊM CHO CHÍN BẢNG LỊCH SỬ, KHÔNG CHỈ CHO `audit_log`.
--
-- ===== VÌ SAO CÓ MIGRATION NÀY =====
--
-- `0048` phát quyền bằng `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES` rồi thu lại
-- đúng MỘT bảng: `audit_log`. Chín bảng chỉ-thêm mà `0039` liệt kê nhận trọn UPDATE/DELETE.
--
-- Lập luận của chính `0048` là: trigger chưa đủ, vì trigger là lớp mà CHỦ SỞ HỮU tháo được
-- bằng `ALTER TABLE ... DISABLE TRIGGER`, còn ACL mới là lớp `ims_app` không chạm tới. Lập
-- luận đó đúng y hệt với chín bảng này — D-01 chốt nó cho một bảng rồi dừng. Rà soát chéo
-- đợt A+B ngày 21/09 tìm ra chỗ dừng đó.
--
-- Không phải hồi quy: trước `0048` ứng dụng chạy bằng superuser nên MỌI ACL đều vô nghĩa.
-- Đây là phần còn thiếu của cùng một bản vá, không phải thứ `0048` làm hỏng.
--
-- ===== VÌ SAO TRUNCATE NẰM CÙNG =====
--
-- Trigger `BEFORE UPDATE OR DELETE` không chạy per-row cho `TRUNCATE`, nên với đường đó ACL
-- là hàng rào DUY NHẤT. Một lượt `TRUNCATE device_history` xoá sạch lịch sử thiết bị mà
-- không một trigger nào kêu.
--
-- ===== BẢNG LỊCH SỬ MỚI SINH SAU NÀY =====
--
-- `ALTER DEFAULT PRIVILEGES` của `0048` cấp UPDATE/DELETE cho MỌI bảng chủ sở hữu tạo về
-- sau — kể cả một `*_history` mới, kể cả `audit_log` nếu có ngày nó được tạo lại (mục 13.4
-- của rà soát xếp `PARTITION BY RANGE` cho `audit_log` vào việc phải làm). Nên bản vá này
-- KHÔNG tự bảo vệ tương lai, và không giả vờ là có.
--
-- Thứ canh tương lai là một bài kiểm, không phải một câu SQL: `app-role-privileges.spec.ts`
-- quét ĐỘNG mọi bảng tên `%_history` trong schema và đỏ nếu bảng nào còn UPDATE cho
-- `ims_app`. Bảng lịch sử thứ mười ra đời mà quên REVOKE thì bài đó đỏ ngay hôm ấy.
DO $$
DECLARE
  history_table text;
BEGIN
  FOREACH history_table IN ARRAY ARRAY[
    'catalog_history',
    'device_history',
    'software_history',
    'isp_line_history',
    'renewal_history',
    'ip_history',
    'approval_history',
    'nat_rule_history',
    'service_account_history'
  ]
  LOOP
    -- `to_regclass` chứ không `IF EXISTS`: bảng nào biến mất thì migration phải DỪNG và nói
    -- ra, chứ không im lặng bỏ qua rồi để lại một bảng không có hàng rào.
    IF to_regclass('public.' || history_table) IS NULL THEN
      RAISE EXCEPTION 'Không tìm thấy bảng lịch sử %, lược đồ đã lệch khỏi 0039', history_table;
    END IF;
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I FROM ims_app', history_table);
  END LOOP;
END $$;
