-- OLD-DB-01 (QUYET-DINH Q-11): nhà mạng của đường truyền là khoá ngoại tới danh mục.
--
-- Trước đây `isp_line.provider` là chữ gõ tự do, danh mục chỉ là gợi ý. Đổi tên hay xoá một
-- nhà mạng trong danh mục không chạm tới đường truyền nào, nên "FPT" / "fpt " / "FPT Telecom"
-- sống song song và lọc, báo cáo, ma trận quyền két đều đếm lệch.
--
-- ===== VÌ SAO GIỮ CỘT `provider` VÀ KHOÁ NÓ BẰNG KHOÁ NGOẠI KÉP =====
--
-- Tên nhà mạng được đọc ở nhiều chỗ chỉ nhìn thấy bảng `isp_line`: cột sinh `search_norm`
-- (cột sinh không đọc được bảng khác), sắp xếp theo cột (chỉ mục 0058), xuất Excel, khu mở rộng
-- trên trang thiết bị, Kho thanh lý, két sắt. Chuyển hết sang join danh mục là join chéo module
-- (AD-2) và mất chỉ mục sắp xếp. Nên `provider` ở lại làm BẢN SAO tên, còn Postgres giữ cho
-- bản sao đó không bao giờ lệch: khoá ngoại (provider_id, provider) → isp_provider (id, name)
-- ON UPDATE CASCADE. Đổi tên trong danh mục là đổi luôn ở mọi đường truyền, trong cùng câu
-- UPDATE, bất kể lượt ghi đi qua cửa nào; ghi một tên không khớp id thì bị 23503.
--
-- `provider` phải thành `citext` vì khoá ngoại đòi cùng kiểu với `isp_provider.name`. Cột sinh
-- `search_norm` bám vào `provider` nên phải gỡ ra rồi dựng lại (bảng vài chục dòng).

-- 1) Dòng không có tên nhà mạng thì không có gì để khớp — gom về một mục danh mục rõ nghĩa.
--    Lịch sử ghi ngay ở đây vì bước 4 chỉ còn thấy chữ đã thay.
INSERT INTO isp_line_history (isp_line_id, action, actor, changes)
SELECT id,
       'updated',
       'system:migration',
       jsonb_build_object(
         'provider', jsonb_build_object('before', provider, 'after', 'Chưa rõ nhà mạng')
       )
  FROM isp_line
 WHERE btrim(provider) = '';

UPDATE isp_line SET provider = 'Chưa rõ nhà mạng' WHERE btrim(provider) = '';

-- 2) Tên đang có mà danh mục chưa có (so không phân biệt hoa-thường và khoảng trắng) → thêm vào
--    danh mục, đang dùng. Nhiều cách viết của cùng một tên chỉ sinh MỘT mục; chọn cách viết theo
--    COLLATE "C" để kết quả tất định và bản viết hoa ("Viettel") thắng bản thường ("viettel").
INSERT INTO isp_provider (name)
SELECT DISTINCT ON (lower(regexp_replace(btrim(l.provider), '\s+', ' ', 'g')))
       regexp_replace(btrim(l.provider), '\s+', ' ', 'g')
  FROM isp_line l
 WHERE NOT EXISTS (
         SELECT 1 FROM isp_provider p
          WHERE lower(regexp_replace(btrim(p.name::text), '\s+', ' ', 'g'))
              = lower(regexp_replace(btrim(l.provider), '\s+', ' ', 'g'))
       )
 ORDER BY lower(regexp_replace(btrim(l.provider), '\s+', ' ', 'g')),
          regexp_replace(btrim(l.provider), '\s+', ' ', 'g') COLLATE "C"
ON CONFLICT (name) DO NOTHING;

-- 3) Nối từng đường truyền vào mục danh mục. Danh mục có sẵn hai mục chỉ khác khoảng trắng thì
--    ưu tiên mục đang dùng, rồi mục cũ nhất — cho kết quả tất định.
ALTER TABLE isp_line
  ADD COLUMN provider_id uuid REFERENCES isp_provider (id) ON DELETE RESTRICT;

UPDATE isp_line l
   SET provider_id = (
         SELECT p.id FROM isp_provider p
          WHERE lower(regexp_replace(btrim(p.name::text), '\s+', ' ', 'g'))
              = lower(regexp_replace(btrim(l.provider), '\s+', ' ', 'g'))
          ORDER BY p.active DESC, p.created_at, p.id
          LIMIT 1
       );

ALTER TABLE isp_line ALTER COLUMN provider_id SET NOT NULL;

CREATE INDEX isp_line_provider_id_idx ON isp_line (provider_id);

-- 4) Chữ cũ được thay bằng đúng tên trong danh mục — ghi một dòng lịch sử cho mỗi hàng bị đổi,
--    để người mở sổ thấy vì sao "fpt " thành "FPT" (AD-13).
INSERT INTO isp_line_history (isp_line_id, action, actor, changes)
SELECT l.id,
       'updated',
       'system:migration',
       jsonb_build_object(
         'provider', jsonb_build_object('before', l.provider, 'after', p.name::text)
       )
  FROM isp_line l
  JOIN isp_provider p ON p.id = l.provider_id
 WHERE l.provider IS DISTINCT FROM p.name::text;

ALTER TABLE isp_line DROP COLUMN search_norm;

ALTER TABLE isp_line ALTER COLUMN provider TYPE citext;

UPDATE isp_line l
   SET provider = p.name
  FROM isp_provider p
 WHERE p.id = l.provider_id
   AND l.provider::text IS DISTINCT FROM p.name::text;

-- 5) Khoá bản sao tên vào danh mục.
ALTER TABLE isp_provider ADD CONSTRAINT isp_provider_id_name_key UNIQUE (id, name);

ALTER TABLE isp_line
  ADD CONSTRAINT isp_line_provider_name_fkey
  FOREIGN KEY (provider_id, provider) REFERENCES isp_provider (id, name)
  ON UPDATE CASCADE ON DELETE RESTRICT;

-- 6) Dựng lại khoá tìm kiếm y như 0052/0056, chỉ thêm `::text` cho cột nay là citext.
ALTER TABLE isp_line ADD COLUMN search_norm text
  GENERATED ALWAYS AS (ims_norm(
    code::text || ' ' || provider::text || ' ' || coalesce(wan_ip, '') || ' '
      || coalesce(contract_no, '')
  )) STORED;

CREATE INDEX isp_line_search_norm_trgm ON isp_line USING gin (search_norm gin_trgm_ops);
