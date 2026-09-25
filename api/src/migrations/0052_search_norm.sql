-- B-01 — GẤP DẤU TIẾNG VIỆT CHO Ô TÌM KIẾM (25/09/2026).
--
-- ===== LỖI ĐANG CHỮA =====
--
-- `ILIKE` KHÔNG gấp dấu: `SELECT 'Thiết bị họp' ILIKE '%thiet%'` trả `f`. Đo trên 30.000
-- thiết bị thật (§13.3 sổ rà soát): gõ `Máy trạm` ra 2.500 dòng, gõ `may tram` ra 0 dòng.
-- 7.500/30.000 hồ sơ — một phần tư đội máy — vô hình với người gõ không dấu, và màn hình
-- còn trả lời "Chưa có thiết bị nào khớp bộ lọc", tức khẳng định một điều sai.
--
-- ===== VÌ SAO PHẢI BỌC `unaccent` LẠI =====
--
-- Cả hai dạng `unaccent()` của contrib đều STABLE, không IMMUTABLE (đo trên Postgres 17.10,
-- `pg_proc.provolatile = 's'` cho cả hai). Postgres từ chối STABLE ở cột sinh và ở chỉ mục.
-- Nên phải có một hàm bọc khai IMMUTABLE.
--
-- Bọc như vậy là một lời hứa: "kết quả không bao giờ đổi với cùng đầu vào". Nó đúng CHỪNG
-- NÀO từ điển `unaccent` không bị sửa. Sửa từ điển rồi thì `search_norm` đã lưu sẽ KHÔNG tự
-- tính lại và chỉ mục cũng không — phải `ALTER TABLE ... ALTER COLUMN search_norm DROP
-- EXPRESSION` rồi dựng lại. Đây là cái giá đã biết và chấp nhận, không phải chỗ bị bỏ sót.
--
-- Truyền TÊN TỪ ĐIỂN tường minh (`'public.unaccent'::regdictionary`) chứ không gọi dạng một
-- tham số: dạng một tham số tra từ điển qua `search_path` lúc chạy, tức kết quả phụ thuộc
-- phiên — đúng thứ một hàm IMMUTABLE không được phép làm.
--
-- Dùng thân hàm kiểu mới (`RETURN ...` thay cho `AS $$ ... $$`): Postgres phân giải tên ngay
-- lúc tạo và lưu cây đã phân giải, nên `search_path` lúc GỌI không đổi được ý nghĩa thân hàm.
--
-- ===== VÌ SAO CỘT SINH CHỨ KHÔNG PHẢI CHỈ MỤC BIỂU THỨC =====
--
-- Chỉ mục biểu thức không cần viết lại bảng, nhưng bắt MỌI câu truy vấn chép lại y nguyên
-- biểu thức mới khớp được — sáu service, sáu bản chép, và một dấu cách lệch là mất chỉ mục
-- trong im lặng. Cột sinh đổi cái giá đó lấy một lượt viết lại bảng (vài giây) và cho câu
-- truy vấn đọc được: `search_norm LIKE ims_norm($1)`.
--
-- ===== PHẠM VI: 5 BẢNG, KHÔNG PHẢI 8 =====
--
-- Danh mục (site · cabinet · device_type · vendor · department · isp_provider · service_port)
-- CỐ Ý không có cột sinh: vài chục tới vài trăm dòng, quét tuần tự là chuyện không đáng bàn,
-- còn cột sinh + chỉ mục GIN cho mỗi bảng là trả giá mà không mua được gì. Chúng gọi
-- `ims_norm()` tại chỗ (`imsNormLike` trong `common/sql.ts`) — vẫn ĐÚNG, chỉ là không nhanh,
-- và ở cỡ ấy thì không cần nhanh.
--
-- `users` và `audit_log` cũng cố ý đứng ngoài: `users` là nhân sự IT nội bộ, luôn dưới vài
-- trăm dòng; `audit_log.actor` là email nên không có dấu tiếng Việt để mà gấp.
--
-- Bài canh cho tất cả những điều trên: `api/test/search-norm.spec.ts`.

CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE FUNCTION ims_norm(value text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  RETURN lower(unaccent('public.unaccent'::regdictionary, value));

COMMENT ON FUNCTION ims_norm(text) IS
  'Gấp dấu tiếng Việt cho tìm kiếm. Phải cho kết quả Y HỆT foldSearch() ở '
  'api/src/common/search-fold.ts và web/src/lib/search-fold.ts. Bảng chuẩn dùng chung: '
  'ops/search-fold-cases.json.';

-- Nối bằng `coalesce(...) || ' ' || ...` chứ KHÔNG dùng `concat_ws`: `concat_ws` là STABLE
-- (nó gọi được hàm xuất kiểu của kiểu bất kỳ), nên Postgres từ chối nó trong cột sinh.
-- `code` là `citext` ở cả bốn bảng có cột đó — ép `::text` để phép nối có kiểu tường minh.
--
-- Bốn/năm cột dưới đây đúng bằng bộ cột mà `buildWhere` cũ viết bốn/năm vế ILIKE. Một khác
-- biệt CÓ CHỦ Ý: từ khóa giờ khớp được QUA ranh giới cột ("001 may" ra "DM-000123 Máy trạm"),
-- thứ bốn vế ILIKE rời nhau không làm được. Đó là mở rộng, không phải mất mát.

ALTER TABLE device ADD COLUMN search_norm text
  GENERATED ALWAYS AS (ims_norm(
    code::text || ' ' || name || ' ' || coalesce(serial, '') || ' ' || coalesce(model, '')
  )) STORED;

ALTER TABLE software ADD COLUMN search_norm text
  GENERATED ALWAYS AS (ims_norm(
    code::text || ' ' || name || ' ' || coalesce(note, '')
  )) STORED;

ALTER TABLE service_account ADD COLUMN search_norm text
  GENERATED ALWAYS AS (ims_norm(
    code::text || ' ' || name || ' ' || coalesce(login, '') || ' '
      || coalesce(department, '') || ' ' || coalesce(owner_name, '')
  )) STORED;

ALTER TABLE isp_line ADD COLUMN search_norm text
  GENERATED ALWAYS AS (ims_norm(
    code::text || ' ' || provider || ' ' || coalesce(wan_ip, '') || ' '
      || coalesce(contract_no, '')
  )) STORED;

-- `host(inet)` là IMMUTABLE (đo: `pg_proc.provolatile = 'i'`), nên dùng được ở đây. Sổ NAT
-- vốn đã tìm theo `host(internal_ip)` chứ không theo `internal_ip::text` — giữ nguyên nếp ấy
-- để "10.0.0.5" gõ vào vẫn khớp, không bị mặt nạ mạng chen vào.
ALTER TABLE nat_rule ADD COLUMN search_norm text
  GENERATED ALWAYS AS (ims_norm(
    used_by || ' ' || reason || ' ' || host(internal_ip)
  )) STORED;
