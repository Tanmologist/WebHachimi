import { chromium } from "playwright";
import * as path from "node:path";
import * as fs from "node:fs";

const URL = "http://localhost:5577/apps/webhachimi/editor.html";
const SCREENSHOT_DIR = path.resolve("logs/screenshots");

async function main() {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

  const results: string[] = [];

  try {
    await page.goto(URL, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);

    const canvas = page.locator("#v2-root canvas");
    await canvas.waitFor({ state: "visible", timeout: 10000 });

    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error("找不到画布");

    await page.keyboard.press("KeyR");
    await page.waitForTimeout(500);

    const allEntityIds = await page.evaluate(() => {
      const testHook = (window as any).__v2_test__;
      if (!testHook) return [];
      const world = testHook.getWorld();
      if (!world) return [];
      return world.allEntities().map((e: any) => e.id);
    });

    results.push(`场景实体总数: ${allEntityIds.length}`);

    const persistentIds = allEntityIds.slice(0, 5);
    results.push(`用于测试的ID: ${persistentIds.join(", ")}`);

    if (persistentIds.length < 2) {
      results.push("❌ 实体不足2个，无法测试");
    } else {
      await page.evaluate((ids) => {
        const testHook = (window as any).__v2_test__;
        if (testHook) testHook.setSelectedIds(ids);
      }, persistentIds);

      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "01-multi-select-set.png") });
      results.push("截图: 01-multi-select-set.png (设置多选后)");

      const selectedAfter = await page.evaluate(() => {
        const testHook = (window as any).__v2_test__;
        return testHook ? testHook.getSelectedIds() : [];
      });
      results.push(`selectedIds: ${JSON.stringify(selectedAfter)}`);
      results.push(selectedAfter.length >= 2 ? "✅ 多选状态已设置" : "❌ 多选设置失败");

      const cx = canvasBox.x + canvasBox.width / 2;
      const cy = canvasBox.y + canvasBox.height / 2;

      await page.evaluate(({ x, y }) => {
        const testHook = (window as any).__v2_test__;
        if (testHook) testHook.simulateRightClick(x, y);
      }, { x: cx, y: cy });

      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "02-right-click-multi.png") });
      results.push("截图: 02-right-click-multi.png (多选右键)");

      const ctxMenu = await page.evaluate(() => {
        const testHook = (window as any).__v2_test__;
        const menu = testHook?.getContextMenu();
        if (!menu) return null;
        return {
          title: menu.title,
          entityId: menu.entityId,
          itemCount: menu.items.length,
          actions: menu.items.map((i: any) => i.action),
          labels: menu.items.map((i: any) => i.label),
        };
      });

      if (ctxMenu) {
        results.push(`菜单标题: ${ctxMenu.title}`);
        results.push(`菜单项: ${ctxMenu.labels.join(" | ")}`);
        const hasBatchDelete = ctxMenu.actions.includes("delete-selected");
        const hasBatchDuplicate = ctxMenu.actions.includes("duplicate-selected");
        results.push(hasBatchDelete ? "✅ 批量删除" : "❌ 批量删除缺失");
        results.push(hasBatchDuplicate ? "✅ 批量复制" : "❌ 批量复制缺失");
      } else {
        results.push("❌ 右键菜单未出现");
      }

      await page.evaluate(() => {
        const testHook = (window as any).__v2_test__;
        if (testHook) testHook.setSelectedIds([]);
      });
      await page.waitForTimeout(200);

      await page.mouse.click(cx, cy);
      await page.waitForTimeout(300);

      await page.mouse.click(cx, cy, { button: "right" });
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "03-single-right-click.png") });
      results.push("截图: 03-single-right-click.png (单选右键)");

      const singleMenu = await page.evaluate(() => {
        const testHook = (window as any).__v2_test__;
        const menu = testHook?.getContextMenu();
        if (!menu) return null;
        return {
          title: menu.title,
          actions: menu.items.map((i: any) => i.action),
          labels: menu.items.map((i: any) => i.label),
        };
      });

      if (singleMenu) {
        results.push(`单选菜单: ${singleMenu.title}`);
        results.push(`单选菜单项: ${singleMenu.labels.join(" | ")}`);
        const isSingleMenu = !singleMenu.actions.includes("delete-selected");
        results.push(isSingleMenu ? "✅ 单选菜单正确（无批量选项）" : "❌ 单选菜单错误（有批量选项）");
      }
    }

  } catch (err) {
    results.push(`❌ 错误: ${String(err)}`);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "error.png") });
  } finally {
    await browser.close();
  }

  console.log("\n=== 选中逻辑验证 ===\n");
  for (const line of results) {
    console.log(line);
  }
}

main().catch(console.error);
