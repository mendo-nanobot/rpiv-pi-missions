import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export type MissionStatus = "draft" | "approved" | "in_progress" | "blocked" | "completed";
export type FeatureStatus = "pending" | "in_progress" | "in_validation" | "done" | "blocked";
export type ValidationStatus = "pass" | "fail" | "needs_followup";

export type MissionFeature = {
	id: string;
	title: string;
	status: FeatureStatus;
	milestone: number;
	assertions: string[];
	createdFrom?: string;
};

export type MissionValidation = {
	id: string;
	featureId: string;
	type: "scrutiny" | "user_testing" | "manual";
	status: ValidationStatus;
	summary: string;
	failedAssertions: string[];
	artifactPath?: string;
	timestamp: string;
};

export type MissionHandoff = {
	id: string;
	featureId: string;
	completed: string[];
	leftUndone: string[];
	commands: Array<{ command: string; exitCode: number | null }>;
	issues: string[];
	assertionsCovered: string[];
	artifactPath?: string;
	timestamp: string;
};

export type MissionState = {
	id: string;
	goal: string;
	status: MissionStatus;
	approved: boolean;
	createdAt: string;
	updatedAt: string;
	currentMilestone: number;
	features: MissionFeature[];
	validations: MissionValidation[];
	handoffs: MissionHandoff[];
	contractPath: string;
};

type CommandContext = {
	cwd: string;
	hasUI?: boolean;
	ui: { notify: (msg: string, sev: "info" | "warning" | "error") => void };
};

const MISSIONS_DIR = ".pi/missions";
const ACTIVE_FILE = "active";
const STATE_FILE = "mission.json";

function nowIso(): string {
	return new Date().toISOString();
}

function slugify(input: string): string {
	const slug = input
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);
	return slug || "mission";
}

export function createMissionId(goal: string, date = new Date(), suffix = ""): string {
	const stamp = date.toISOString().slice(0, 10);
	return `${stamp}-${slugify(goal)}${suffix}`;
}

export function missionsRoot(cwd: string): string {
	return join(cwd, MISSIONS_DIR);
}

export function missionDir(cwd: string, id: string): string {
	return join(missionsRoot(cwd), id);
}

export function missionStatePath(cwd: string, id: string): string {
	return join(missionDir(cwd, id), STATE_FILE);
}

function activePath(cwd: string): string {
	return join(missionsRoot(cwd), ACTIVE_FILE);
}

function ensureMissionDirs(cwd: string, id: string): void {
	for (const dir of [
		missionsRoot(cwd),
		missionDir(cwd, id),
		join(missionDir(cwd, id), "features"),
		join(missionDir(cwd, id), "handoffs"),
		join(missionDir(cwd, id), "validations"),
	]) {
		mkdirSync(dir, { recursive: true });
	}
}

function writeJson(path: string, value: unknown): void {
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function writeStarterContract(cwd: string, mission: Pick<MissionState, "id" | "goal">): string {
	const path = join(missionDir(cwd, mission.id), "validation-contract.md");
	if (!existsSync(path)) {
		writeFileSync(
			path,
			`# Validation Contract: ${mission.goal}\n\n` +
				"Define correctness before implementation. Validators must judge work against these assertions, not against the worker's intent.\n\n" +
				"## Assertions\n\n" +
				"- [ ] VC-001 — Replace with an externally observable behavior or invariant.\n" +
				"- [ ] VC-002 — Replace with a negative case or failure mode.\n\n" +
				"## Coverage Map\n\n" +
				"Map each feature to the assertions it must satisfy before it can be marked done.\n",
			"utf8",
		);
	}
	return path;
}

function nextAvailableMissionId(cwd: string, goal: string): string {
	let id = createMissionId(goal);
	let counter = 2;
	while (existsSync(missionStatePath(cwd, id))) {
		id = createMissionId(goal, new Date(), `-${counter}`);
		counter += 1;
	}
	return id;
}

export function createMission(cwd: string, goal: string): MissionState {
	const id = nextAvailableMissionId(cwd, goal);
	ensureMissionDirs(cwd, id);
	const createdAt = nowIso();
	const mission: MissionState = {
		id,
		goal,
		status: "draft",
		approved: false,
		createdAt,
		updatedAt: createdAt,
		currentMilestone: 1,
		features: [],
		validations: [],
		handoffs: [],
		contractPath: join(MISSIONS_DIR, id, "validation-contract.md"),
	};
	writeStarterContract(cwd, mission);
	writeJson(missionStatePath(cwd, id), mission);
	writeFileSync(activePath(cwd), `${id}\n`, "utf8");
	return mission;
}

export function listMissionIds(cwd: string): string[] {
	const root = missionsRoot(cwd);
	if (!existsSync(root)) return [];
	return readdirSync(root, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && existsSync(missionStatePath(cwd, entry.name)))
		.map((entry) => entry.name)
		.sort();
}

export function loadMission(cwd: string, id: string): MissionState {
	return JSON.parse(readFileSync(missionStatePath(cwd, id), "utf8")) as MissionState;
}

export function getActiveMissionId(cwd: string): string | undefined {
	const path = activePath(cwd);
	if (existsSync(path)) {
		const id = readFileSync(path, "utf8").trim();
		if (id && existsSync(missionStatePath(cwd, id))) return id;
	}
	const ids = listMissionIds(cwd);
	return ids.at(-1);
}

export function loadActiveMission(cwd: string): MissionState | undefined {
	const id = getActiveMissionId(cwd);
	return id ? loadMission(cwd, id) : undefined;
}

export function saveMission(cwd: string, mission: MissionState): MissionState {
	const updated = { ...mission, updatedAt: nowIso() };
	writeJson(missionStatePath(cwd, mission.id), updated);
	writeFileSync(activePath(cwd), `${mission.id}\n`, "utf8");
	return updated;
}

export function approveMission(cwd: string, mission: MissionState): MissionState {
	const contract = readFileSync(join(cwd, mission.contractPath), "utf8");
	if (contract.includes("Replace with an externally observable behavior or invariant")) {
		throw new Error("Replace the starter validation-contract placeholders before approval");
	}
	return saveMission(cwd, { ...mission, approved: true, status: "approved" });
}

function assertKnownFeature(mission: MissionState, featureId: string): MissionFeature {
	const feature = mission.features.find((candidate) => candidate.id === featureId);
	if (!feature) throw new Error(`Unknown feature: ${featureId}`);
	return feature;
}

function findActiveFeature(mission: MissionState, exceptFeatureId?: string): MissionFeature | undefined {
	return mission.features.find(
		(feature) =>
			feature.id !== exceptFeatureId && (feature.status === "in_progress" || feature.status === "in_validation"),
	);
}

function assertCanActivate(mission: MissionState, featureId: string, status: FeatureStatus): void {
	if (status !== "in_progress" && status !== "in_validation") return;
	const active = findActiveFeature(mission, featureId);
	if (active) throw new Error(`Serial execution gate: ${active.id} is already ${active.status}`);
}

function assertMissionApproved(mission: MissionState): void {
	if (!mission.approved)
		throw new Error("Mission contract is not approved. Replace placeholders, then run /mission-approve.");
}

function assertHandoffExists(mission: MissionState, featureId: string): void {
	if (!mission.handoffs.some((handoff) => handoff.featureId === featureId)) {
		throw new Error(`Handoff required before validation: ${featureId}`);
	}
}

function assertPassedValidationExists(mission: MissionState, featureId: string): void {
	if (!mission.validations.some((validation) => validation.featureId === featureId && validation.status === "pass")) {
		throw new Error(`Passing validation required before marking done: ${featureId}`);
	}
}

export function addFeature(
	cwd: string,
	mission: MissionState,
	input: { title: string; milestone?: number; assertions?: string[]; createdFrom?: string },
): MissionState {
	const id = `F-${String(mission.features.length + 1).padStart(3, "0")}`;
	return saveMission(cwd, {
		...mission,
		status: mission.status === "draft" ? "draft" : "in_progress",
		features: [
			...mission.features,
			{
				id,
				title: input.title,
				status: "pending",
				milestone: input.milestone ?? mission.currentMilestone,
				assertions: input.assertions ?? [],
				createdFrom: input.createdFrom,
			},
		],
	});
}

export function updateFeatureStatus(
	cwd: string,
	mission: MissionState,
	featureId: string,
	status: FeatureStatus,
): MissionState {
	assertKnownFeature(mission, featureId);
	if (status === "in_progress" || status === "in_validation" || status === "done") assertMissionApproved(mission);
	if (status === "in_validation") assertHandoffExists(mission, featureId);
	if (status === "done") assertPassedValidationExists(mission, featureId);
	assertCanActivate(mission, featureId, status);
	const features = mission.features.map((feature) => (feature.id === featureId ? { ...feature, status } : feature));
	return saveMission(cwd, { ...mission, status: status === "blocked" ? "blocked" : mission.status, features });
}

export function writeHandoff(
	cwd: string,
	mission: MissionState,
	input: Omit<MissionHandoff, "id" | "timestamp" | "artifactPath">,
): MissionState {
	assertKnownFeature(mission, input.featureId);
	assertMissionApproved(mission);
	const id = `H-${String(mission.handoffs.length + 1).padStart(3, "0")}`;
	const artifactPath = join(MISSIONS_DIR, mission.id, "handoffs", `${id}-${input.featureId}.json`);
	const handoff: MissionHandoff = { ...input, id, artifactPath, timestamp: nowIso() };
	writeJson(join(cwd, artifactPath), handoff);
	return saveMission(cwd, { ...mission, handoffs: [...mission.handoffs, handoff] });
}

export function recordValidation(
	cwd: string,
	mission: MissionState,
	input: Omit<MissionValidation, "id" | "timestamp" | "artifactPath">,
): MissionState {
	assertKnownFeature(mission, input.featureId);
	assertMissionApproved(mission);
	assertHandoffExists(mission, input.featureId);
	const id = `V-${String(mission.validations.length + 1).padStart(3, "0")}`;
	const artifactPath = join(MISSIONS_DIR, mission.id, "validations", `${id}-${input.featureId}.json`);
	const validation: MissionValidation = { ...input, id, artifactPath, timestamp: nowIso() };
	writeJson(join(cwd, artifactPath), validation);
	const next = saveMission(cwd, { ...mission, validations: [...mission.validations, validation] });
	if (validation.status === "pass") return updateFeatureStatus(cwd, next, validation.featureId, "done");
	return updateFeatureStatus(cwd, next, validation.featureId, "blocked");
}

export function createFollowupsFromFailures(cwd: string, mission: MissionState): MissionState {
	let next = mission;
	for (const validation of mission.validations.filter((v) => v.status !== "pass")) {
		const already = next.features.some((feature) => feature.createdFrom === validation.id);
		if (already) continue;
		next = addFeature(cwd, next, {
			title: `Repair ${validation.featureId}: ${validation.summary.slice(0, 80)}`,
			assertions: validation.failedAssertions,
			createdFrom: validation.id,
		});
	}
	return next;
}

export function formatMissionStatus(mission: MissionState): string {
	const total = mission.features.length;
	const done = mission.features.filter((feature) => feature.status === "done").length;
	const blocked = mission.features.filter((feature) => feature.status === "blocked").length;
	const active = mission.features.find(
		(feature) => feature.status === "in_progress" || feature.status === "in_validation",
	);
	const latestValidation = mission.validations.at(-1);
	return [
		`Mission ${mission.id}`,
		`Goal: ${mission.goal}`,
		`Status: ${mission.status}${mission.approved ? " · approved" : " · draft"}`,
		`Progress: ${done}/${total} features done${blocked ? ` · ${blocked} blocked` : ""}`,
		`Milestone: ${mission.currentMilestone}`,
		`Active: ${active ? `${active.id} — ${active.title} (${active.status})` : "none"}`,
		`Contract: ${mission.contractPath}`,
		`Latest validation: ${latestValidation ? `${latestValidation.id} ${latestValidation.status} — ${latestValidation.summary}` : "none"}`,
	].join("\n");
}

function notify(ctx: CommandContext, msg: string, sev: "info" | "warning" | "error" = "info"): void {
	ctx.ui.notify(msg, sev);
}

function requireActive(ctx: CommandContext): MissionState | undefined {
	const mission = loadActiveMission(ctx.cwd);
	if (!mission) notify(ctx, "No active mission. Run /mission-new <goal> first.", "warning");
	return mission;
}

function isFeatureStatus(value: string): value is FeatureStatus {
	return ["pending", "in_progress", "in_validation", "done", "blocked"].includes(value);
}

function isValidationStatus(value: string): value is ValidationStatus {
	return ["pass", "fail", "needs_followup"].includes(value);
}

function isValidationType(value: string): value is MissionValidation["type"] {
	return ["scrutiny", "user_testing", "manual"].includes(value);
}

function parseFeatureArgs(args: string): { featureId: string; status: FeatureStatus } | undefined {
	const [featureId, status] = args.trim().split(/\s+/);
	if (!featureId || !status) return undefined;
	if (!isFeatureStatus(status)) return undefined;
	return { featureId, status: status as FeatureStatus };
}

export function registerMissionCommands(pi: ExtensionAPI): void {
	pi.registerCommand("mission-new", {
		description: "Create a persistent mission under .pi/missions/ with a validation contract",
		handler: async (args: string, ctx: CommandContext) => {
			const goal = args.trim();
			if (!goal) return notify(ctx, "Usage: /mission-new <goal>", "error");
			const mission = createMission(ctx.cwd, goal);
			notify(
				ctx,
				`${formatMissionStatus(mission)}\n\nNext: run /skill:mission-orchestrator to write the plan and validation contract.`,
			);
		},
	});

	pi.registerCommand("mission-status", {
		description: "Show active mission progress, contract, active feature, and latest validation",
		handler: async (_args: string, ctx: CommandContext) => {
			const mission = requireActive(ctx);
			if (mission) notify(ctx, formatMissionStatus(mission));
		},
	});

	pi.registerCommand("mission-add-feature", {
		description: "Add a feature to the active mission: /mission-add-feature <title>",
		handler: async (args: string, ctx: CommandContext) => {
			const title = args.trim();
			if (!title) return notify(ctx, "Usage: /mission-add-feature <title>", "error");
			const mission = requireActive(ctx);
			if (!mission) return;
			const next = addFeature(ctx.cwd, mission, { title });
			notify(ctx, formatMissionStatus(next));
		},
	});

	pi.registerCommand("mission-feature", {
		description: "Update feature status: /mission-feature F-001 in_progress|in_validation|done|blocked",
		handler: async (args: string, ctx: CommandContext) => {
			const parsed = parseFeatureArgs(args);
			if (!parsed)
				return notify(ctx, "Usage: /mission-feature F-001 in_progress|in_validation|done|blocked", "error");
			const mission = requireActive(ctx);
			if (!mission) return;
			const next = updateFeatureStatus(ctx.cwd, mission, parsed.featureId, parsed.status);
			notify(ctx, formatMissionStatus(next));
		},
	});

	pi.registerCommand("mission-approve", {
		description: "Approve the active mission contract and allow /mission-next to start work",
		handler: async (_args: string, ctx: CommandContext) => {
			const mission = requireActive(ctx);
			if (!mission) return;
			try {
				const next = approveMission(ctx.cwd, mission);
				notify(ctx, formatMissionStatus(next));
			} catch (err) {
				notify(ctx, err instanceof Error ? err.message : String(err), "error");
			}
		},
	});

	pi.registerCommand("mission-next", {
		description: "Mark the next pending mission feature in_progress, unless blocked failures exist",
		handler: async (_args: string, ctx: CommandContext) => {
			const mission = requireActive(ctx);
			if (!mission) return;
			if (!mission.approved)
				return notify(
					ctx,
					"Mission contract is not approved. Replace placeholders, then run /mission-approve.",
					"warning",
				);
			const active = findActiveFeature(mission);
			if (active) return notify(ctx, `Serial execution gate: ${active.id} is already ${active.status}.`, "warning");
			const blocked = mission.features.filter((feature) => feature.status === "blocked");
			const repairFeature = mission.features.find((feature) => feature.status === "pending" && feature.createdFrom);
			const nextFeature =
				blocked.length > 0 ? repairFeature : mission.features.find((feature) => feature.status === "pending");
			if (blocked.length > 0 && !nextFeature)
				return notify(
					ctx,
					`Mission is blocked by: ${blocked.map((f) => f.id).join(", ")}. Run /mission-repair or validate/fix blockers.`,
					"warning",
				);
			if (!nextFeature)
				return notify(ctx, "No pending feature. Add one with /mission-add-feature or run /mission-repair.", "info");
			const next = updateFeatureStatus(ctx.cwd, mission, nextFeature.id, "in_progress");
			notify(ctx, `${formatMissionStatus(next)}\n\nNext: run /skill:mission-worker ${nextFeature.id}`);
		},
	});

	pi.registerCommand("mission-validate", {
		description: "Mark a feature in_validation: /mission-validate F-001",
		handler: async (args: string, ctx: CommandContext) => {
			const featureId = args.trim();
			if (!featureId) return notify(ctx, "Usage: /mission-validate F-001", "error");
			const mission = requireActive(ctx);
			if (!mission) return;
			if (!mission.handoffs.some((handoff) => handoff.featureId === featureId)) {
				return notify(ctx, `Handoff required before validation: ${featureId}`, "warning");
			}
			const next = updateFeatureStatus(ctx.cwd, mission, featureId, "in_validation");
			notify(
				ctx,
				`${formatMissionStatus(next)}\n\nNext: run /skill:mission-validator ${featureId} and optionally /skill:mission-user-testing-validator ${featureId}`,
			);
		},
	});

	pi.registerCommand("mission-repair", {
		description: "Create corrective follow-up features from failed validations",
		handler: async (_args: string, ctx: CommandContext) => {
			const mission = requireActive(ctx);
			if (!mission) return;
			const next = createFollowupsFromFailures(ctx.cwd, mission);
			notify(ctx, formatMissionStatus(next));
		},
	});
}

const MissionToolParams = Type.Object({
	action: Type.Union([
		Type.Literal("get"),
		Type.Literal("create"),
		Type.Literal("add_feature"),
		Type.Literal("update_feature"),
		Type.Literal("write_handoff"),
		Type.Literal("record_validation"),
		Type.Literal("create_followups"),
	]),
	goal: Type.Optional(Type.String()),
	featureId: Type.Optional(Type.String()),
	title: Type.Optional(Type.String()),
	status: Type.Optional(
		Type.Union([
			Type.Literal("pending"),
			Type.Literal("in_progress"),
			Type.Literal("in_validation"),
			Type.Literal("done"),
			Type.Literal("blocked"),
		]),
	),
	validationType: Type.Optional(
		Type.Union([Type.Literal("scrutiny"), Type.Literal("user_testing"), Type.Literal("manual")]),
	),
	validationStatus: Type.Optional(
		Type.Union([Type.Literal("pass"), Type.Literal("fail"), Type.Literal("needs_followup")]),
	),
	summary: Type.Optional(Type.String()),
	assertions: Type.Optional(Type.Array(Type.String())),
	completed: Type.Optional(Type.Array(Type.String())),
	leftUndone: Type.Optional(Type.Array(Type.String())),
	issues: Type.Optional(Type.Array(Type.String())),
	commands: Type.Optional(Type.Array(Type.Object({ command: Type.String(), exitCode: Type.Optional(Type.Number()) }))),
});

function textResult(text: string, details: unknown = {}) {
	return { content: [{ type: "text" as const, text }], details };
}

export function registerMissionTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "mission_state",
		label: "Mission State",
		description:
			"Read and update persistent Pi mission state. Use this for long-running work that needs validation contracts, serial features, mandatory handoffs, separate validation, and corrective follow-up features.",
		promptSnippet:
			"Use `mission_state` when working inside a mission to read state, record handoffs, record validation, and create corrective follow-up features.",
		promptGuidelines: [
			"Before implementing mission work, read the active mission and validation contract.",
			"Write a handoff after each worker feature with commands and exit codes.",
			"Record validator results separately from worker implementation; failed validations should create follow-up features instead of being ignored.",
		],
		parameters: MissionToolParams,
		async execute(_toolCallId, params: Record<string, unknown>, _signal, _onUpdate, ctx: { cwd: string }) {
			const action = String(params.action ?? "get");
			if (action === "create") {
				const goal = String(params.goal ?? "").trim();
				if (!goal) throw new Error("goal is required for create");
				const mission = createMission(ctx.cwd, goal);
				return textResult(formatMissionStatus(mission), mission);
			}
			const mission = loadActiveMission(ctx.cwd);
			if (!mission) return textResult("No active mission. Create one first with action=create or /mission-new.");
			if (action === "get") return textResult(formatMissionStatus(mission), mission);
			if (action === "add_feature") {
				const title = String(params.title ?? "").trim();
				if (!title) throw new Error("title is required for add_feature");
				const next = addFeature(ctx.cwd, mission, {
					title,
					assertions: (params.assertions as string[] | undefined) ?? [],
				});
				return textResult(formatMissionStatus(next), next);
			}
			if (action === "update_feature") {
				const status = String(params.status);
				if (!isFeatureStatus(status)) throw new Error(`Invalid feature status: ${status}`);
				const next = updateFeatureStatus(ctx.cwd, mission, String(params.featureId), status);
				return textResult(formatMissionStatus(next), next);
			}
			if (action === "write_handoff") {
				const next = writeHandoff(ctx.cwd, mission, {
					featureId: String(params.featureId),
					completed: (params.completed as string[] | undefined) ?? [],
					leftUndone: (params.leftUndone as string[] | undefined) ?? [],
					commands: ((params.commands as Array<{ command: string; exitCode?: number }> | undefined) ?? []).map(
						(cmd) => ({ command: cmd.command, exitCode: cmd.exitCode ?? null }),
					),
					issues: (params.issues as string[] | undefined) ?? [],
					assertionsCovered: (params.assertions as string[] | undefined) ?? [],
				});
				return textResult(formatMissionStatus(next), next);
			}
			if (action === "record_validation") {
				const validationType = String(params.validationType ?? "manual");
				const validationStatus = String(params.validationStatus ?? "fail");
				if (!isValidationType(validationType)) throw new Error(`Invalid validation type: ${validationType}`);
				if (!isValidationStatus(validationStatus))
					throw new Error(`Invalid validation status: ${validationStatus}`);
				const next = recordValidation(ctx.cwd, mission, {
					featureId: String(params.featureId),
					type: validationType,
					status: validationStatus,
					summary: String(params.summary ?? ""),
					failedAssertions: (params.assertions as string[] | undefined) ?? [],
				});
				return textResult(formatMissionStatus(next), next);
			}
			if (action === "create_followups") {
				const next = createFollowupsFromFailures(ctx.cwd, mission);
				return textResult(formatMissionStatus(next), next);
			}
			throw new Error(`Unknown mission_state action: ${action}`);
		},
	});
}
