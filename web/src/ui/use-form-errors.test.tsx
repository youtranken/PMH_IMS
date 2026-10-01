import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TFunction } from 'i18next';
import i18n from '@/lib/i18n';
import { Field } from '@/ui/page-header';
import { Select } from '@/ui/select';
import { DatePicker } from '@/ui/date-picker';
import { secretTextRule, useFormErrors } from '@/ui/use-form-errors';

/**
 * Kiểm form bằng tiếng Việt thay cho bong bóng của trình duyệt (DoD 6).
 *
 * Bong bóng "Please fill out this field." đi theo ngôn ngữ trình duyệt, mỗi lần chỉ một ô,
 * và tự tắt sau vài giây. Hook này là cửa DUY NHẤT thay nó, nên bài đo trên DOM thật: câu lỗi
 * nằm dưới đúng ô, ô mang `aria-invalid`, tiêu điểm về ô lỗi ĐẦU TIÊN, và lỗi tự tắt khi sửa.
 */

function Demo({ onSave }: { onSave: () => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState('');
  const v = useFormErrors({
    code: !code.trim() && 'Nhập mã.',
    name: !name.trim() && 'Nhập tên.',
    kind: !kind && 'Chọn loại.',
  });
  return (
    <form
      ref={v.formRef}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!v.check()) return;
        onSave();
      }}
    >
      {v.summary}
      <Field label="Mã" required error={v.error('code')}>
        <input className="inp" required value={code} onChange={(e) => setCode(e.target.value)} />
      </Field>
      <Field label="Tên" required error={v.error('name')}>
        <input className="inp" required value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Loại" required error={v.error('kind')}>
        <Select
          value={kind}
          onChange={setKind}
          placeholder="Chọn…"
          options={[{ value: 'a', label: 'A' }]}
        />
      </Field>
      <button type="submit">Lưu</button>
    </form>
  );
}

describe('useFormErrors', () => {
  it('chưa bấm Lưu thì chưa báo lỗi nào — không mắng người vừa mở form', () => {
    render(<Demo onSave={() => {}} />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Mã' })).not.toHaveAttribute('aria-invalid');
  });

  it('bấm Lưu khi trống: câu tiếng Việt dưới từng ô, aria-invalid, tóm tắt, không gọi lưu', async () => {
    const onSave = vi.fn();
    render(<Demo onSave={onSave} />);
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }));

    expect(onSave).not.toHaveBeenCalled();
    const code = screen.getByRole('textbox', { name: 'Mã' });
    expect(code).toHaveAttribute('aria-invalid', 'true');
    expect(code).toHaveAccessibleDescription('Nhập mã.');
    expect(screen.getByRole('button', { name: 'Loại' })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Loại' })).toHaveAccessibleDescription('Chọn loại.');
    expect(screen.getByText('Còn 3 ô cần sửa trước khi lưu.')).toBeInTheDocument();
  });

  it('tiêu điểm về ô lỗi ĐẦU TIÊN theo thứ tự trên màn', async () => {
    render(<Demo onSave={() => {}} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Mã' }), 'PC-01');
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(screen.getByRole('textbox', { name: 'Tên' })).toHaveFocus();
  });

  it('một lỗi thì không cần dòng tóm tắt; sửa xong thì lỗi tự tắt', async () => {
    render(<Demo onSave={() => {}} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Mã' }), 'PC-01');
    await userEvent.type(screen.getByRole('textbox', { name: 'Tên' }), 'Máy');
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(screen.queryByText(/ô cần sửa/)).toBeNull();
    expect(screen.getByText('Chọn loại.')).toBeInTheDocument();

    await userEvent.clear(screen.getByRole('textbox', { name: 'Mã' }));
    expect(screen.getByText('Nhập mã.')).toBeInTheDocument();
    expect(screen.getByText('Còn 2 ô cần sửa trước khi lưu.')).toBeInTheDocument();
  });

  it('đủ ô thì lưu', async () => {
    const onSave = vi.fn();
    render(<Demo onSave={onSave} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Mã' }), 'PC-01');
    await userEvent.type(screen.getByRole('textbox', { name: 'Tên' }), 'Máy');
    await userEvent.click(screen.getByRole('button', { name: 'Loại' }));
    await userEvent.click(screen.getByRole('option', { name: 'A' }));
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(onSave).toHaveBeenCalledOnce();
  });
});

describe('Field error nối vào mọi loại điều khiển', () => {
  it('DatePicker nhận aria-invalid và câu lỗi', () => {
    render(
      <Field label="Hạn mới" error="Chọn ngày.">
        <DatePicker value="" onChange={() => {}} />
      </Field>,
    );
    const trigger = screen.getByLabelText('Hạn mới');
    expect(trigger).toHaveAttribute('aria-invalid', 'true');
    expect(trigger).toHaveAccessibleDescription('Chọn ngày.');
  });
});

describe('secretTextRule — ô chữ tự do ngoài két (Q-19)', () => {
  const t = i18n.t.bind(i18n) as TFunction;

  it.each([
    ['mk wifi Pmh@Guest2026', true],
    ['Key VK7JG-NPHTM-C97JM-9MPGT-3V66T', true],
    ['Model WS-C2960X-48FPD-L, serial FOC2010X1AB', false],
    ['Gói Microsoft365_E3', false],
    ['', false],
  ])('%s → chặn: %s', (value, blocked) => {
    const message = secretTextRule(t, value);
    expect(Boolean(message)).toBe(blocked);
    if (message) expect(message).not.toContain('Pmh@Guest2026');
  });
});
