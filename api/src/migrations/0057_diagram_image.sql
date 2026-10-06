-- Ảnh nhúng của bản vẽ lưu MỘT lần (Q-23) — chủ: diagrams (AD-3, AD-18).
--
-- Mỗi lần lưu chép lại cả XML lẫn ảnh xem SVG, nên một ảnh thật 200 KB trên bản vẽ thành 200 KB
-- mỗi lần bấm Lưu. Ảnh tách ra đây, khoá bằng SHA-256 của chính nó (`diagram-images.ts`); phiên
-- bản giữ tham chiếu `ims-img:<dạng>:<sha>` và module ghép lại thành `data:` URI mỗi lần đọc.
-- Không chỉ-thêm: ảnh không còn phiên bản nào dùng bị xoá trong transaction Bỏ bản nháp / Xoá hẳn.
-- Nội dung theo khoá băm nên không bao giờ sửa: thu UPDATE của ims_app.
CREATE TABLE diagram_image (
    sha text NOT NULL,
    mime text NOT NULL,
    data bytea NOT NULL,
    byte_size integer NOT NULL,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT diagram_image_pkey PRIMARY KEY (sha),
    CONSTRAINT diagram_image_sha_check CHECK ((sha ~ '^[0-9a-f]{64}$')),
    CONSTRAINT diagram_image_mime_check CHECK ((mime ~ '^image/[A-Za-z0-9.+-]{1,60}$')),
    CONSTRAINT diagram_image_size_check CHECK ((byte_size = octet_length(data) AND byte_size <= 4194304))
);
REVOKE UPDATE, TRUNCATE ON diagram_image FROM ims_app;

-- Phiên bản nào dùng ảnh nào: trả lời "ảnh này còn ai dùng" bằng khoá ngoại thay vì quét XML.
-- Xoá phiên bản (chỉ qua `diagram_delete_versions`) kéo hàng nối theo; ảnh còn hàng nối thì
-- RESTRICT chặn xoá ảnh — lưới cuối nếu lượt dọn ảnh tính sai. Hàng nối chỉ sinh cùng phiên bản
-- và mất cùng phiên bản: ims_app chỉ SELECT + INSERT.
CREATE TABLE diagram_version_image (
    version_id uuid NOT NULL,
    sha text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT diagram_version_image_pkey PRIMARY KEY (version_id, sha),
    CONSTRAINT diagram_version_image_version_id_fkey FOREIGN KEY (version_id) REFERENCES diagram_version(id) ON DELETE CASCADE,
    CONSTRAINT diagram_version_image_sha_fkey FOREIGN KEY (sha) REFERENCES diagram_image(sha) ON DELETE RESTRICT
);
CREATE INDEX diagram_version_image_sha_idx ON diagram_version_image USING btree (sha);
REVOKE UPDATE, DELETE, TRUNCATE ON diagram_version_image FROM ims_app;
