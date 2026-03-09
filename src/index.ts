import { startApp } from "./app/bootstrap.js";
import { registerProcessLifecycle } from "./app/lifecycle.js";

registerProcessLifecycle();

startApp().catch((err: any) => {
  console.error("[chris-assistant] Failed to start:", err.message);
  process.exit(1);
});
