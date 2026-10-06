/**
 * "Bắt đầu từ" của hộp tạo bản vẽ (Q-23) — hàm THUẦN, test bảng dữ liệu ở
 * `diagram-start.test.ts`.
 *
 * Không có gì tự chép mà người dùng không bấm: cấp thường mặc định trang trắng, chép bản cha chỉ
 * là một lựa chọn. Cấp tủ đã chọn tủ thì mặc định dựng từ kho, vì kho đã biết máy nào nằm U nào.
 */
export type DiagramStart = 'stock' | 'blank' | 'copy';

export interface StartChoice {
  value: DiagramStart;
  /** Khoá lý do tắt (`diagrams.form.startOff_*`); `null` = bật. */
  disabledReason: 'pickCabinet' | 'parentEmpty' | null;
}

export interface StartState {
  choices: StartChoice[];
  fallback: DiagramStart;
}

export function startChoices(input: { hasParent: boolean; parentHasContent: boolean; cabinetLevel: boolean; cabinetPicked: boolean }): StartState {
  const choices: StartChoice[] = [];
  if (input.cabinetLevel) choices.push({ value: 'stock', disabledReason: input.cabinetPicked ? null : 'pickCabinet' });
  choices.push({ value: 'blank', disabledReason: null });
  if (input.hasParent) choices.push({ value: 'copy', disabledReason: input.parentHasContent ? null : 'parentEmpty' });
  return { choices, fallback: input.cabinetLevel && input.cabinetPicked ? 'stock' : 'blank' };
}

/** Lựa chọn của người dùng chỉ giữ khi nó còn bật — đổi cấp hay bỏ chọn tủ thì về mặc định mới. */
export function effectiveStart(picked: DiagramStart | null, state: StartState): DiagramStart {
  const live = state.choices.some((c) => c.value === picked && !c.disabledReason);
  return live && picked ? picked : state.fallback;
}
