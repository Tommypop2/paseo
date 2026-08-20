// The file panel's tree rail had no way to close: the changes panel's toolbar
// carries a folder-tree toggle, the file toolbar carried nothing, and the rail
// was permanent on desktop.
import { expect } from "@playwright/test";
import { test } from "../support/fixtures";
import { openFileExplorer, openFileFromExplorer } from "../support/helpers/file-explorer";
import { gotoWorkspace } from "../support/helpers/launcher";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";

let workspace: SeededWorkspace;

test.beforeAll(async () => {
  workspace = await seedWorkspace({
    repoPrefix: "file-tree-rail-toggle-",
    repo: { files: [{ path: "docs/guide.md", content: "# Guide\n" }] },
  });
});

test.afterAll(async () => {
  await workspace?.cleanup();
});

test.describe("File panel tree rail", () => {
  test("the file toolbar toggle closes and reopens the tree", async ({ page }, testInfo) => {
    await gotoWorkspace(page, workspace.workspaceId);
    await openFileExplorer(page);
    await openFileFromExplorer(page, "docs");
    await openFileFromExplorer(page, "guide.md");

    const rail = page.getByTestId("file-tree-rail-tree").filter({ visible: true });
    const toggle = page.getByTestId("file-toggle-tree").filter({ visible: true }).first();
    const shoot = async (name: string) => {
      const path = testInfo.outputPath(`${name}.png`);
      await page.screenshot({ path });
      await testInfo.attach(name, { path, contentType: "image/png" });
    };
    await expect(rail).toBeVisible({ timeout: 30_000 });
    await shoot("tree-open");

    await toggle.click();
    await expect(rail).toHaveCount(0);
    await shoot("tree-closed");

    await toggle.click();
    await expect(rail).toBeVisible();
    await shoot("tree-reopened");
  });
});
