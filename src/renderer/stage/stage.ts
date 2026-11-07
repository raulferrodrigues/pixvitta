import { createStage } from "./stageApi";
import { runScenario, scenarioNames } from "./scenarios";

/*
 * The stage entry point. It installs a fake window.pixvitta and then boots the
 * real renderer through its real entry point, so everything from the store to
 * the components is the code that ships. Nothing here is imported by index.html,
 * so none of it reaches a production build.
 */

const stage = createStage();
window.pixvitta = stage.api;
window.pixvittaStage = stage.controls;

const requested = new URLSearchParams(window.location.search).get("scenario") ?? "folder";
if (!scenarioNames.includes(requested)) {
  console.error(`Unknown stage scenario "${requested}". Available: ${scenarioNames.join(", ")}`);
}
runScenario(requested, stage.controls);

void import("../main");
