/*
 * DỌN INDEX VÀ SIẾT RÀNG BUỘC — rà soát 07/09, mục 6 "CSDL".
 *
 * Sáu việc, đo được từng việc bằng `EXPLAIN` hoặc bằng `pg_indexes`, không việc nào là thẩm mỹ.
 */

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. MÀN NHẬT KÝ QUÉT TOÀN BẢNG.
--
-- `audit-query.service.ts` lọc bằng `actor ILIKE '%x%'` và `object_id ILIKE '%x%'`. Dấu sao ở
-- ĐẦU chuỗi làm mọi index btree vô dụng — kể cả `audit_log_actor_idx (actor, created_at DESC)`
-- vốn dựng ra đúng cho câu này. Nên mỗi lượt lọc là một lượt quét toàn bộ `audit_log`, một
-- bảng CHỈ-THÊM giữ vĩnh viễn theo NFR-03: nó chỉ có thể to lên, và màn hình chỉ có thể chậm
-- đi. Vài tháng nữa không ai mở nổi màn này, đúng lúc cần nó nhất (điều tra một sự cố).
--
-- Không đổi ngữ nghĩa sang "khớp tiền tố": tìm giữa chuỗi là đúng thứ người dùng cần ở đây
-- ("mọi việc nguyen đã làm"). Thay vào đó dùng chỉ mục trigram — `pg_trgm` sinh ra đúng để
-- `ILIKE '%…%'` chạy được bằng index.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS audit_log_actor_trgm ON audit_log USING gin (actor gin_trgm_ops);
CREATE INDEX IF NOT EXISTS audit_log_object_id_trgm
  ON audit_log USING gin (object_id gin_trgm_ops);

-- Ô CHỌN "Hành động" gọi `SELECT DISTINCT action FROM audit_log`. Không có index trên `action`
-- thì đó là một lượt quét toàn bảng nữa — cho một dropdown chừng 60 giá trị. Index này để câu
-- "loose index scan" ở service chạy được: nó nhảy từ giá trị này sang giá trị kế tiếp bằng
-- index thay vì đọc hết mọi dòng.
CREATE INDEX IF NOT EXISTS audit_log_action_idx ON audit_log (action);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. INDEX NAT KHÔNG DÙNG ĐƯỢC.
--
-- `nat_rule_internal_idx` nằm trên cột `internal_ip` thô, nhưng MỌI câu truy vấn đều bọc nó
-- trong `host(...)` (`host(internal_ip) ILIKE …`, `host(internal_ip) IN …`) vì cột là kiểu
-- `inet` và người dùng gõ địa chỉ trần. Một hàm quanh cột được đánh chỉ mục là chỉ mục KHÔNG
-- bao giờ được chọn — index vẫn tốn chỗ và tốn công ghi, chỉ không bao giờ giúp đọc.
--
-- Đánh chỉ mục ĐÚNG BIỂU THỨC mà truy vấn dùng.
DROP INDEX IF EXISTS nat_rule_internal_idx;
CREATE INDEX nat_rule_internal_host_idx
  ON nat_rule (host(internal_ip)) WHERE voided_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. BỐN INDEX TRÙNG — tiền tố của một index UNIQUE đã có.
--
-- Postgres dùng được index nhiều cột cho truy vấn chỉ lọc theo cột ĐẦU, nên mỗi cặp dưới đây
-- là một bản sao thừa: nó không giúp đọc thêm gì, mà mỗi lượt INSERT/UPDATE vẫn phải cập nhật
-- cả hai cây. `ip_address_subnet_idx` còn trùng khít hoàn toàn — cùng cột, cùng cả mệnh đề
-- `WHERE voided_at IS NULL`.
--
--   access_list_member_idx (member_email)            ⊂ access_list_key (member_email, scope_type, scope_ref)
--   cabinet_site_idx       (site_id)                 ⊂ cabinet_code_per_site_key (site_id, code)
--   device_port_device_idx (device_id)               ⊂ device_port_label_key (device_id, port_label)
--   ip_address_subnet_idx  (subnet_id, address) WHERE… ≡ ip_address_key (subnet_id, address) WHERE…
DROP INDEX IF EXISTS access_list_member_idx;
DROP INDEX IF EXISTS cabinet_site_idx;
DROP INDEX IF EXISTS device_port_device_idx;
DROP INDEX IF EXISTS ip_address_subnet_idx;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. `service_account.code` LÀ BẢNG DUY NHẤT LỆCH QUY ƯỚC `citext`.
--
-- Năm bảng còn lại có cột `code` (`site`, `cabinet`, `device`, `software`, `isp_line`) đều
-- dùng `citext`, nên `code = 'sv-01'` tìm ra `SV-01`. Riêng bảng này là `text`, và nó phải tự
-- vá bằng `UNIQUE (lower(code))` — chặn được trùng, nhưng KHÔNG chữa việc tra cứu: cùng một
-- câu lệnh, một bảng tìm ra và một bảng không. Đúng loại khác biệt không ai nhớ nổi.
ALTER TABLE service_account ALTER COLUMN code TYPE citext;

-- `citext` tự lo phần không phân biệt hoa thường, nên chỉ mục `lower(code)` thành thừa —
-- và nó còn che mất việc cột đã đổi kiểu.
DROP INDEX IF EXISTS service_account_code_uq;
CREATE UNIQUE INDEX service_account_code_uq ON service_account (code);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. `file.owner_type` KHÔNG CÓ RÀNG BUỘC NÀO.
--
-- Danh sách hợp lệ chỉ tồn tại ở TypeScript (`FILE_OWNER_TYPES` + `@IsIn` trên DTO). Nghĩa là
-- một đường ghi mới quên validate, một script dọn dữ liệu, hay một câu INSERT tay đều nhét
-- được `'devices'` (thừa chữ s) vào bảng — và hàng đó sẽ vô hình mãi mãi: mọi màn đều lọc
-- theo `owner_type` đúng chính tả, còn tệp thì vẫn nằm trên đĩa. Cùng lý do với
-- `ip_address_status_check` và `subnet_void_check` đã có từ 0020.
ALTER TABLE file ADD CONSTRAINT file_owner_type_check
  CHECK (owner_type IN ('device', 'isp', 'software', 'service_account', 'subnet', 'nat_rule'));
