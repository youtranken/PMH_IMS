import { ipDeviceEvent } from './ip-device-timeline';

const D = 'dev-1';
const OTHER = 'dev-2';

describe('ipDeviceEvent — một dòng ip_history nói gì về MÁY này (DEV-086)', () => {
  it.each<[string, { action: string; changes: Record<string, unknown> | null }, string | null]>([
    ['tạo hồ sơ cấp thẳng cho máy', { action: 'ip.created', changes: { deviceId: D } }, 'ip-assigned'],
    ['tạo hồ sơ cho máy khác', { action: 'ip.created', changes: { deviceId: OTHER } }, null],
    [
      'chuyển Trống → Đang dùng cho máy',
      { action: 'ip.assigned', changes: { previousDeviceId: null, deviceId: D } },
      'ip-assigned',
    ],
    [
      'thu hồi khỏi máy',
      { action: 'ip.released', changes: { previousDeviceId: D, deviceId: null } },
      'ip-released',
    ],
    [
      'sửa hồ sơ: đổi chủ từ máy khác sang máy này',
      { action: 'ip.updated', changes: { deviceId: { before: OTHER, after: D } } },
      'ip-assigned',
    ],
    [
      'sửa hồ sơ: đổi chủ từ máy này sang máy khác',
      { action: 'ip.updated', changes: { deviceId: { before: D, after: OTHER } } },
      'ip-released',
    ],
    ['sửa ghi chú, không đụng chủ', { action: 'ip.updated', changes: { note: { before: null, after: 'x' } } }, null],
    // Dòng "gán chủ khi sửa hồ sơ" đi kèm một dòng ip.updated mang deviceId — không đếm hai lần.
    ['dòng phụ không mang chủ', { action: 'ip.assigned', changes: { reason: 'gán chủ khi sửa hồ sơ' } }, null],
    ['không có changes', { action: 'ip.voided', changes: null }, null],
  ])('%s', (_name, row, expected) => {
    expect(ipDeviceEvent(row, D)).toBe(expected);
  });
});
