import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, renderWithI18n, screen, userEvent, waitFor } from '@/test/test-utils';
import { DeviceCombobox, devicePickerQuery, type DeviceOption } from '@/ui/device-combobox';

/*
 * Một ô chọn máy cho mọi màn (AD-15): cùng limit, cùng `usable=true`, cùng cách lọc loại / site.
 */
describe('devicePickerQuery', () => {
  it.each([
    [{ term: '' }, 'limit=20&usable=true'],
    [{ term: ' PC-01 ' }, 'limit=20&usable=true&search=PC-01'],
    [{ term: '', nearSiteId: 's1' }, 'limit=20&usable=true&siteId=s1'],
    // Đã gõ thì tìm khắp kho, bỏ gợi ý site.
    [{ term: 'fw', nearSiteId: 's1' }, 'limit=20&usable=true&search=fw'],
    [{ term: '', typeIds: ['a', 'b'] }, 'limit=20&usable=true&deviceTypeIds=a%2Cb'],
    [{ term: '', usable: false }, 'limit=20'],
  ])('%j → %s', (input, expected) => {
    expect(devicePickerQuery(input)).toBe(expected);
  });
});

const ITEMS: DeviceOption[] = [
  { id: 'd1', code: 'FW-01', name: 'Firewall', siteCode: 'HCM' },
  { id: 'd2', code: 'PC-02', name: 'Máy kế toán', siteCode: null },
];

function Harness(props: { exclude?: string[]; minChars?: number; onPick?: (d?: DeviceOption) => void }) {
  const [value, setValue] = useState({ deviceId: '', term: '' });
  return (
    <>
      <DeviceCombobox
        value={value}
        onChange={(next) => {
          setValue({ deviceId: next.deviceId, term: next.term });
          props.onPick?.(next.device);
        }}
        ariaLabel="Thiết bị"
        placeholder="Gõ mã máy"
        exclude={props.exclude}
        minChars={props.minChars}
        renderExtra={(d) => (d.id === 'd1' ? 'đang giữ IP 10.0.0.1' : null)}
      />
      <output data-testid="picked">{value.deviceId}</output>
    </>
  );
}

describe('DeviceCombobox', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stub() {
    const fetchMock = vi.fn((_input: RequestInfo | URL) =>
      Promise.resolve(jsonResponse(200, { items: ITEMS, total: 2 })),
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('bày máy kèm tên · site và dòng ghi thêm; chọn thì trả id + máy', async () => {
    stub();
    const onPick = vi.fn();
    renderWithI18n(<Harness onPick={onPick} />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Thiết bị' }));
    const option = await screen.findByRole('option', { name: /FW-01/ });
    expect(option).toHaveTextContent('Firewall · HCM');
    expect(option).toHaveTextContent('đang giữ IP 10.0.0.1');
    await userEvent.click(option);
    expect(screen.getByTestId('picked')).toHaveTextContent('d1');
    expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'd1', code: 'FW-01' }));
  });

  it('gõ lại sau khi chọn là bỏ lựa chọn cũ', async () => {
    stub();
    renderWithI18n(<Harness />);
    const input = screen.getByRole('combobox', { name: 'Thiết bị' });
    await userEvent.click(input);
    await userEvent.click(await screen.findByRole('option', { name: /FW-01/ }));
    await userEvent.type(input, 'x');
    expect(screen.getByTestId('picked')).toHaveTextContent('');
  });

  it('exclude: máy đã chọn / chính máy đang sửa không bày ra', async () => {
    stub();
    renderWithI18n(<Harness exclude={['d1']} />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Thiết bị' }));
    expect(await screen.findByRole('option', { name: /PC-02/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /FW-01/ })).not.toBeInTheDocument();
  });

  it('minChars: chưa gõ đủ thì không hỏi API; mọi lượt hỏi đều usable=true, limit chung', async () => {
    const fetchMock = stub();
    renderWithI18n(<Harness minChars={2} />);
    const input = screen.getByRole('combobox', { name: 'Thiết bị' });
    await userEvent.type(input, 'P');
    expect(fetchMock).not.toHaveBeenCalled();
    await userEvent.type(input, 'C');
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toBe('/api/v1/devices?limit=20&usable=true&search=PC');
  });
});
