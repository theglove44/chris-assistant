import { JsonStore } from "../../infra/storage/json-store.js";
import { appDataPath } from "../../infra/storage/paths.js";
import type { NoticeState } from "./types.js";

const EMPTY_NOTICE_STATE: NoticeState = {
  deliveries: [],
  suppressedUntil: {},
};

export function createNoticeStateStore(
  filePath = appDataPath("notice-state.json"),
): JsonStore<NoticeState> {
  return new JsonStore<NoticeState>(filePath, EMPTY_NOTICE_STATE);
}
