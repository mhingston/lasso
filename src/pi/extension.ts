import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import workflowExtension, { getWorkflowRegistry, type WorkflowRegistry } from "pi-duroxide";
import { createLassoCommands } from "./commands.js";

export default async function lassoExtension(pi: ExtensionAPI) {
  await workflowExtension(pi);

  const registry = getWorkflowRegistry();
  if (!registry) {
    return;
  }

  for (const command of createLassoCommands(registry)) {
    pi.registerCommand(command.name, command);
  }
}
