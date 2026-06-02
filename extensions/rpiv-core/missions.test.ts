import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	addFeature,
	approveMission,
	createFollowupsFromFailures,
	createMission,
	createMissionId,
	formatMissionStatus,
	loadActiveMission,
	recordValidation,
	updateFeatureStatus,
	writeHandoff,
} from "./missions.js";

function tempCwd(): string {
	return mkdtempSync(join(tmpdir(), "rpiv-mission-"));
}

function approveForTest(cwd: string, mission: ReturnType<typeof createMission>) {
	writeFileSync(join(cwd, mission.contractPath), "# Validation Contract\n\n- [ ] VC-001 — Real behavior.\n", "utf8");
	return approveMission(cwd, mission);
}

describe("missions", () => {
	it("creates a persistent mission with a validation contract", () => {
		const cwd = tempCwd();
		const mission = createMission(cwd, "Build Slack clone");

		expect(mission.id).toContain("build-slack-clone");
		expect(loadActiveMission(cwd)?.id).toBe(mission.id);
		expect(readFileSync(join(cwd, ".pi/missions", mission.id, "validation-contract.md"), "utf8")).toContain(
			"Validation Contract",
		);
	});

	it("does not overwrite a same-day mission with the same goal", () => {
		const cwd = tempCwd();
		const first = createMission(cwd, "Build Slack clone");
		const second = createMission(cwd, "Build Slack clone");

		expect(second.id).not.toBe(first.id);
		expect(second.id).toContain("-2");
		expect(loadActiveMission(cwd)?.id).toBe(second.id);
	});

	it("requires replacing starter contract placeholders before approval", () => {
		const cwd = tempCwd();
		const mission = createMission(cwd, "Build Slack clone");

		expect(() => approveMission(cwd, mission)).toThrow("Replace the starter validation-contract placeholders");
	});

	it("slugifies ids deterministically for a provided date", () => {
		expect(createMissionId("Hello, Missions!", new Date("2026-06-02T00:00:00Z"))).toBe("2026-06-02-hello-missions");
	});

	it("rejects validation before a feature handoff exists", () => {
		const cwd = tempCwd();
		let mission = createMission(cwd, "Add mission workflow");
		mission = approveForTest(cwd, mission);
		mission = addFeature(cwd, mission, { title: "Implement state store", assertions: ["VC-001"] });

		expect(() =>
			recordValidation(cwd, mission, {
				featureId: "F-001",
				type: "scrutiny",
				status: "fail",
				summary: "missing contract coverage check",
				failedAssertions: ["VC-002"],
			}),
		).toThrow("Handoff required before validation");
	});

	it("tracks serial feature state, handoffs, validation failures, and repair followups", () => {
		const cwd = tempCwd();
		let mission = createMission(cwd, "Add mission workflow");
		mission = approveForTest(cwd, mission);
		mission = addFeature(cwd, mission, { title: "Implement state store", assertions: ["VC-001"] });
		mission = updateFeatureStatus(cwd, mission, "F-001", "in_progress");
		mission = writeHandoff(cwd, mission, {
			featureId: "F-001",
			completed: ["state store"],
			leftUndone: [],
			commands: [{ command: "npm test", exitCode: 0 }],
			issues: [],
			assertionsCovered: ["VC-001"],
		});
		mission = recordValidation(cwd, mission, {
			featureId: "F-001",
			type: "scrutiny",
			status: "fail",
			summary: "missing contract coverage check",
			failedAssertions: ["VC-002"],
		});
		mission = createFollowupsFromFailures(cwd, mission);

		expect(mission.features.find((feature) => feature.id === "F-001")?.status).toBe("blocked");
		expect(mission.features.find((feature) => feature.createdFrom === "V-001")?.title).toContain("Repair F-001");
		expect(formatMissionStatus(mission)).toContain("blocked");
	});
});
