-- isp_line_wan_ip — chủ: software, cùng chủ với isp_line (AD-3). Một đường truyền có nhiều IP WAN
-- (Q-20, sửa Q-04): nhà mạng cấp 2–3 IP tĩnh, mỗi IP một hàng.
--
-- Chỉ IPv4 ĐƠN (masklen 32): nhà mạng cấp từng IP, không cấp dải. Một dải gõ vào trông hợp lệ
-- nhưng làm người đọc đếm sai số IP thật đang dùng. Trùng giữa hai đường thì được (Q-20), trong
-- cùng một đường thì không.
--
-- ON DELETE CASCADE: IP là một phần của hồ sơ đường truyền, không sống riêng. Ứng dụng không xoá
-- đường truyền (lịch sử giữ khoá RESTRICT); chỉ lượt dọn dữ liệu E2E xoá, và nó không phải biết
-- bảng này tồn tại.
CREATE TABLE isp_line_wan_ip (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    isp_line_id uuid NOT NULL,
    address inet NOT NULL,
    sort_order integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT isp_line_wan_ip_pkey PRIMARY KEY (id),
    CONSTRAINT isp_line_wan_ip_line_fkey FOREIGN KEY (isp_line_id) REFERENCES isp_line(id) ON DELETE CASCADE,
    CONSTRAINT isp_line_wan_ip_line_address_key UNIQUE (isp_line_id, address),
    CONSTRAINT isp_line_wan_ip_single_v4_check CHECK (family(address) = 4 AND masklen(address) = 32)
);

-- Dữ liệu cũ: một IP mỗi đường. Dải cũ (vd 113.161.20.17/29) giữ lại phần địa chỉ đã gõ — đó là
-- IP người nhập nhìn thấy; phần còn lại của dải không phải IP nào được ghi nhận riêng.
INSERT INTO isp_line_wan_ip (isp_line_id, address, sort_order)
SELECT id, host(wan_ip)::inet, 0 FROM isp_line WHERE wan_ip IS NOT NULL;

-- `search_norm` sinh từ `wan_ip` nên phải bỏ trước cột đó; dựng lại trên các trường còn lại. IP
-- WAN được tìm qua bảng con (`buildWhere` trong isp-line.service.ts): một cột sinh không đọc được
-- bảng khác. Bảng con cỡ vài trăm hàng, không cần chỉ mục trigram riêng.
--
-- Không CONCURRENTLY: isp_line cỡ vài chục tới vài trăm hàng, và ADD COLUMN … STORED viết lại cả
-- bảng dưới khoá độc quyền dù thế nào.
ALTER TABLE isp_line DROP COLUMN search_norm;
ALTER TABLE isp_line DROP COLUMN wan_ip;
ALTER TABLE isp_line ADD COLUMN search_norm text GENERATED ALWAYS AS (ims_norm((((((code)::text || ' '::text) || (provider)::text) || ' '::text) || COALESCE(contract_no, ''::text)))) STORED;
CREATE INDEX isp_line_search_norm_trgm ON isp_line USING gin (search_norm gin_trgm_ops);
