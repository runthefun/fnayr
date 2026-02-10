import { describe, expect, it, vi } from "vitest";
import { InlineJobQueue } from "./inline";

describe("InlineJobQueue", () => {
  it("enqueue calls handler immediately with correct payload", async () => {
    const queue = new InlineJobQueue();
    const handler = vi.fn().mockResolvedValue(undefined);
    const payload = { url: "https://example.com", retries: 3 };

    queue.process("download", handler);
    await queue.enqueue("download", payload);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(payload);
  });

  it("enqueue returns a string job ID", async () => {
    const queue = new InlineJobQueue();
    queue.process("ping", vi.fn().mockResolvedValue(undefined));

    const id = await queue.enqueue("ping", {});

    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("enqueue throws if no handler registered", async () => {
    const queue = new InlineJobQueue();

    await expect(queue.enqueue("unknown", {})).rejects.toThrow(
      "No handler registered for job type: unknown",
    );
  });

  it("process registers handler that can be called multiple times", async () => {
    const queue = new InlineJobQueue();
    const handler = vi.fn().mockResolvedValue(undefined);

    queue.process("email", handler);

    await queue.enqueue("email", { to: "a@b.com" });
    await queue.enqueue("email", { to: "c@d.com" });
    await queue.enqueue("email", { to: "e@f.com" });

    expect(handler).toHaveBeenCalledTimes(3);
    expect(handler).toHaveBeenNthCalledWith(1, { to: "a@b.com" });
    expect(handler).toHaveBeenNthCalledWith(2, { to: "c@d.com" });
    expect(handler).toHaveBeenNthCalledWith(3, { to: "e@f.com" });
  });

  it("close clears handlers", async () => {
    const queue = new InlineJobQueue();
    queue.process("task", vi.fn().mockResolvedValue(undefined));

    await queue.close();

    await expect(queue.enqueue("task", {})).rejects.toThrow(
      "No handler registered for job type: task",
    );
  });
});
