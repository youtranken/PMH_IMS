/**
 * Khoá chuẩn hoá của model thiết bị (Q-26): viết HOA, bỏ khoảng trắng, gạch ngang, gạch dưới, chấm —
 * "C9300-48P" và "c9300 48p" là một model. PHẢI cùng phép với cột sinh `device_model.model_key`
 * (migration 0062); `api/test/device-models.spec.ts` so hai bên trên Postgres thật.
 */
export function modelKey(model: string): string {
  return model.replace(/[\s_.-]/g, '').toUpperCase();
}
