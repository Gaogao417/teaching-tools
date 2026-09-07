/** CSS allocation regression. jsdom checks the real cascade, not pixel layout;
 * the main browser run must verify SVG height stays inside the geometry slot. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { FocusWorkspace } from "../../components/layout/FocusWorkspace";
import { StudentWorkspaceFrame } from "../../presentation/workspace/StudentWorkspaceFrame";
import { readFileSync } from "node:fs";
const focusCss = readFileSync("src/styles/focus-workspace.css", "utf8");
const practiceCss = readFileSync("src/styles/practice.css", "utf8");
const geometryCss = readFileSync("src/styles/geometry-poc.css", "utf8");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("canonical grid owns height instead of auto tracks and percentage-height SVG feedback", async () => {
  const style = document.createElement("style");
  style.textContent = `${practiceCss}\n${focusCss}\n${geometryCss}`; document.head.appendChild(style);
  const host = document.createElement("div"); host.className = "ks-focus-page tutor-learn-page";
  document.body.appendChild(host); const root = createRoot(host);
  try {
    await act(async () => root.render(
      <FocusWorkspace ariaLabel="测试工作区" prompt="题目" rail="讲解">
        <StudentWorkspaceFrame frameTestId="canonical-student-workspace" board={<section>板书</section>}
          geometry={<div className="canonical-workspace-canvas">
            <div className="geometry-canvas" style={{ aspectRatio: "6 / 4" }}><div className="geometry-canvas__board"><svg width="260" height="1432" /></div></div>
            <p className="canonical-canvas-readonly-note">只读画布</p>
          </div>} />
      </FocusWorkspace>
    ));
    const css = (selector: string) => getComputedStyle(host.querySelector(selector)!);
    for (const selector of [".ks-focus-canvas", ".artifact-math-object", ".artifact-diagram-stage"])
      expect(css(selector).gridTemplateRows, selector).toBe("minmax(0, 1fr)");
    for (const selector of [".student-workspace-frame", ".artifact-math-object", ".artifact-diagram-stage", ".canonical-workspace-canvas", ".geometry-canvas"])
      expect(css(selector).height).toBe("auto");
    expect(parseFloat(css(".artifact-math-object").minHeight)).toBe(0);
    expect(css(".artifact-math-object").contain).toBe("size");
    expect(css(".artifact-diagram-stage").alignItems).toBe("stretch");
    expect(css(".geometry-canvas__board").position).toBe("absolute");
  } finally {
    await act(async () => root.unmount()); host.remove(); style.remove();
  }
});
