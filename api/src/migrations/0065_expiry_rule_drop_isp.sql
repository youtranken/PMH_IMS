-- DOM-10 (QUYET-DINH Q-10): đường truyền không còn hạn (Q-04), nên loại `isp` rời khỏi luật mail.
-- `kinds = []` nghĩa là "mọi loại", nên luật CHỈ có `isp` không được gỡ thành rỗng — tắt nó đi
-- và giữ nguyên `kinds`, bật lại cũng không nhắc gì. Luật có nhiều loại thì chỉ gỡ `isp`.
UPDATE expiry_rule
   SET active = false, updated_at = now()
 WHERE kinds = '["isp"]'::jsonb;

UPDATE expiry_rule
   SET kinds = kinds - 'isp', updated_at = now()
 WHERE kinds ? 'isp' AND jsonb_array_length(kinds) > 1;
