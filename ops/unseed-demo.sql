-- =====================================================================
-- GỠ DỮ LIỆU DEMO — cặp với `ops/seed-demo.sql`. CHỈ DÙNG Ở MÁY DEV.
-- =====================================================================
--
-- CHẠY TRƯỚC MỖI LƯỢT E2E. 30k thiết bị demo đẩy hàng của bài kiểm ra
-- khỏi trang 1 và làm đỏ những bài đi tìm dòng vừa tạo — đúng sự cố
-- 09/09 và 11/09 (27 dải + 11 hồ sơ phần mềm, rồi 24 tài khoản).
--
--   docker exec -i it_qlmgmtip-postgres-1 psql -U ims -d ims -v ON_ERROR_STOP=1 -v allow_demo=1 < ops/unseed-demo.sql
--
-- ===== THỨ TỰ XOÁ LÀ THỨ TỰ KHOÁ NGOẠI, ĐỌC NGƯỢC =====
--
-- Mọi FK trong repo là RESTRICT (27/28, xem `docs/RA-SOAT-TOAN-DIEN-2026-09-19.md`
-- mục 5), nên xoá sai thứ tự là `ROLLBACK` cả khối kèm một thông báo
-- khoá ngoại chẳng liên quan gì tới việc mình đang làm. Danh mục
-- (site · tủ · nhà cung cấp · bộ phận) là thứ MỌI bảng khác trỏ vào,
-- nên nó phải đi CUỐI — cùng bài học mà `reset-e2e.mjs` học ngày 17/09.
-- =====================================================================

-- ===== ĐO ĐƯỢC 20/09/2026: XOÁ 1 TRIỆU THIẾT BỊ MẤT >24 PHÚT =====
--
-- Một `DELETE` duy nhất trên 1.000.001 hàng phải: kiểm 7 khoá ngoại trỏ tới `device`
-- (device_history · device_port ×2 · ip_address · isp_line · license_assignment · nat_rule),
-- cập nhật 8 index của chính `device`, và ghi WAL cho tất cả — trong MỘT transaction, nên
-- không có điểm nào để nghỉ và WAL phình suốt lượt chạy.
--
-- Ở quy mô demo thường dùng (30k-200k) thì script này chạy trong vài chục giây và cứ để
-- nguyên. Nếu lần sau lại gieo tới cả triệu, chia lô sẽ nhanh hơn nhiều vì mỗi lô commit
-- rồi nhả khoá — nhưng nó bỏ tính nguyên tử, nên CHỈ dùng ở máy dev:
--
--   DO $$ DECLARE n int; BEGIN LOOP
--     DELETE FROM device WHERE id IN (SELECT id FROM device WHERE code LIKE 'DM-%' LIMIT 20000);
--     GET DIAGNOSTICS n = ROW_COUNT; EXIT WHEN n = 0; COMMIT;
--   END LOOP; END $$;
--
-- (Chưa đo bản chia lô ở 1 triệu — đừng chép vào đây cho tới khi có người đo.)

-- HÀNG RÀO (DR-09): không có `-v allow_demo=1` thì dừng trước khi chạm dòng dữ liệu nào.
-- Chạy nhầm file này lên prod là trộn/xoá dữ liệu thật theo tiền tố DM%.
\if :{?allow_demo}
\else
\echo 'DỪNG: script dữ liệu demo CHỈ dành cho máy dev. Chạy lại với -v allow_demo=1 nếu đúng là máy dev.'
DO $$ BEGIN RAISE EXCEPTION 'thiếu -v allow_demo=1'; END $$;
\endif

\set ON_ERROR_STOP on
BEGIN;

-- Bảng lịch sử là CHỈ-THÊM (AD-13): trigger chặn DELETE. Lượt gieo đi
-- thẳng vào bảng chính bằng SQL nên KHÔNG đẻ ra dòng lịch sử nào —
-- không có gì phải dọn ở đó, và cũng không được phép dọn.

DELETE FROM nat_rule          WHERE created_by  = 'demo@pmh.com.vn';
DELETE FROM ip_address        WHERE assigned_by = 'demo@pmh.com.vn';
DELETE FROM subnet            WHERE name LIKE 'DM VLAN %';
DELETE FROM license_assignment WHERE assigned_by = 'demo@pmh.com.vn';
DELETE FROM service_account   WHERE code LIKE 'DMSA-%';
DELETE FROM software          WHERE code LIKE 'DMSW-%';
DELETE FROM device            WHERE code LIKE 'DM-%';

-- Danh mục đi cuối.
DELETE FROM cabinet    WHERE site_id IN (SELECT id FROM site WHERE code LIKE 'DMS-%');
DELETE FROM site       WHERE code LIKE 'DMS-%';
DELETE FROM vendor     WHERE name LIKE 'DM %';
DELETE FROM department WHERE name LIKE 'DM %';

COMMIT;

ANALYZE device;
ANALYZE software;
ANALYZE license_assignment;
ANALYZE ip_address;

SELECT 'con lai device DM-'  AS con, count(*) FROM device   WHERE code LIKE 'DM-%'
UNION ALL SELECT 'con lai software DMSW-', count(*) FROM software WHERE code LIKE 'DMSW-%'
UNION ALL SELECT 'con lai site DMS-',      count(*) FROM site     WHERE code LIKE 'DMS-%';
