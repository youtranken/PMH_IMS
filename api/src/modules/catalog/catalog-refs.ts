/**
 * Câu từ chối cho "chọn MỚI một mục danh mục đã vô hiệu" (Q-14) — MỘT bản chữ cho mọi cửa ghi
 * (thiết bị, phần mềm, dải mạng, đường truyền, tủ mạng). Mỗi cửa tự viết một câu thì các câu
 * sẽ trôi khỏi nhau, và người dùng gặp năm cách nói cho cùng một luật.
 *
 * Câu nêu TÊN mục (người sửa cần biết vướng cái nào) và cả hai đường ra: chọn mục khác, hoặc
 * bật lại mục đó trong Danh mục.
 */
export function inactiveRefMessage(kind: string, label: string): string {
  return `${kind} "${label}" đã ngừng dùng — chọn mục khác, hoặc bật lại trong Danh mục.`;
}

/** Mã lỗi đi kèm câu trên — web và bài kiểm bám vào mã, không bám vào chữ. */
export const CATALOG_REF_INACTIVE = 'CATALOG_REF_INACTIVE';
