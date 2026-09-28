-- Cổng "nhạy cảm" khi mở ra Internet (FTP, SSH, Telnet, SMB, SQL Server, MySQL, RDP, PostgreSQL,
-- VNC): sổ NAT gắn huy hiệu và cho lọc riêng những rule mở các cổng này. Danh sách là quyết định
-- của bộ phận IT, không phải hằng số trong code (AD-11) — sửa bằng một câu UPDATE.
INSERT INTO system_config (key, value, description) VALUES
  ('nat.sensitive_ports',
   '"21,22,23,445,1433,3306,3389,5432,5900"',
   'Cổng mở ra ngoài bị coi là nhạy cảm trên sổ NAT (danh sách số, ngăn bằng dấu phẩy)');
