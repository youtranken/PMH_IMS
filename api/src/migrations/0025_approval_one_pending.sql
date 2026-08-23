-- Code review Epic 6, finding 6: luật "một yêu cầu đang treo cho mỗi chủ thể" trước đây chỉ
-- có một câu `SELECT` chạy NGOÀI transaction canh giữ.
--
-- Hai cú bấm "Gửi yêu cầu" cùng lúc (hoặc một lần thử lại của trình duyệt) đều thấy "chưa có"
-- và cùng ghi. Người duyệt phải quyết hai lần cho một việc, và cái thứ hai nằm treo mãi sau
-- khi cái thứ nhất đã được duyệt — không ai đóng, vì trên màn hình nó trông y như một yêu cầu
-- thật đang chờ.
--
-- Chỉ áp cho `pending`: một người XIN LẠI cùng chủ thể sau khi grant cũ hết hạn là việc bình
-- thường và phải cho phép.
CREATE UNIQUE INDEX approval_one_pending_key
  ON approval (kind, requester, subject_type, subject_id)
  WHERE state = 'pending';
