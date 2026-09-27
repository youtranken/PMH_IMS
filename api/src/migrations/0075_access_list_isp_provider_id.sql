-- SEC-13 (QUYET-DINH Q-11): luật quyền két theo nhà mạng khoá bằng ID danh mục, không bằng tên.
--
-- Khoá bằng tên thì đổi tên nhà mạng trong danh mục là lặng lẽ tước quyền: luật vẫn nằm đó,
-- màn ma trận hiện "(đã xóa)", người được gán bị từ chối. Từ 0074 mỗi đường truyền đã có
-- `provider_id`, nên nhóm "đường truyền theo nhà mạng" đổi sang khoá bằng id đó.
--
-- Khớp tên theo ĐÚNG luật của 0074 (không phân biệt hoa-thường, gộp khoảng trắng, ưu tiên mục
-- đang dùng rồi mục cũ nhất): một luật trước đây phủ những đường truyền mang chữ X thì nay phủ
-- đúng mục danh mục mà các đường truyền đó đã được nối vào.
--
-- Hai cách viết của cùng một nhà mạng ("FPT" / "fpt") cho cùng một người gộp thành MỘT luật,
-- giữ tầng HẸP hơn (`needs_approval`): gộp mà nới quyền là cấp thêm thứ chưa ai duyệt.
-- Tên không còn khớp mục nào thì để nguyên — nó không phủ được đường truyền nào, và màn ma trận
-- hiện nó là "(đã xóa)" để SA gỡ.

CREATE TEMP TABLE access_isp_map ON COMMIT DROP AS
SELECT a.id,
       a.member_email,
       a.tier,
       (SELECT p.id::text FROM isp_provider p
         WHERE lower(regexp_replace(btrim(p.name::text), '\s+', ' ', 'g'))
             = lower(regexp_replace(btrim(a.scope_ref), '\s+', ' ', 'g'))
         ORDER BY p.active DESC, p.created_at, p.id
         LIMIT 1) AS provider_ref
  FROM access_list a
 WHERE a.scope_type = 'isp_provider';

DELETE FROM access_list
 WHERE id IN (
         SELECT id FROM (
           SELECT id,
                  row_number() OVER (
                    PARTITION BY member_email, provider_ref
                    ORDER BY (tier = 'needs_approval') DESC, id
                  ) AS rn
             FROM access_isp_map
            WHERE provider_ref IS NOT NULL
         ) ranked
        WHERE rn > 1
       );

UPDATE access_list a
   SET scope_ref = m.provider_ref, updated_at = now()
  FROM access_isp_map m
 WHERE m.id = a.id
   AND m.provider_ref IS NOT NULL;
