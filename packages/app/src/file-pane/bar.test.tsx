// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The toggle's tooltip pulls in reanimated, which probes reduced-motion on import.
vi.hoisted(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      addEventListener: () => {},
      addListener: () => {},
      dispatchEvent: () => false,
      matches: false,
      media: "",
      onchange: null,
      removeEventListener: () => {},
      removeListener: () => {},
    }),
  });
});

vi.mock("@react-native-async-storage/async-storage", () => {
  const storage = new Map<string, string>();
  return {
    default: {
      getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        storage.set(key, value);
      }),
      removeItem: vi.fn(async (key: string) => {
        storage.delete(key);
      }),
    },
  };
});

import { i18n as testI18n } from "@/i18n/i18next";
import { usePanelStore } from "@/stores/panel-store";
import { FilePanelBar } from "./bar";

void testI18n;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  usePanelStore.setState({ fileTreeVisible: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

function mountBar(): void {
  act(() => root?.render(<FilePanelBar size={128} lineCount={4} />));
}

function treeToggle(): HTMLElement {
  const element = container?.querySelector('[data-testid="file-toggle-tree"]');
  if (!(element instanceof HTMLElement)) {
    throw new Error("file toolbar has no tree toggle");
  }
  return element;
}

describe("FilePanelBar tree toggle", () => {
  it("closes the file tree and reopens it", () => {
    mountBar();

    act(() => treeToggle().click());
    expect(usePanelStore.getState().fileTreeVisible).toBe(false);

    act(() => treeToggle().click());
    expect(usePanelStore.getState().fileTreeVisible).toBe(true);
  });

  it("labels the toggle by the action it performs", () => {
    mountBar();

    expect(treeToggle().getAttribute("aria-label")).toBe("Hide folder tree");

    act(() => treeToggle().click());
    expect(treeToggle().getAttribute("aria-label")).toBe("Show folder tree");
  });
});
