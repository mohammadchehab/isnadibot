import { ThreadId } from "@isnadi/contracts";
import { deriveComputerViewer } from "@isnadi/client-runtime/state/computer-viewer";
import { createComputerViewerController } from "@isnadi/client-runtime/state/computer-viewer-controller";
import { describe, expect, it } from "vite-plus/test";

import { createFixtureComputerPort } from "./fixtureComputer";

const threadId = ThreadId.make("fixture-thread");

function fixtureViewer() {
  const controller = createComputerViewerController({
    port: createFixtureComputerPort(threadId),
  });

  return { controller, view: () => deriveComputerViewer(controller.getState()) };
}

describe("createFixtureComputerPort", () => {
  it("watches the bot's computer with control on offer", async () => {
    const { controller, view } = fixtureViewer();

    await controller.show();

    expect(view()).toMatchObject({ phase: "live", owner: "bot", canTakeControl: true });
  });

  it("takes control, then gives it back", async () => {
    const { controller, view } = fixtureViewer();

    await controller.show();
    await controller.takeControl();

    expect(view()).toMatchObject({ phase: "live", owner: "you", canReturnControl: true });

    await controller.returnControl();

    expect(view()).toMatchObject({ phase: "live", owner: "bot", canTakeControl: true });
  });

  it("hands control back to the bot when the viewer closes on background", async () => {
    const { controller, view } = fixtureViewer();

    await controller.show();
    await controller.takeControl();
    await controller.hide();

    expect(view()).toMatchObject({ phase: "hidden", owner: "nobody" });

    // Resume from paused reopens the stream; the computer itself never stopped.
    await controller.show();

    expect(view()).toMatchObject({ phase: "live", owner: "bot" });
  });

  it("shows the stopped screen after a stop", async () => {
    const { controller, view } = fixtureViewer();

    await controller.show();
    await controller.stop();

    expect(view()).toMatchObject({ phase: "stopped", canResume: true });
  });
});
