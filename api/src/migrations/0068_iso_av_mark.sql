-- Dấu bấm tay của một dòng máy 0208 ở một ngày (Q-28, bấm từng dòng). Ô không có hàng ở đây thì
-- hiện theo Other Division của ngày đó; ô đúng ngày phát hiện luôn ✗ nên không lưu.
CREATE TABLE iso_av_mark (
    issue_id uuid NOT NULL,
    day date NOT NULL,
    result text NOT NULL,
    updated_by text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT iso_av_mark_pkey PRIMARY KEY (issue_id, day),
    CONSTRAINT iso_av_mark_result_check CHECK ((result = ANY (ARRAY['ok'::text, 'fail'::text]))),
    -- CASCADE: dấu chỉ có nghĩa cùng dòng issue; xoá dòng (chưa gắn 0206) thì dấu đi theo.
    CONSTRAINT iso_av_mark_issue_id_fkey FOREIGN KEY (issue_id) REFERENCES iso_av_issue(id) ON DELETE CASCADE
);
