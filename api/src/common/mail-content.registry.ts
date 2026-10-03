import { Global, Injectable, Module } from '@nestjs/common';

/**
 * Nội dung một lá thư mà module CHỦ dữ liệu dựng ra — `mail` chỉ bọc khuôn (`renderMail`) và gửi.
 * `ctaPath` là đường UI tương đối (từ `UI_PATHS`), không ghép host.
 */
export interface MailContent {
  to: string[];
  subject: string;
  title: string;
  intro: string;
  rows: { label: string; value: string }[];
  ctaLabel: string;
  ctaPath: string;
  footnote?: string;
}

/** Dựng thư từ payload outbox (chỉ id tham chiếu — NFR-04). `null` = không còn gì để gửi. */
export type MailContentBuilder = (payload: Record<string, unknown>) => Promise<MailContent | null>;

/**
 * Sổ ĐẢO PHỤ THUỘC cho thư mà người nhận và nội dung nằm trong bảng của một module nghiệp vụ:
 * `mail` là tầng nền, không import được module đó (AD-2), còn outbox chỉ giữ id (không email,
 * không tên — NFR-04). Module chủ đăng ký cách dựng thư cho topic của nó; consumer vẫn phải gọi
 * tên topic tường minh trong `build()` (để `mail-topics.spec.ts` đối chiếu được), rồi hỏi sổ.
 */
@Injectable()
export class MailContentRegistry {
  private readonly builders = new Map<string, MailContentBuilder>();

  register(topic: string, builder: MailContentBuilder): void {
    this.builders.set(topic, builder);
  }

  /** `undefined` = chưa module nào đăng ký topic này (module chủ chưa nạp). */
  find(topic: string): MailContentBuilder | undefined {
    return this.builders.get(topic);
  }
}

@Global()
@Module({
  providers: [MailContentRegistry],
  exports: [MailContentRegistry],
})
export class MailContentRegistryModule {}
