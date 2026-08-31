/**
 * ClaudeCodeGateProvider（R3 工作项 7 — 真模型实证 provider，2026-08-31 用户指定）。
 *
 * headless 调用 claude code CLI（`/opt/homebrew/bin/claude` 2.1.114）：`-p` 打印
 * 模式、`--effort low`（thinking 等级 low）、`--tools ""`（禁用全部工具——裁决
 * 不需要任何工具调用）、JSON-only prompt（系统提示词由 ModelGateAdjudicatorV5
 * 的 buildPrompt 生成）。作为 ModelGateAdjudicatorV5 的可插拔 provider。
 *
 * 边界：
 * - **不接入 CI/npm test 链**（真模型实证=手动脚本 `scripts/r3-claude-gate-evidence.ts`
 *   + 环境变量开关 `R3_CLAUDE_GATE_EVIDENCE=1`）；确定性套件用固定响应 provider；
 * - CLI 认证失败/网络失败/超时 → provider 抛错 → adjudicator 降级 unclear（fail
 *   closed），实证脚本登记 Blocked（附错误原文），确定性套件不受影响；
 * - 输出原文只进实证证据（gate 报告专节），不进事件流（ADR-007 不变量 5）。
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { GATE_ADJUDICATION_SYSTEM_PROMPT, type GateAdjudicationProvider } from "./ModelGateAdjudicatorV5";

export const CLAUDE_CODE_BIN = "/opt/homebrew/bin/claude";
export const CLAUDE_CODE_PROVIDER_NAME = "claude-code-cli/2.1.114";

export interface ClaudeCodeGateProviderOptions {
  /** CLI 超时（ms，默认 240s——effort low 裁决通常 <20s，偶发排队留余量）。 */
  readonly timeoutMs?: number;
  /** 可执行文件路径（默认 /opt/homebrew/bin/claude）。 */
  readonly bin?: string;
  /** 额外 CLI 参数（默认空；--effort low/--tools 已内建）。 */
  readonly extraArgs?: readonly string[];
}

export class ClaudeCodeGateProvider implements GateAdjudicationProvider {
  readonly name = CLAUDE_CODE_PROVIDER_NAME;
  private readonly bin: string;
  private readonly timeoutMs: number;
  private readonly extraArgs: readonly string[];

  constructor(options: ClaudeCodeGateProviderOptions = {}) {
    this.bin = options.bin ?? CLAUDE_CODE_BIN;
    this.timeoutMs = options.timeoutMs ?? 240_000;
    this.extraArgs = options.extraArgs ?? [];
  }

  adjudicate(contextJson: string): Promise<string> {
    // provider 接口收上下文 JSON，自行组装完整 prompt（系统提示词九条 + 上下文
    // + JSON-only 收尾——与 ModelGateAdjudicatorV5.buildPrompt 同口径）；
    // CLI 以 -p/--print 打印模式一次性返回文本。
    const prompt = [
      GATE_ADJUDICATION_SYSTEM_PROMPT,
      "",
      "上下文（JSON，唯一事实来源）：",
      contextJson,
      "",
      "现在只返回裁决 JSON 对象（规则 8 的字段与枚举），不要输出任何其他内容。",
    ].join("\n");
    return new Promise<string>((resolve, reject) => {
      execFile(
        this.bin,
        ["-p", "--effort", "low", "--tools", "", "--output-format", "text", ...this.extraArgs, prompt],
        { timeout: this.timeoutMs, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: "cli" } },
        (error, stdout, stderr) => {
          if (error) {
            const detail = `${error.message}${stderr ? `; stderr: ${String(stderr).slice(0, 400)}` : ""}`;
            reject(new Error(`claude code CLI failed: ${detail}`));
            return;
          }
          const text = stdout.toString().trim();
          if (!text) {
            reject(new Error("claude code CLI returned empty output"));
            return;
          }
          resolve(text);
        },
      );
    });
  }
}

/** CLI 可达性预检（实证脚本入口用；不存在/不可执行直接 Blocked，不跑矩阵）。 */
export function claudeCodeBinaryAvailable(bin: string = CLAUDE_CODE_BIN): boolean {
  return existsSync(bin);
}
