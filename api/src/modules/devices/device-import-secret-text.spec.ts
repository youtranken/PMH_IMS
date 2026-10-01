import { planDeviceImport, type DeviceImportContext } from './device-import';
import type { ParsedSheets } from '../../common/import-plan';

/**
 * Q-19, SEC-21: file Excel không phải cửa sau cho mật khẩu vào cột Ghi chú. Dòng có ô như thế
 * thành dòng LỖI (cả file vẫn duyệt được các dòng khác), và câu lỗi không nhắc lại ô đó — bảng
 * đối chiếu hiện lên màn hình và nằm trong nhật ký.
 */
function context(): DeviceImportContext {
  return {
    catalog: {
      sites: new Map(),
      cabinets: new Map(),
      deviceTypes: new Map([['switch', { id: 'type-switch', name: 'Switch' }]]),
      vendors: new Map(),
    },
    devices: new Map(),
  };
}

function sheet(notes: string[]): ParsedSheets {
  return {
    'Thiết bị': notes.map((note, i) => ({
      rowNumber: i + 2,
      cells: {
        'Mã thiết bị *': `SW-E2E-${i}`,
        'Tên thiết bị *': 'Switch',
        'Loại *': 'Switch',
        'Ghi chú': note,
      },
    })),
  };
}

describe('Nhập thiết bị · ô Ghi chú không chứa mật khẩu (Q-19)', () => {
  it.each([
    ['mk tạm Pmh@Guest2026 nhớ đổi', 'Pmh@Guest2026'],
    ['Key VK7JG-NPHTM-C97JM-9MPGT-3V66T', 'VK7JG-NPHTM-C97JM-9MPGT-3V66T'],
  ])('"%s" → dòng lỗi, nêu cột, không nhắc lại', (note, secret) => {
    const plan = planDeviceImport(sheet([note]), context());
    expect(plan.rows[0].action).toBe('error');
    expect(plan.rows[0].message).toContain('Ghi chú');
    expect(JSON.stringify(plan.rows[0])).not.toContain(secret);
  });

  it('ghi chú thường vẫn nhập được, dòng lỗi không kéo dòng khác', () => {
    const plan = planDeviceImport(
      sheet(['Model WS-C2960X-48FPD-L, serial FOC2010X1AB', 'admin / Admin@123456']),
      context(),
    );
    expect(plan.rows.map((r) => r.action)).toEqual(['create', 'error']);
  });
});
