import type { ValidationError } from '@nestjs/common';

/**
 * DỊCH CÂU LỖI NHẬP LIỆU SANG TIẾNG VIỆT — MỘT CHỖ, CHO MỌI DTO.
 *
 * ===== LỖ =====
 *
 * Đo ngày 12/09: 434 validator trong `*.controller.ts`, chỉ 80 cái khai `message`. Tức ~354
 * validator CÂM, và câu lọt ra màn hình là câu mặc định của class-validator:
 *
 *     internalPort must not be greater than 65535
 *
 * Ô "Port trong" của form NAT không kiểm gì ở web, nên gõ `99999` là người dùng nhận đúng câu
 * đó. Ô "Port ngoài" NGAY CẠNH thì báo tiếng Việt, vì DTO của nó có khai `message`. Hai ô cạnh
 * nhau, hai ngôn ngữ — và cái quyết định là người viết DTO hôm ấy có nhớ gõ thêm một tham số
 * hay không.
 *
 * ===== VÌ SAO KHÔNG ĐI GÕ 354 CÂU `message` =====
 *
 * Vì đó là bản vá cho HÔM NAY, không phải cho validator thứ 435. Cửa vẫn mở mặc định: người
 * viết DTO tiếp theo quên `message` thì lại lọt một câu tiếng Anh, và không có gì đỏ.
 *
 * Ở đây thì mặc định ĐÓNG: `exceptionFactory` của `ValidationPipe` đi qua chỗ này, nên mọi
 * validator — kể cả cái viết năm sau — đều ra tiếng Việt mà không cần ai nhớ gì. Còn DTO nào
 * có câu riêng thì câu đó THẮNG: nó biết chuyện cụ thể ("Mã thiết bị không hợp lệ."), còn ở
 * đây ta chỉ biết tên trường và loại ràng buộc.
 *
 * ===== LÀM SAO PHÂN BIỆT "CÂU MẶC ĐỊNH" VỚI "CÂU NGƯỜI VIẾT" =====
 *
 * class-validator trả về câu ĐÃ DỰNG XONG, không nói nó là mặc định hay do DTO khai. Dấu hiệu
 * dùng ở đây: câu mặc định của thư viện TOÀN ASCII, còn câu tiếng Việt của repo luôn có dấu.
 * `validation-messages.spec.ts` canh đúng điều đó — nó đọc mọi `message:` trong controller và
 * đỏ nếu có câu nào không dấu, tức là quy ước này không im lặng mục ra được.
 */

/** Tên trường → cụm từ tiếng Việt mở đầu câu lỗi. Thiếu khóa là bài điểm danh đỏ. */
export const FIELD_LABEL: Record<string, string> = {
  action: 'Thao tác',
  actor: 'Người thực hiện',
  address: 'Địa chỉ IP',
  assignedAt: 'Ngày gán',
  assignmentId: 'Mã lượt gán',
  birthDate: 'Ngày sinh',
  cabinetId: 'Tủ mạng',
  changes: 'Danh sách thay đổi',
  cidr: 'Dải mạng (CIDR)',
  cleanup: 'Tùy chọn dọn kèm',
  code: 'Mã hồ sơ',
  columns: 'Danh sách cột',
  cost: 'Chi phí',
  csrfToken: 'Mã chống giả mạo (CSRF)',
  dateStyle: 'Kiểu hiển thị ngày',
  description: 'Mô tả',
  deviceId: 'Thiết bị',
  deviceTypeId: 'Loại thiết bị',
  dir: 'Chiều sắp xếp',
  email: 'Email',
  employeeCode: 'Mã nhân viên',
  enabled: 'Trạng thái bật/tắt',
  endDate: 'Ngày hết hạn',
  entity: 'Nhóm danh mục',
  externalFrom: 'Cổng ngoài (từ)',
  externalPorts: 'Danh sách cổng ngoài',
  externalTo: 'Cổng ngoài (đến)',
  format: 'Định dạng',
  frequency: 'Kỳ gửi',
  from: 'Từ',
  fullName: 'Họ tên',
  gateway: 'Gateway',
  group: 'Gộp sự kiện lặp',
  hour: 'Giờ gửi',
  id: 'Mã định danh',
  includeCurrent: 'Đóng cả phiên đang dùng',
  includeExpired: 'Tùy chọn kèm hồ sơ hết hạn',
  includeVoided: 'Tùy chọn kèm bản đã hủy',
  internalIp: 'IP trong',
  internalPort: 'Cổng trong',
  ip: 'Địa chỉ IP',
  key: 'Khóa tham số',
  kind: 'Loại',
  kinds: 'Danh sách loại',
  label: 'Tên gọi',
  licenseModel: 'Kiểu license',
  limit: 'Số dòng mỗi trang',
  message: 'Nội dung',
  mustChangePassword: 'Bắt buộc đổi mật khẩu',
  name: 'Tên',
  note: 'Ghi chú',
  objectId: 'Mã đối tượng',
  objectType: 'Loại đối tượng',
  originalName: 'Tên file gốc',
  ownerId: 'Mã chủ thể',
  ownerType: 'Loại chủ thể',
  page: 'Số trang',
  pageSize: 'Số dòng mỗi trang',
  password: 'Mật khẩu',
  phone: 'Số điện thoại',
  portId: 'Cổng mạng',
  protocol: 'Giao thức',
  provider: 'Nhà mạng',
  purchaseDate: 'Ngày mua',
  query: 'Từ khóa tìm',
  requester: 'Người xin',
  reason: 'Lý do',
  recipients: 'Người nhận',
  required: 'Bắt buộc hay không',
  role: 'Vai trò',
  rows: 'Danh sách dòng',
  scopeType: 'Loại nhóm đối tượng',
  search: 'Từ khóa tìm',
  security: 'Chỉ sự kiện an ninh',
  seatTotal: 'Tổng số ghế',
  sheetName: 'Tên sheet',
  siteId: 'Site',
  sort: 'Cột sắp xếp',
  startDate: 'Ngày bắt đầu',
  state: 'Trạng thái',
  status: 'Trạng thái',
  subnetId: 'Dải mạng',
  tier: 'Tầng quyền',
  timeStyle: 'Kiểu hiển thị giờ',
  to: 'Đến',
  totpLoginRequired: 'Bắt buộc 2 lớp mỗi lần đăng nhập',
  uploadedBy: 'Người tải lên',
  usable: 'Chỉ IP dùng được',
  usableOnly: 'Chỉ IP dùng được',
  usedBy: 'Người dùng',
  userAgent: 'Trình duyệt',
  value: 'Giá trị',
  vendorId: 'Nhà cung cấp',
  vlan: 'VLAN',
  warrantyEnd: 'Hết bảo hành',
  warrantyStart: 'Bắt đầu bảo hành',
  websites: 'Danh sách website',
  weekday: 'Thứ trong tuần',
  width: 'Độ rộng',
  withinDays: 'Trong vòng (ngày)',
};

export function fieldLabel(property: string): string {
  /*
   * Rơi về CHÍNH tên trường khi chưa có nhãn — chứ không về một chữ chung chung như "Trường
   * này". Tên thô đọc xấu, nhưng nó nói cho người dùng biết phải sửa Ở ĐÂU; "Trường này sai"
   * thì không. Và cái xấu ấy còn là thứ nhắc người viết thêm nhãn vào bảng trên.
   */
  return FIELD_LABEL[property] ?? property;
}

/**
 * Câu này có phải câu mặc định (chưa dịch) của class-validator không.
 *
 * Toàn ASCII = mặc định. Mọi câu do DTO khai trong repo đều có dấu tiếng Việt, và
 * `validation-messages.spec.ts` giữ cho điều đó đúng mãi.
 */
export function isDefaultMessage(message: string): boolean {
  // eslint-disable-next-line no-control-regex -- cố ý: đúng dải ASCII, không phải "ký tự chữ".
  return /^[\x00-\x7F]*$/.test(message);
}

/** Con số ràng buộc nằm trong câu mặc định (`must not be greater than 65535`). */
function firstNumberIn(message: string): string | null {
  return /(\d+)/.exec(message)?.[1] ?? null;
}

/**
 * Câu tiếng Việt cho một ràng buộc.
 *
 * Các mốc (độ dài, min/max) đọc NGƯỢC ra từ chính câu mặc định: `ValidationError` chỉ đưa câu
 * đã dựng, không đưa tham số của decorator. Đọc ngược thì phụ thuộc vào cách class-validator
 * viết câu — nên `validation-messages.spec.ts` chạy `ValidationPipe` THẬT trên DTO mẫu và so
 * câu đầu ra, thay vì tin vào một giả định về thư viện.
 */
export function vietnameseFor(
  property: string,
  constraintKey: string,
  englishDefault: string,
): string {
  const label = fieldLabel(property);
  const limit = firstNumberIn(englishDefault);

  switch (constraintKey) {
    case 'isString':
      return `${label} phải là chuỗi ký tự.`;
    case 'isInt':
      return `${label} phải là số nguyên.`;
    case 'isNumber':
      return `${label} phải là một con số.`;
    case 'isBoolean':
      return `${label} chỉ nhận đúng hoặc sai.`;
    case 'isArray':
      return `${label} phải là một danh sách.`;
    case 'isUuid':
      return `${label} không hợp lệ.`;
    case 'isEmail':
      // Trường tên "Email" mà ghép khuôn chung thì ra "Email không đúng định dạng email."
      return label === 'Email' ? 'Email không hợp lệ.' : `${label} phải là địa chỉ email hợp lệ.`;
    case 'isDateString':
      return `${label} phải là ngày hợp lệ.`;
    case 'isNotEmpty':
      return `${label} không được để trống.`;
    case 'min':
      return limit ? `${label} không được nhỏ hơn ${limit}.` : `${label} nhỏ hơn mức cho phép.`;
    case 'max':
      return limit ? `${label} không được lớn hơn ${limit}.` : `${label} vượt quá mức cho phép.`;
    case 'maxLength':
      return limit ? `${label} tối đa ${limit} ký tự.` : `${label} quá dài.`;
    case 'minLength':
      return limit ? `${label} tối thiểu ${limit} ký tự.` : `${label} quá ngắn.`;
    case 'isLength': {
      /*
       * `@Length(a, b)` sinh HAI câu khác nhau tùy vế nào hỏng — "longer than or equal to a"
       * hoặc "shorter than or equal to b". Bám vào chữ để biết đang hỏng vế nào; không có
       * chữ nào khớp thì nói chung chung còn hơn nói sai vế.
       */
      if (/longer than/.test(englishDefault) && limit) return `${label} tối thiểu ${limit} ký tự.`;
      if (/shorter than/.test(englishDefault) && limit) return `${label} tối đa ${limit} ký tự.`;
      return `${label} có độ dài không hợp lệ.`;
    }
    case 'isIn': {
      const allowed = /values:\s*(.+)$/.exec(englishDefault)?.[1];
      return allowed
        ? `${label} chỉ nhận một trong: ${allowed}.`
        : `${label} không nằm trong danh sách cho phép.`;
    }
    case 'matches':
      return `${label} sai định dạng.`;
    case 'whitelistValidation':
      /*
       * `forbidNonWhitelisted` — client gửi field lạ. Đây là lỗi LẬP TRÌNH phía web, không
       * phải lỗi người dùng nhập, nên câu nói thẳng ra như vậy: người vận hành đọc xong biết
       * là phải báo IT chứ không ngồi sửa ô nhập.
       */
      return `Yêu cầu chứa trường không hợp lệ: ${property}. Đây là lỗi của phần mềm, hãy báo IT.`;
    default:
      /*
       * Ràng buộc chưa có bản dịch. KHÔNG trả câu tiếng Anh ra ngoài: nói chung chung mà đúng
       * ngôn ngữ còn hơn nói chi tiết bằng thứ tiếng người dùng không đọc được. Bài điểm danh
       * làm đỏ khi có ràng buộc mới chưa khai, nên nhánh này gần như không bao giờ chạy thật.
       */
      return `${label} không hợp lệ.`;
  }
}

/** Rút mọi câu lỗi của một cây `ValidationError` ra thành danh sách câu tiếng Việt. */
export function messagesOf(errors: ValidationError[]): string[] {
  const out: string[] = [];
  const walk = (err: ValidationError, path: string) => {
    const fullPath = path ? `${path}.${err.property}` : err.property;
    for (const [key, message] of Object.entries(err.constraints ?? {})) {
      out.push(isDefaultMessage(message) ? vietnameseFor(err.property, key, message) : message);
    }
    for (const child of err.children ?? []) walk(child, fullPath);
  };
  for (const err of errors) walk(err, '');
  return out;
}
