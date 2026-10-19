-- SHA-256 nội dung file, ghi lúc tải lên (Q-29): đối chiếu được bản ký phiếu ISO, biên bản… chưa
-- bị thay trên đĩa. File tải lên trước cột này để NULL: không có bản gốc để băm lại cho chắc.
ALTER TABLE file ADD COLUMN sha256 text
    CONSTRAINT file_sha256_check CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$');
