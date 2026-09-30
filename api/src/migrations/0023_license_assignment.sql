-- license_assignment — chủ: software. License nào đang nằm ở máy nào, theo seat (FR-011).
CREATE TABLE license_assignment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    software_id uuid NOT NULL,
    device_id uuid NOT NULL,
    assigned_by text NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    released_by text,
    released_at timestamp with time zone,
    over_seat_reason text,
    note text,
    cost bigint,
    contract text,
    start_date date,
    end_date date,
    CONSTRAINT license_assignment_cost_check CHECK (((cost IS NULL) OR (cost >= 0))),
    CONSTRAINT license_assignment_period_check CHECK (((start_date IS NULL) OR (end_date IS NULL) OR (end_date >= start_date))),
    CONSTRAINT license_assignment_release_check CHECK (((released_at IS NULL) = (released_by IS NULL))),
    CONSTRAINT license_assignment_pkey PRIMARY KEY (id),
    CONSTRAINT license_assignment_device_id_fkey FOREIGN KEY (device_id) REFERENCES device(id) ON DELETE RESTRICT,
    CONSTRAINT license_assignment_software_id_fkey FOREIGN KEY (software_id) REFERENCES software(id) ON DELETE RESTRICT
);
CREATE INDEX license_assignment_device_idx ON license_assignment USING btree (device_id) WHERE (released_at IS NULL);
CREATE INDEX license_assignment_software_idx ON license_assignment USING btree (software_id) WHERE (released_at IS NULL);
CREATE UNIQUE INDEX license_assignment_active_key ON license_assignment USING btree (software_id, device_id) WHERE (released_at IS NULL);
