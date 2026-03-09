import * as os from "os";
import * as path from "path";

export const APP_DATA_DIR = path.join(os.homedir(), ".chris-assistant");

export function appDataPath(...parts: string[]): string {
  return path.join(APP_DATA_DIR, ...parts);
}
