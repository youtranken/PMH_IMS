-- Nền: hàm sinh UUID + so sánh chuỗi không phân biệt hoa thường (email đăng nhập).
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
