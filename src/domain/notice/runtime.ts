import { config } from "../../config.js";
import { bot } from "../../channels/telegram/bot.js";
import { listLocalJournalDates } from "../memory/journal-service.js";
import { listUpcomingCalendarEvents } from "../../tools/macos/calendar-client.js";
import { IS_DARWIN } from "../../tools/macos/shared.js";
import { CalendarConflictScanner } from "./calendar-conflict-scanner.js";
import { JournalGapScanner } from "./journal-gap-scanner.js";
import { NoticeService } from "./notice-service.js";
import { createNoticeStateStore } from "./state.js";

const noticeService = new NoticeService(
  config.notice,
  [
    new JournalGapScanner(config.notice.journalGapDays, listLocalJournalDates),
    ...(IS_DARWIN ? [new CalendarConflictScanner(listUpcomingCalendarEvents)] : []),
  ],
  {
    async send(text: string): Promise<void> {
      await bot.api.sendMessage(config.telegram.allowedUserId, text);
    },
  },
  createNoticeStateStore(),
);

export function startNoticeLoop(): void {
  noticeService.start();
}

export function stopNoticeLoop(): void {
  noticeService.stop();
}
