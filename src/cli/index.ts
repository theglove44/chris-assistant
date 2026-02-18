import { Command } from "commander";
import { registerStartCommand } from "./commands/start.js";
import { registerStopCommand } from "./commands/stop.js";
import { registerRestartCommand } from "./commands/restart.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerLogsCommand } from "./commands/logs.js";
import { registerMemoryCommand } from "./commands/memory.js";
import { registerIdentityCommand } from "./commands/identity.js";
import { registerConfigCommand } from "./commands/config.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerSetupCommand } from "./commands/setup.js";

const program = new Command();

program
  .name("chris")
  .description("Manage your personal AI assistant")
  .version("0.1.0");

// Process management
registerStartCommand(program);
registerStopCommand(program);
registerRestartCommand(program);
registerStatusCommand(program);
registerLogsCommand(program);

// Memory & identity
registerMemoryCommand(program);
registerIdentityCommand(program);

// Config & diagnostics
registerConfigCommand(program);
registerDoctorCommand(program);
registerSetupCommand(program);

program.parse();
