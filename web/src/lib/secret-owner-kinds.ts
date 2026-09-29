/**
 * BỐN loại chủ thể cất được secret + nhãn i18n của chúng — MỘT nơi khai ở tầng web (AD-15).
 *
 * Soi gương `SECRET_OWNER_TYPES` bên API (`api/src/modules/vault/vault.service.ts`), vốn đã
 * có bản sao thứ ba ở tầng DB (`secret_owner_type_check`). Thêm loại thứ năm phải sờ đủ ba
 * chỗ — `web/src/lib/secret-owner-rollcall.test.ts` canh hai chỗ đầu.
 *
 * ===== VÌ SAO PHẢI GOM LẠI =====
 *
 * Danh sách này được dùng ở `ui/vault-panel.tsx`, `lib/routes.ts` (OWNER_PATH), trang tổng két
 * (`features/vault/vault-home-screen.tsx`) và nhãn màn Duyệt yêu cầu. Chép tay ở từng nơi thì
 * bản thiếu một loại KHÔNG ĐỎ, vì đều kết bằng một nhánh vét: `Record` gõ tay thì loại lạ ra
 * `undefined`, `t()` thì rơi về chính cái khóa. Hậu quả đo được khi các bản thiếu `isp` và
 * người dùng cất mật khẩu PPPoE vào một đường truyền:
 *
 *   (a) cột "Loại" ở trang tổng két TRỐNG;
 *   (b) bật bất kỳ nút lọc loại nào → dòng đường truyền biến mất, không một lời;
 *   (c) "Mở hồ sơ đầy đủ" dẫn sang trang PHẦN MỀM với id của đường truyền (nhánh vét);
 *   (d) màn Duyệt yêu cầu in ra chữ `approvals.subject_isp`.
 *
 * Nên `Record<SecretOwnerType, …>` ở đây không phải để gọn: nó biến "quên một loại" từ một
 * ô trống trên màn hình thành một lỗi BIÊN DỊCH. Cùng lối với `lib/disposal-kinds.ts`.
 */
export const SECRET_OWNER_TYPES = ['device', 'software', 'service_account', 'isp'] as const;

export type SecretOwnerType = (typeof SECRET_OWNER_TYPES)[number];

/**
 * Nhãn tiếng Việt của loại chủ thể — dùng ở trang tổng két lẫn màn Duyệt yêu cầu.
 *
 * Namespace trung tính `ownerKind.*` chứ không mượn `vaultHome.kind*`: hai màn thuộc hai
 * feature khác nhau, mà khóa nằm trong namespace của một bên thì bên kia đọc ra như đi mượn
 * đồ, và người dịch sau sẽ sửa một chỗ tưởng chỉ ảnh hưởng một màn.
 */
export const SECRET_OWNER_KIND_KEY: Record<SecretOwnerType, string> = {
  device: 'ownerKind.device',
  software: 'ownerKind.software',
  service_account: 'ownerKind.serviceAccount',
  isp: 'ownerKind.isp',
};
