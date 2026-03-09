import { startDashboardServer, stopDashboardServer } from "./dashboard/runtime.js";
import { getDashboardHtml } from "./dashboard/ui.js";

export function startDashboard(): void {
  startDashboardServer(getDashboardHtml);
}

export function stopDashboard(): void {
  stopDashboardServer();
}
