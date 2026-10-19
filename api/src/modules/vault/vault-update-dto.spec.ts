import { dtoErrorBody } from '../../test/dto-pipe';
import { UpdateSecretDto } from './vault.controller';

/**
 * Sửa ngăn két: `label` là tuỳ chọn (không gửi = giữ nguyên) nhưng không được là `null`. `@IsOptional`
 * cho `null` lọt qua, rồi service gọi `null.trim()` → 500. Gửi `null` phải nhận 400 như mọi ô sai.
 */
describe('UpdateSecretDto · nhãn ngăn két', () => {
  it('label: null → 400, không lọt xuống service', async () => {
    expect(await dtoErrorBody(UpdateSecretDto, { label: null })).not.toBeNull();
  });

  it('không gửi label → hợp lệ (giữ nguyên nhãn)', async () => {
    expect(await dtoErrorBody(UpdateSecretDto, { note: 'ghi chú' })).toBeNull();
  });

  it('label hợp lệ → qua', async () => {
    expect(await dtoErrorBody(UpdateSecretDto, { label: 'Router chính' })).toBeNull();
  });
});
