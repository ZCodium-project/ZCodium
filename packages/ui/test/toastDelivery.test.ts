import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createToastDelivery } from "@/components/ui/toastDelivery.js";

/**
 * Toast delivery zero-rAF contract:
 *
 * Electron throttles/suspends requestAnimationFrame for occluded/backgrounded
 * windows, while React state rendering (Scheduler/MessageChannel) keeps working.
 * A delivery path that retries inside rAF (or gates visibility on rAF) therefore
 * loses toasts exactly when the window cannot produce frames. These tests pin
 * the contract: delivery is either synchronous or buffered until the container
 * mounts — never frame-dependent.
 */

describe("createToastDelivery delivery contract", () => {
  it("delivers synchronously once the receiver is set", () => {
    const delivery = createToastDelivery<string>();
    const received: string[] = [];
    delivery.setReceiver((item) => received.push(item));
    delivery.deliver("a");
    expect(received).toEqual(["a"]);
  });

  it("buffers before the receiver is set and drains in order on mount (no rAF involved)", () => {
    const delivery = createToastDelivery<string>();
    delivery.deliver("a");
    delivery.deliver("b");
    expect(delivery.buffered()).toEqual(["a", "b"]);
    const received: string[] = [];
    delivery.setReceiver((item) => received.push(item));
    expect(received).toEqual(["a", "b"]);
    expect(delivery.buffered()).toEqual([]);
  });

  it("delivers immediately after the initial drain", () => {
    const delivery = createToastDelivery<string>();
    const received: string[] = [];
    delivery.deliver("early");
    delivery.setReceiver((item) => received.push(item));
    delivery.deliver("late");
    expect(received).toEqual(["early", "late"]);
  });

  it("returns to buffering semantics after the receiver unmounts", () => {
    const delivery = createToastDelivery<string>();
    const received: string[] = [];
    delivery.setReceiver((item) => received.push(item));
    delivery.unsetReceiver();
    delivery.deliver("queued");
    expect(received).toEqual([]);
    expect(delivery.buffered()).toEqual(["queued"]);
  });
});

describe("toast module source-level zero-rAF assertion", () => {
  it("toast.tsx contains no requestAnimationFrame (regression guard)", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../src/components/ui/toast.tsx", import.meta.url)),
      "utf8",
    );
    expect(source.includes("requestAnimationFrame")).toBe(false);
  });
});
