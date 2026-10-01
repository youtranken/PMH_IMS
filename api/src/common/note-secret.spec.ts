import { noteContainsSecret, noteLooksLikeSecret, textLooksLikeSecret } from './note-secret';

/**
 * Ghi chú của ngăn két là cột KHÔNG mã hoá, ai xem được danh sách là đọc được nó. Nên ghi chú
 * chứa chính giá trị vừa cất là một bản sao dạng rõ của bí mật (Q-18, FR-035).
 */
describe('noteContainsSecret', () => {
  const cases: [string, string | null, string, boolean][] = [
    // [mô tả, ghi chú, giá trị, bị chặn]
    ['ghi chú y hệt giá trị', 'Cisco#Core2026!', 'Cisco#Core2026!', true],
    ['khác hoa-thường vẫn là một', 'cisco#core2026!', 'Cisco#Core2026!', true],
    ['chèn dấu cách vẫn là một', 'Cisco # Core 2026 !', 'Cisco#Core2026!', true],
    ['giá trị nằm giữa câu', 'mk tạm là Cisco#Core2026! nhớ đổi', 'Cisco#Core2026!', true],
    ['giá trị ngắn trùng khớp nguyên ghi chú', 'abc', 'ABC', true],
    ['giá trị 6 ký tự nằm trong câu', 'mật khẩu 123456 nhé', '123456', true],
    ['giá trị 5 ký tự nằm trong câu: không chặn (quá dễ trùng chữ thường)', 'admin web cổng', 'admin', false],
    ['ghi chú bình thường', 'Đổi theo chu kỳ 90 ngày', 'Cisco#Core2026!', false],
    ['ghi chú trống', '', 'Cisco#Core2026!', false],
    ['không có ghi chú', null, 'Cisco#Core2026!', false],
    ['giá trị chỉ có khoảng trắng', 'ghi chú', '   ', false],
  ];

  it.each(cases)('%s', (_label, note, value, blocked) => {
    expect(noteContainsSecret(note, value)).toBe(blocked);
  });
});

/**
 * Ghi chú có một "từ" trông như mật khẩu: dài >= 10, >= 3 nhóm ký tự, không lặp lại vô nghĩa.
 * Nửa dưới của bảng quan trọng ngang nửa trên: chặn nhầm ghi chú bình thường thì người dùng
 * học cách viết lách luật, và mật khẩu thật lọt qua bằng đúng cách viết ấy.
 */
describe('noteLooksLikeSecret', () => {
  const cases: [string, string | null, boolean][] = [
    // [ghi chú, bị chặn]
    ['Admin@123456', true],
    ['mật khẩu tạm P@ssw0rd!2026 đổi sau', true],
    ['Cisco#Core2026!', true],
    ['Matkhau2026', true],
    ['matkhau-2026!', true],
    ['Xk9#mP2vLq', true],
    ['https://admin:S3cret#Pass@10.0.0.1/login', true],
    ['Admin@1212', true],
    ['mk: Admin@123456.', true],
    ['API https://portal.example.vn/api?user=it&key=Ab12Cd34Ef56Gh', true],
    ['Ghi đè: SW-Core01.PMH.local mật khẩu Cisco#Core2026!', true],
    ['S3cr3t!Pass@10.0.0.1', true],
    ['Pmh#2026Secret', true],
    ['mk:Admin@123456', true],
    ['Pass:Word2026x', true],
    // Không được chặn.
    ['Mật khẩu đổi theo chu kỳ 90 ngày', false],
    ['IP quản trị 10.0.0.1', false],
    ['Model FortiGate 60F', false],
    ['Model WS-C2960X-48TS-L, serial FOC1234X0AB', false],
    ['Trang quản trị https://10.0.0.1:8443/Admin/Login?id=5', false],
    ['Hỗ trợ: Support.IT2026@pmh.com.vn', false],
    ['Hết hạn 30/09/2026, gia hạn trước 2026-10-15T08:00', false],
    ['Máy chủ SW-Core01.PMH.local cổng Gi1/0/24', false],
    ['MAC AA:BB:CC:11:22:33, VLAN 10/20/30', false],
    ['Ghi chú: gọi anh Nam 0903 123 456 khi cần reset', false],
    ['Aaaaaaaaa1!', false],
    ['Serial FGT60FTK2109ABCD', false],
    ['Đổi-mật-khẩu-sau', false],
    // Địa chỉ đăng nhập, số thứ tự, số điện thoại, IPv6 có zone — không phải mật khẩu.
    ['SSH admin@10.0.0.1 port 22', false],
    ['admin@SW-CORE01', false],
    ['VLAN#10_Mgmt', false],
    ['Hotline:+842838221234', false],
    ['fe80::1%eth0', false],
    ['', false],
    [null, false],
  ];

  it.each(cases)('%s', (note, blocked) => {
    expect(noteLooksLikeSecret(note)).toBe(blocked);
  });
});

/**
 * Ô chữ tự do NGOÀI két (Q-19): ghi chú thiết bị, đường truyền, NAT, IP, dải, tài khoản dịch
 * vụ, ghế license, mô tả danh mục, lý do… Các ô này chở mã model, serial, đường dẫn, số hợp đồng
 * nhiều hơn hẳn ghi chú két, nên luật hẹp hơn: một từ chỉ bị coi là mật khẩu khi có chữ thường
 * VÀ ký tự đặc biệt, cộng thêm chữ hoa hoặc số. "Microsoft365_E3", "Fiber200Mbps-PMH" là tên
 * gói chứ không phải mật khẩu; chặn chúng thì người dùng học cách lách luật.
 *
 * Product key (5 nhóm × 5 ký tự) luôn bị chặn: đó là bí mật có giá, chỗ của nó là két của hồ sơ.
 */
describe('textLooksLikeSecret', () => {
  const blocked: string[] = [
    'mk wifi: Pmh@Guest2026',
    'admin / Admin@123456',
    'mật khẩu tạm P@ssw0rd!2026 đổi sau',
    'Cisco#Core2026!',
    'matkhau-2026!',
    'Xk9#mP2vLq',
    'https://admin:S3cret#Pass@10.0.0.1/login',
    // Giá trị tham số URL là chỗ cất khoá thật: giữ luật của két, không cần ký tự đặc biệt.
    'API https://portal.example.vn/api?user=it&key=Ab12Cd34Ef56Gh',
    'Key Office: VK7JG-NPHTM-C97JM-9MPGT-3V66T',
    'product key NPPR9-FWDCX-D2C8J-H872K-2YT43.',
    'vk7jg-nphtm-c97jm-9mpgt-3v66t',
    // Product key dính dấu câu hai đầu vẫn là product key.
    'Key:BCDFG-HJKMN-PQRTV-WXY23-46789',
    '(BCDFG-HJKMN-PQRTV-WXY23-46789)',
    'key "BCDFG-HJKMN-PQRTV-WXY23-46789"',
    "key 'BCDFG-HJKMN-PQRTV-WXY23-46789';",
    // Trước @ là mật khẩu chứ không phải tên đăng nhập.
    'S3cr3t!Pass@10.0.0.1',
    'kết nối Matkhau2026@10.0.0.1:22',
    'Pa$$w0rd!@10.0.0.1',
    // Khoá thật trong URL không có scheme vẫn là khoá.
    'portal.pmh.vn/api?token=Ab12Cd34Ef56Gh',
  ];

  const allowed: (string | null)[] = [
    // Mã model, part number, serial.
    'Switch Cisco WS-C2960X-48FPD-L, serial FOC2010X1AB',
    'Part WS-C2960X-48FPD-L thay thế cho C9200L-48P-4G-E',
    'Model Dell PowerEdge R740xd, service tag 7XKQ2M3',
    'HP ProLiant DL380 Gen10 P20174-B21',
    'Thay pin UPS APC SMT1500RMI2U',
    'Port 8080->80 cho Camera_Hikvision_DS-2CD2143G2-I',
    'Seri UPS AS1234567890, IMEI 356938035643809',
    'FortiGate FG-100F firmware v7.2.8 build1639',
    'Windows 11 Pro 23H2 build 22631.4317',
    'Office LTSC Professional Plus 2021',
    'Gói Microsoft365_E3 cho 25 người',
    'Rack 42U, PDU APC AP7921B x2',
    // Mạng: MAC, IP, CIDR, VLAN, cổng.
    'MAC 00:1A:2B:3C:4D:5E',
    'MAC 001A.2B3C.4D5E trên cổng Gi1/0/48',
    'Dải 192.168.10.0/24 gateway 192.168.10.1',
    'NAT 203.162.4.190:8443 -> 10.10.20.5:443',
    'IPv6 2001:db8:85a3::8a2e:370:7334/64',
    'VLAN 10,20,30-40 trunk',
    'Kết nối uplink Te1/1/1 tới CORE-SW01',
    'Rule: allow TCP/UDP 3389 từ 10.0.0.0/8',
    'SSID PMH-Guest, kênh 36/40/44',
    'ssh admin@10.10.20.5 rồi chạy lệnh show run',
    'ssh root@srv-db01',
    'ssh svc_backup@SRV-DB01:2222 rồi chạy backup',
    'Đăng nhập Administrator@10.0.0.5 bằng RDP',
    'Line FTTH Fiber200Mbps-PMH, mã KH: HCM-FTTH-0012345',
    'Mạch kênh riêng MPLS_HCM_PMH_01',
    // Hợp đồng, phiếu, đơn hàng.
    'Hợp đồng HD-2026/PMH-01 ký ngày 15/01/2026',
    'Số HĐ: 123/2026/HĐDV-VNPT-PMH',
    'Mã đơn hàng PO#2026-0915',
    'Ticket #INC-2026-00123 đã đóng',
    'Bảo hành 3 năm, NBD on-site; case SR#4-2026-778899',
    'License Adobe CC, Seat#12 (Nguyễn Văn A)',
    // Đường dẫn, URL, tài khoản miền.
    'Tài liệu \\\\fileserver\\IT\\HopDong\\2026\\VNPT.pdf',
    'Đường dẫn C:\\Program Files\\Microsoft Office\\root',
    'Share quản trị \\\\PMH-FS01\\data$',
    'Ổ \\\\SRV-AD01\\C$\\Logs2026\\Backup_Q3',
    'Share ẩn \\\\SRV-AD01\\Backup2026$\\Q3',
    'portal.pmh.vn/login?next=Home2026',
    'https://x.vn/r?id=Q3Report2026',
    '10.0.0.1:8443/Admin?tab=Users2026',
    'Xem https://portal.vnpt.vn/hop-dong?ma=HD2026PMH01',
    'Server: SRV-AD01.pmh.local, Domain\\Administrators',
    'Tài khoản PMH\\svc_backup chạy Veeam',
    'Speed=1000Mbps, Duplex=Full',
    'SSH admin@10.0.0.1 port 22',
    'admin@SW-CORE01',
    'VLAN#10_Mgmt',
    'Hotline:+842838221234',
    'fe80::1%eth0',
    // Câu tiếng Việt thường.
    'Tủ đặt tại Tầng 3, phòng máy chủ, toà nhà Sky Garden (R4-3)',
    'Đã bàn giao cho chị Lan phòng Kế toán ngày 01/10/2026.',
    'Đầu mối anh Tuấn (0909 123 456), email tuan.nguyen@vnpt.vn',
    'Cấp lại do máy cũ hỏng main (sự cố #45).',
    'Chạy job lúc 02:00, giữ 14 bản; 50% băng thông dành cho VoIP',
    'Đổi tên từ PC-KT-01 thành PC-KT-01A ngày 2026-09-30',
    'Mật khẩu đổi theo chu kỳ 90 ngày, xem két của thiết bị',
    '',
    null,
  ];

  it.each(blocked)('chặn: %s', (text) => {
    expect(textLooksLikeSecret(text)).toBe(true);
  });

  it.each(allowed)('không chặn: %s', (text) => {
    expect(textLooksLikeSecret(text)).toBe(false);
  });
});
