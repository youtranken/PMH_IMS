-- DB-02 (QUYET-DINH Q-01): toàn công ty là một mạng, mỗi IP là duy nhất, nên hai dải ĐANG DÙNG
-- không được chồng lên nhau. UNIQUE (cidr) cũ chỉ bắt hai dải y hệt; 10.0.0.0/24 và 10.0.0.0/25
-- vẫn cùng tồn tại được, cho ra một IP hai hồ sơ.

-- Dừng trước với câu lỗi nói rõ cặp nào đụng cặp nào, thay vì để ADD CONSTRAINT ném 23P01 trần.
DO $$
DECLARE
  clash_report text;
BEGIN
  SELECT string_agg(format('%s (%s, id %s) chồng %s (%s, id %s)',
                           a.cidr, a.name, a.id, b.cidr, b.name, b.id), E'\n')
    INTO clash_report
    FROM subnet a
    JOIN subnet b ON b.id > a.id AND b.voided_at IS NULL AND a.cidr && b.cidr
   WHERE a.voided_at IS NULL;

  IF clash_report IS NOT NULL THEN
    RAISE EXCEPTION E'Có dải IP đang dùng chồng lên nhau:\n%\n\nVô hiệu hoá một dải trong mỗi cặp (màn Dải mạng) rồi chạy lại migration.', clash_report;
  END IF;
END $$;

ALTER TABLE subnet
  ADD CONSTRAINT subnet_no_overlap
  EXCLUDE USING gist (cidr inet_ops WITH &&) WHERE (voided_at IS NULL);
