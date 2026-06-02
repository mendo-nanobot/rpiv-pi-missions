import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	buildAllMissionsDashboardData,
	buildMissionDashboardData,
	computeExpectedInput,
	deriveMissionStage,
	startDashboardServer,
	stopDashboardServer,
} from "./dashboard.js";
import {
	addFeature,
	approveMission,
	createFollowupsFromFailures,
	createMission,
	recordValidation,
	updateFeatureStatus,
	writeHandoff,
} from "./missions.js";

function tempCwd(): string {
	return mkdtempSync(join(tmpdir(), "rpiv-dashboard-"));
}

function approveForTest(cwd: string, mission: ReturnType<typeof createMission>) {
	writeFileSync(join(cwd, mission.contractPath), "# Validation Contract\n\n- [ ] VC-001 — Real behavior.\n", "utf8");
	return approveMission(cwd, mission);
}

const startedCwds: string[] = [];

afterEach(async () => {
	for (const cwd of startedCwds.splice(0)) {
		try {
			await stopDashboardServer(cwd);
		} catch {
			// already stopped
		}
	}
});

describe("mission dashboard", () => {
	it("shows draft missions as needing contract/orchestrator input", () => {
		const cwd = tempCwd();
		const mission = createMission(cwd, "Build dashboard");

		expect(deriveMissionStage(mission)).toBe("draft");
		expect(computeExpectedInput(mission, "draft").commands).toEqual([
			"/skill:mission-orchestrator",
			"/mission-approve",
		]);
	});

	it("shows exact next commands for implementation, validation, repair, and done states", () => {
		const cwd = tempCwd();
		let mission = createMission(cwd, "Build dashboard");
		mission = approveForTest(cwd, mission);
		mission = addFeature(cwd, mission, { title: "Add HTTP dashboard", assertions: ["VC-001"] });

		expect(buildMissionDashboardData(cwd, mission).expectedInput.commands).toEqual(["/mission-next"]);

		mission = updateFeatureStatus(cwd, mission, "F-001", "in_progress");
		expect(buildMissionDashboardData(cwd, mission).expectedInput.commands).toEqual(["/skill:mission-worker F-001"]);

		mission = writeHandoff(cwd, mission, {
			featureId: "F-001",
			completed: ["dashboard server"],
			leftUndone: [],
			commands: [{ command: "npm test", exitCode: 0 }],
			issues: [],
			assertionsCovered: ["VC-001"],
		});
		expect(buildMissionDashboardData(cwd, mission).expectedInput.commands).toEqual(["/mission-validate F-001"]);

		mission = updateFeatureStatus(cwd, mission, "F-001", "in_validation");
		expect(buildMissionDashboardData(cwd, mission).expectedInput.commands).toEqual([
			"/skill:mission-validator F-001",
			"/skill:mission-user-testing-validator F-001",
		]);

		mission = recordValidation(cwd, mission, {
			featureId: "F-001",
			type: "user_testing",
			status: "fail",
			summary: "visual stage copy is unclear",
			failedAssertions: ["VC-001"],
		});
		expect(buildMissionDashboardData(cwd, mission).stage).toBe("repair");
		expect(buildMissionDashboardData(cwd, mission).expectedInput.commands).toEqual([
			"/mission-repair",
			"/mission-next",
		]);

		mission = createFollowupsFromFailures(cwd, mission);
		expect(buildMissionDashboardData(cwd, mission).stage).toBe("planning");
	});

	it("serves mission list, active mission, detail, and contract over localhost HTTP", async () => {
		const cwd = tempCwd();
		let mission = createMission(cwd, "Monitor missions visually");
		mission = approveForTest(cwd, mission);
		mission = addFeature(cwd, mission, { title: "Render stages", assertions: ["VC-001"] });

		const port = await startDashboardServer(cwd, 0);
		startedCwds.push(cwd);

		const root = await fetch(`http://127.0.0.1:${port}/`);
		expect(await root.text()).toContain("Pi Mission Control");

		const all = (await fetch(`http://127.0.0.1:${port}/api/missions`).then((res) => res.json())) as {
			activeMissionId: string;
			missions: unknown[];
		};
		expect(all.activeMissionId).toBe(mission.id);
		expect(all.missions).toHaveLength(1);

		const active = (await fetch(`http://127.0.0.1:${port}/api/missions/active`).then((res) => res.json())) as {
			expectedInput: { commands: string[] };
		};
		expect(active.expectedInput.commands).toEqual(["/mission-next"]);

		const detail = (await fetch(`http://127.0.0.1:${port}/api/missions/${mission.id}`).then((res) => res.json())) as {
			goal: string;
		};
		expect(detail.goal).toBe("Monitor missions visually");

		const contract = await fetch(`http://127.0.0.1:${port}/api/missions/${mission.id}/contract`).then((res) =>
			res.text(),
		);
		expect(contract).toContain("VC-001");
	});

	it("returns summaries for all missions with active pointer", () => {
		const cwd = tempCwd();
		createMission(cwd, "First mission");
		const second = createMission(cwd, "Second mission");

		expect(buildAllMissionsDashboardData(cwd)).toMatchObject({
			activeMissionId: second.id,
			missions: expect.arrayContaining([expect.objectContaining({ id: second.id })]),
		});
	});
});
