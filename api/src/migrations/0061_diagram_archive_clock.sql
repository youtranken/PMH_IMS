-- Mốc lưu trữ / bia mộ của `diagram` do DB đóng dấu, không do ứng dụng tự khai — chủ: diagrams
-- (AD-3, AD-18, Q-23 "Xóa vĩnh viễn").
--
-- Chế độ `erase` của `diagram_delete_versions` (0058) chỉ xoá khi `archived_at < deleted_at`, tức
-- bản vẽ đã được lưu trữ ở một lượt TRƯỚC lượt xoá. Nhưng `ims_app` có UPDATE trên `diagram`: không
-- có trigger này thì nó tự ghi `archived_at` lùi về quá khứ cùng lúc đặt bia mộ, rồi xoá sạch
-- lịch sử đã phát hành của một bản vẽ đang dùng chỉ trong một bước.
--
-- Luật đóng dấu:
-- - `archived_at` từ NULL sang có giá trị = `now()` (giờ bắt đầu transaction); đã có giá trị thì
--   giữ nguyên giá trị cũ, ứng dụng không ghi đè được (chỉ bỏ lưu trữ bằng NULL).
-- - `deleted_at` từ NULL sang có giá trị = `now()`.
-- - Bia mộ (`deleted_at` đã có) đóng băng hai mốc trên; bỏ `deleted_at` (làm sống lại) bị chặn.
-- - INSERT mang sẵn mốc thì mốc cũng là `now()`.
-- Hai mốc ghi trong CÙNG transaction thì bằng nhau, nên `archived_at < deleted_at` nghĩa thật là
-- "lưu trữ ở lượt trước". Lưu trữ rồi xoá ở hai lượt riêng vẫn là lối hợp lệ của Q-23; DB không
-- phân biệt được lối đó với một `ims_app` bị chiếm đi đúng hai lượt ấy.

CREATE FUNCTION diagram_archive_clock() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.archived_at IS NOT NULL THEN NEW.archived_at := now(); END IF;
    IF NEW.deleted_at IS NOT NULL THEN NEW.deleted_at := now(); END IF;
    RETURN NEW;
  END IF;

  IF OLD.deleted_at IS NOT NULL THEN
    IF NEW.deleted_at IS NULL OR NEW.archived_at IS NULL THEN
      RAISE EXCEPTION 'Bản vẽ % là bia mộ — không làm sống lại được', OLD.id;
    END IF;
    NEW.deleted_at := OLD.deleted_at;
    NEW.archived_at := OLD.archived_at;
    RETURN NEW;
  END IF;

  IF NEW.archived_at IS NOT NULL THEN
    NEW.archived_at := coalesce(OLD.archived_at, now());
  END IF;
  IF NEW.deleted_at IS NOT NULL THEN
    NEW.deleted_at := now();
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER diagram_archive_clock BEFORE INSERT OR UPDATE OF archived_at, deleted_at ON diagram
    FOR EACH ROW EXECUTE FUNCTION diagram_archive_clock();
