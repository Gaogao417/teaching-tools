/**
 * Vitest setup：在每个测试文件的模块图加载前落 SQLITE_PATH。
 * db 单例（src/db/database.ts）在模块加载期读取该 env——必须先于任何
 * services 模块的 import 执行（setupFiles 恰好满足该时序）。
 */
import { mkdtempSync, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const dir = mkdtempSync(path.join(os.tmpdir(), "tutor-vitest-"));
process.env.SQLITE_PATH = path.join(dir, "test.sqlite");
// 默认关闭 telemetry 落盘（个别用例显式打开验证）。
process.env.TUTOR_TELEMETRY ??= "off";

process.on("exit", () => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});
