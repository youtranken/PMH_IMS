-- OLD-DB-04 · `isp_line.wan_ip` từ text sang inet.
--
-- Q-04 chốt "1 IP mỗi line"; form web từ lâu chỉ nhận một IPv4 hoặc một khối IPv4/prefix. Cột
-- text là chỗ duy nhất còn nhận "động" hay "1.2.3.4 - 1.2.3.9", và mọi phép so IP (sổ NAT tra
-- WAN của router) phải tự đoán dạng. inet nhận đúng hai dạng form cho phép và in lại y như gõ
-- (địa chỉ trần in không kèm /32).

/*
 * DỪNG TRƯỚC, ĐỪNG ĐỂ POSTGRES TỰ NÉM. Migration chạy trước `app.listen`; một câu
 * "invalid input syntax for type inet" không cho người trực biết sửa dòng nào. Việc phải làm:
 * sửa IP WAN của các đường liệt kê (màn Đường truyền; "động" thì để trống và ghi vào ghi chú)
 * rồi chạy lại.
 */
DO $$
DECLARE
  bad_report text;
BEGIN
  SELECT string_agg(format('%s: "%s"', code, wan_ip), E'\n' ORDER BY code)
    INTO bad_report
    FROM isp_line
   WHERE btrim(wan_ip) <> ''
     AND NOT pg_input_is_valid(btrim(wan_ip), 'inet');

  IF bad_report IS NOT NULL THEN
    RAISE EXCEPTION E'IP WAN của các đường truyền sau không phải địa chỉ IP hay khối IP:\n%\n\nSửa hoặc để trống (ghi "động" vào ghi chú) rồi chạy lại migration.', bad_report;
  END IF;
END $$;

-- Cột sinh `search_norm` đọc `wan_ip`, nên Postgres không cho đổi kiểu khi nó còn đó.
ALTER TABLE isp_line DROP COLUMN search_norm;

ALTER TABLE isp_line
  ALTER COLUMN wan_ip TYPE inet USING NULLIF(btrim(wan_ip), '')::inet;

-- Dựng lại như 0074. `abbrev` chứ không `::text`: `::text` luôn kèm "/32", khoá tìm sẽ chứa
-- thứ màn hình không bao giờ in.
ALTER TABLE isp_line ADD COLUMN search_norm text
  GENERATED ALWAYS AS (ims_norm(
    code::text || ' ' || provider::text || ' ' || coalesce(abbrev(wan_ip), '') || ' '
      || coalesce(contract_no, '')
  )) STORED;

CREATE INDEX isp_line_search_norm_trgm ON isp_line USING gin (search_norm gin_trgm_ops);
