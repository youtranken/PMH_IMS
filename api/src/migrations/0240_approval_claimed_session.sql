-- Q-15: quyền mở két gắn với phiên đã NHẬN nó, không phải phiên đã xin.
--
-- Yêu cầu đang chờ không gắn phiên (người duyệt có thể quyết sau nhiều giờ, lâu hơn phiên idle).
-- Được duyệt thì người xin bấm "Nhận quyền" trong một phiên đang sống; từ đó grant chỉ dùng được
-- từ đúng phiên này. `requester_session_id` (0170) vẫn giữ phiên đã GỬI, chỉ để tra vết.
--
-- `claimed_session_id` giữ `sessions.id`, không bao giờ giữ token hay bản băm token. Không khóa
-- ngoại sang `sessions`: lượt dọn phiên cũ xóa hàng phiên, còn phiếu là nhật ký FR-025.
--
-- Để trống được, không mặc định: chỉ đổi catalog, không viết lại bảng đang có dữ liệu. NULL =
-- chưa nhận, nên grant còn giờ cấp trước luật này vẫn nhận được một lần.
ALTER TABLE approval ADD COLUMN claimed_session_id uuid;
ALTER TABLE approval ADD COLUMN claimed_at timestamptz;
