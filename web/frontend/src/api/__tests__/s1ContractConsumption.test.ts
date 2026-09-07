import { describe, expect, it } from "vitest";
import { adaptivePresentationSnapshotFieldsSchema, parseSessionSnapshotHttp } from "../../../../shared/tutorHttpProfile";
import { validatePayload } from "../../../../shared/canonical";
import cases from "../../../../shared/fixtures/s1-http-field-cases.json";
import manifest from "../../../../shared/canonical/fixtures/fixtures-manifest.json";
import { runtimeSnapshotRaw } from "../../action-runtime/tutor/__tests__/runtimeSnapshotFixture";

const fixtures = import.meta.glob("../../../../shared/canonical/fixtures/*.json", { eager: true, import: "default" });
const wave = /(?:tutor-plan-bundle\.v6|tutor-runtime-state\.v3|tutor-session-event\.v8|tutor-policy-decision\.v2|presentation-plan\.v3|presentation-draft\.|presentation-tool-spec\.|workspace-runtime-state\.v2|student-workspace-view\.v2)/;
describe("P1 S1 frontend contract consumption (product integration remains P2)", () => {
  it.each(cases)("HTTP fields: $name", ({ payload, valid }) => {
    expect(adaptivePresentationSnapshotFieldsSchema.safeParse(payload).success).toBe(valid);
  });
  it.each(manifest.fixtures.filter((entry) => wave.test(entry.file)))("canonical: $file", (entry) => {
    const payload = fixtures[`../../../../shared/canonical/fixtures/${entry.file}`];
    expect(payload).toBeDefined();
    expect(validatePayload(payload).ok).toBe(entry.expect_schema === "valid");
  });
  it("does not accidentally enable pending in the current online snapshot parser", () => {
    const candidate = cases.find((entry) => entry.name === "pending-approved")!.payload;
    expect(parseSessionSnapshotHttp({ ...runtimeSnapshotRaw(), ...candidate }).ok).toBe(false);
  });
});
