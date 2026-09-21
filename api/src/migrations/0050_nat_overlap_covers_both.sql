-- A-04 (rà soát 19/09, vá 21/09): trọng tài cho "both chồng lên tcp/udp" chuyển xuống DB.
--
-- ===== LỖ =====
--
-- `nat_rule_no_overlap` của 0022 so `protocol WITH =`. Chú thích ở đó nói rõ đấy là cố ý —
-- Draytek cho khai riêng TCP và UDP cùng một port, và chặn chuyện đó là chặn nhầm việc hợp lệ
-- — rồi nhường phần còn lại cho service.
--
-- Vế "nhường cho service" mới là chỗ hỏng. `NatRuleService.requireNoProtocolOverlap` chạy
-- trên `this.db`, NGOÀI mọi transaction, TRƯỚC khi `db.transaction` mở ra. Nó là một phép
-- đọc-rồi-quyết không khóa gì, nên hai lượt ghi song song cùng đọc thấy sổ trống:
--
--     T1 đọc siblings → trống          T2 đọc siblings → trống
--     T1 BEGIN; INSERT tcp 8080        T2 BEGIN; INSERT both 8080
--     T1 COMMIT                        T2 COMMIT
--
-- Cả hai lọt. DB không cản vì 'tcp' <> 'both'. Sổ NAT có HAI câu trả lời cho TCP/8080 — đúng
-- thứ bảng này sinh ra để không bao giờ có.
--
-- ===== VÌ SAO VÁ Ở ĐÂY CHỨ KHÔNG THÊM MỘT CÁI KHÓA =====
--
-- Kéo phép kiểm vào trong transaction rồi khóa hàng `device` cũng chạy được. Nhưng nó đẻ ra
-- một QUY ƯỚC — "ai ghi vào nat_rule thì nhớ khóa router trước" — và quy ước là thứ người ta
-- quên. Cả đợt rà soát 19-21/09 này, sáu trên sáu lỗ đều là một quy ước bị quên ở đúng MỘT
-- cửa trong nhiều cửa. Ràng buộc DB thì không quên được, và nó đúng ở mọi mức đồng thời mà
-- không phải khóa gì.
--
-- ===== MẸO: GIAO THỨC THÀNH KHOẢNG, `=` THÀNH `&&` =====
--
--     tcp → [1,1]        udp → [2,2]        both → [1,2]
--
-- `tcp && udp` rỗng  ⇒ hai giao thức riêng vẫn khai chung port được (giữ nguyên ý 0022).
-- `tcp && both` khác rỗng ⇒ bị chặn.
-- `both && both` khác rỗng ⇒ bị chặn.
--
-- Không cần extension mới: `btree_gist` (0022) đã đủ cho `device_id WITH =`, còn `&&` trên
-- int4range là thứ gist làm sẵn.
--
-- Phép kiểm trong service KHÔNG bị gỡ — nó vẫn là đường cho câu lỗi tử tế (nói rõ đụng rule
-- nào). Nó chỉ thôi làm trọng tài DUY NHẤT. `NatRuleService.translate` đã ánh xạ sẵn 23P01
-- sang `NAT_PORT_OVERLAP`, nên đường vào nào không qua nổi cửa service vẫn nhận 409 tiếng
-- Việt chứ không phải 500.

/*
 * DỪNG TRƯỚC, ĐỪNG ĐỂ POSTGRES TỰ NÉM.
 *
 * Ràng buộc mới chặt hơn ràng buộc cũ, nên một DB đã dính đúng cái đua ở trên sẽ có sẵn cặp
 * rule phạm luật. `ALTER TABLE ... ADD CONSTRAINT` gặp chuyện đó sẽ ném 23P01 với câu
 * "conflicting key value violates exclusion constraint" — đúng về kỹ thuật và vô dụng với
 * người trực: migration chạy TRƯỚC `app.listen`, nên họ nhận một api không lên được và một
 * câu lỗi không nói phải làm gì.
 *
 * Nên tự hỏi trước, và nếu có thì nói thẳng cặp nào đụng cặp nào. Việc phải làm là gỡ một
 * trong hai rule (đường "Gỡ" trên màn Sổ NAT, có ghi lý do) rồi chạy lại.
 */
DO $$
DECLARE
  clash_report text;
BEGIN
  SELECT string_agg(
           format('router %s: %s %s-%s (id %s) đụng %s %s-%s (id %s)',
                  a.device_id, upper(a.protocol), a.external_from, a.external_to, a.id,
                  upper(b.protocol), b.external_from, b.external_to, b.id),
           E'\n')
    INTO clash_report
    FROM nat_rule a
    JOIN nat_rule b
      ON b.device_id = a.device_id
     AND b.id > a.id
     AND b.voided_at IS NULL
     AND int4range(a.external_from, a.external_to, '[]')
      && int4range(b.external_from, b.external_to, '[]')
     -- 'both' phủ cả hai giao thức; hai giao thức riêng khác nhau thì không đụng.
     AND (a.protocol = b.protocol OR a.protocol = 'both' OR b.protocol = 'both')
   WHERE a.voided_at IS NULL;

  IF clash_report IS NOT NULL THEN
    RAISE EXCEPTION E'Sổ NAT đang có rule chồng port mà ràng buộc cũ không bắt được:\n%\n\nGỡ một trong mỗi cặp trên (màn Sổ NAT → Gỡ, có ghi lý do) rồi chạy lại migration.', clash_report;
  END IF;
END $$;

ALTER TABLE nat_rule DROP CONSTRAINT nat_rule_no_overlap;

ALTER TABLE nat_rule ADD CONSTRAINT nat_rule_no_overlap
  EXCLUDE USING gist (
    device_id WITH =,
    (CASE protocol
       WHEN 'tcp' THEN int4range(1, 1, '[]')
       WHEN 'udp' THEN int4range(2, 2, '[]')
       ELSE int4range(1, 2, '[]')
     END) WITH &&,
    int4range(external_from, external_to, '[]') WITH &&
  ) WHERE (voided_at IS NULL);
