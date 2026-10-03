-- Bản trình bày (Q-23, FR-045) — chủ: diagrams (AD-3, AD-18).
--
-- Bản trình bày là một hàng `diagram` riêng (`kind = 'presentation'`, cột có sẵn từ 0046) chép XML
-- của một phiên bản chính thức. Hai cột dưới ghi nó chép từ bản vẽ nào, phiên bản nào: màn xem
-- ghi "Dựa trên bản chính thức phiên bản N" và báo khi bản gốc đã có bản chính thức mới.
--
-- ON DELETE SET NULL: ứng dụng không xoá cứng bản vẽ (chỉ lưu trữ); chỉ lượt dọn dữ liệu kiểm thử
-- mới xoá hàng, và một bản trình bày còn lại khi bản gốc bị dọn chỉ mất dòng "dựa trên".
ALTER TABLE diagram
    ADD COLUMN source_diagram_id uuid,
    ADD COLUMN source_version_id uuid,
    ADD CONSTRAINT diagram_source_diagram_id_fkey FOREIGN KEY (source_diagram_id) REFERENCES diagram(id) ON DELETE SET NULL,
    ADD CONSTRAINT diagram_source_version_id_fkey FOREIGN KEY (source_version_id) REFERENCES diagram_version(id) ON DELETE SET NULL,
    -- Bản chính thức không có nguồn; bản trình bày đứng ngoài cây chính thức (không có cha), để
    -- lưu trữ một nhánh không vướng bản trình bày và cây không lẫn hai loại.
    ADD CONSTRAINT diagram_source_kind_check CHECK ((kind = 'presentation' OR (source_diagram_id IS NULL AND source_version_id IS NULL))),
    ADD CONSTRAINT diagram_presentation_root_check CHECK ((kind = 'official' OR parent_id IS NULL));

CREATE INDEX diagram_source_idx ON diagram USING btree (source_diagram_id) WHERE (source_diagram_id IS NOT NULL);
