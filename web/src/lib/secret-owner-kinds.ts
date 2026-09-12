/**
 * BỐN loại chủ thể cất được secret + nhãn i18n của chúng — MỘT nơi khai ở tầng web (AD-15).
 *
 * Soi gương `SECRET_OWNER_TYPES` bên API (`api/src/modules/vault/vault.service.ts`), vốn đã
 * có bản sao thứ ba ở tầng DB (`secret_owner_type_check`). Thêm loại thứ năm phải sờ đủ ba
 * chỗ — `web/src/lib/secret-owner-rollcall.test.ts` canh hai chỗ đầu.
 *
 * ===== VÌ SAO PHẢI GOM LẠI =====
 *
 * Trước 12/09 web có BỐN bản chép tay của cùng danh sách này, và ba bản sai:
 *
 *   · `ui/vault-panel.tsx`        — đủ bốn loại (đúng)
 *   · `lib/routes.ts` OWNER_PATH  — đủ bốn loại, nhưng gõ union thứ hai bằng tay
 *   · `features/vault/vault-home-screen.tsx` — CHỈ BA, thiếu `isp`
 *   · `locales/vi.ts approvals.subject_*`    — CHỈ HAI, thiếu cả `service_account` lẫn `isp`
 *
 * Không chỗ nào trong ba chỗ sai đó ĐỎ, vì cả ba đều kết bằng một nhánh vét: `Record` gõ
 * tay thì loại lạ ra `undefined`, `t()` thì rơi về chính cái khóa. Hậu quả thật, đo bằng
 * tay 12/09 khi cất mật khẩu PPPoE vào một đường truyền:
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
