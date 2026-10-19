-- Ô của kỳ phiếu ISO đã sang Chờ duyệt / Đã chốt là bằng chứng (Q-28): DB từ chối ghi, không chỉ
-- service. `assertOpenWithin` vẫn là chỗ chặn chính và trả câu dễ hiểu; trigger này là hàng rào cho
-- đường ghi nào đó về sau quên gọi nó. Kiểm cả ngày cũ lẫn ngày mới để không dời được ô vào / ra
-- khỏi kỳ khoá. Phiếu 0206 có luật khoá riêng (In Progress vẫn sửa được) nên không gắn ở đây.
-- Tham số: TG_ARGV[0] = loại phiếu của kỳ, TG_ARGV[1] = tên cột ngày.
CREATE FUNCTION iso_period_cell_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    form text := TG_ARGV[0];
    col text := TG_ARGV[1];
    d date;
    st text;
BEGIN
    FOREACH d IN ARRAY ARRAY[
        CASE WHEN TG_OP <> 'INSERT' THEN (to_jsonb(OLD) ->> col)::date END,
        CASE WHEN TG_OP <> 'DELETE' THEN (to_jsonb(NEW) ->> col)::date END
    ] LOOP
        CONTINUE WHEN d IS NULL;
        SELECT p.state INTO st FROM iso_period p
         WHERE p.form_type = form
           AND p.year = extract(year FROM d)::int
           AND p.month = extract(month FROM d)::int;
        IF st IS NOT NULL AND st <> 'open' THEN
            RAISE EXCEPTION 'Kỳ % %/% đã khoá: không ghi được ô của kỳ này.',
                form, lpad(extract(month FROM d)::text, 2, '0'), extract(year FROM d)
                USING ERRCODE = 'check_violation';
        END IF;
    END LOOP;
    RETURN COALESCE(NEW, OLD);
END
$$;

CREATE TRIGGER iso_backup_tick_period_guard BEFORE INSERT OR UPDATE OR DELETE ON iso_backup_tick
    FOR EACH ROW EXECUTE FUNCTION iso_period_cell_guard('0203', 'day');
CREATE TRIGGER iso_av_clear_day_period_guard BEFORE INSERT OR UPDATE OR DELETE ON iso_av_clear_day
    FOR EACH ROW EXECUTE FUNCTION iso_period_cell_guard('0208', 'day');
CREATE TRIGGER iso_av_issue_period_guard BEFORE INSERT OR UPDATE OR DELETE ON iso_av_issue
    FOR EACH ROW EXECUTE FUNCTION iso_period_cell_guard('0208', 'reported_on');
CREATE TRIGGER iso_av_mark_period_guard BEFORE INSERT OR UPDATE OR DELETE ON iso_av_mark
    FOR EACH ROW EXECUTE FUNCTION iso_period_cell_guard('0208', 'day');
