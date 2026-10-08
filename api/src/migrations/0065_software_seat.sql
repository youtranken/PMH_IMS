-- Ghế riêng của hồ sơ license (Q-27) — chủ: software (AD-3).
--
-- Bật `per_seat` thì hồ sơ có đúng `seat_total` hàng `software_seat`, mỗi ghế có số hợp đồng, ghi
-- chú và giấy tờ riêng (file `owner_type = 'software_seat'`) — ví dụ OEM mỗi máy một key, một
-- phiếu. Không bật: mọi ghế dùng chung `software.contract`, ghi chú và giấy tờ của hồ sơ.
-- Gán máy là đưa máy vào một ghế (`license_assignment.seat_id`); máy gán vượt số ghế thì không
-- vào ghế nào (seat_id NULL, có `over_seat_reason` như cũ).
ALTER TABLE software
    ADD COLUMN contract text,
    ADD COLUMN per_seat boolean DEFAULT false NOT NULL,
    ADD CONSTRAINT software_per_seat_license_check CHECK (((NOT per_seat) OR (kind = 'license'::text))),
    ADD CONSTRAINT software_contract_check CHECK (((contract IS NULL) OR (char_length(contract) <= 200)));

CREATE TABLE software_seat (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    software_id uuid NOT NULL,
    seat_no integer NOT NULL,
    contract text,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT software_seat_pkey PRIMARY KEY (id),
    CONSTRAINT software_seat_no_check CHECK ((seat_no >= 1)),
    CONSTRAINT software_seat_contract_check CHECK (((contract IS NULL) OR (char_length(contract) <= 200))),
    CONSTRAINT software_seat_note_check CHECK (((note IS NULL) OR (char_length(note) <= 500))),
    CONSTRAINT software_seat_software_id_fkey FOREIGN KEY (software_id) REFERENCES software(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX software_seat_no_key ON software_seat USING btree (software_id, seat_no);

ALTER TABLE license_assignment
    ADD COLUMN seat_id uuid,
    ADD CONSTRAINT license_assignment_seat_id_fkey FOREIGN KEY (seat_id) REFERENCES software_seat(id) ON DELETE SET NULL;
-- Một ghế chỉ một máy ĐANG giữ; lần gán đã gỡ là dấu vết lịch sử, không chiếm ghế.
CREATE UNIQUE INDEX license_assignment_seat_live_key ON license_assignment USING btree (seat_id)
    WHERE ((seat_id IS NOT NULL) AND (released_at IS NULL));

ALTER TABLE file DROP CONSTRAINT file_owner_type_check;
ALTER TABLE file ADD CONSTRAINT file_owner_type_check CHECK ((owner_type = ANY (ARRAY['device'::text, 'isp'::text, 'software'::text, 'service_account'::text, 'subnet'::text, 'nat_rule'::text, 'device_model'::text, 'software_seat'::text])));
