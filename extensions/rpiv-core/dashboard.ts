import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type {
	FeatureStatus,
	MissionFeature,
	MissionHandoff,
	MissionState,
	MissionStatus,
	MissionValidation,
} from "./missions.js";
import { getActiveMissionId, listMissionIds, loadMission } from "./missions.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DashboardStage = "draft" | "planning" | "implementation" | "handoff" | "validation" | "repair" | "done";

export type ExpectedInput = {
	stage: DashboardStage;
	description: string;
	commands: string[];
};

export type FeatureSummary = {
	id: string;
	title: string;
	status: FeatureStatus;
	milestone: number;
	assertions: string[];
	isRepair: boolean;
};

export type MissionProgress = {
	total: number;
	done: number;
	blocked: number;
	inProgress: number;
	inValidation: number;
	pending: number;
	percent: number;
};

export type MissionDashboardData = {
	id: string;
	goal: string;
	status: MissionStatus;
	approved: boolean;
	stage: DashboardStage;
	expectedInput: ExpectedInput;
	progress: MissionProgress;
	activeFeature: FeatureSummary | null;
	blockers: FeatureSummary[];
	features: FeatureSummary[];
	latestValidation: MissionValidation | null;
	latestHandoff: MissionHandoff | null;
	contractPath: string;
	createdAt: string;
	updatedAt: string;
};

export type MissionSummary = Pick<MissionDashboardData, "id" | "goal" | "status" | "approved" | "stage" | "progress">;

export type AllMissionsDashboardData = {
	missions: MissionSummary[];
	activeMissionId: string | undefined;
};

// ---------------------------------------------------------------------------
// Stage derivation
// ---------------------------------------------------------------------------

export function deriveMissionStage(mission: MissionState): DashboardStage {
	const { features, validations, handoffs } = mission;

	// All features complete
	if (features.length > 0 && features.every((f) => f.status === "done")) return "done";

	// Feature awaiting validator review
	if (features.some((f) => f.status === "in_validation")) return "validation";

	// Feature being implemented by worker
	const activeFeature = features.find((f) => f.status === "in_progress");
	if (activeFeature) {
		const hasHandoff = handoffs.some((h) => h.featureId === activeFeature.id);
		return hasHandoff ? "handoff" : "implementation";
	}

	// Blocked features — check whether repair followups have been created
	const blockedFeatures = features.filter((f) => f.status === "blocked");
	if (blockedFeatures.length > 0) {
		const allHaveRepair = blockedFeatures.every((bf) => {
			const failedValidation = validations.find((v) => v.featureId === bf.id && v.status !== "pass");
			return failedValidation && features.some((f) => f.createdFrom === failedValidation.id);
		});
		// Repair features created but not started → back to planning
		return allHaveRepair ? "planning" : "repair";
	}

	// Not yet approved
	if (!mission.approved) return "draft";

	// Approved, pending features (or no features yet)
	return "planning";
}

// ---------------------------------------------------------------------------
// Expected input computation
// ---------------------------------------------------------------------------

export function computeExpectedInput(mission: MissionState, stage: DashboardStage): ExpectedInput {
	const activeFeature = mission.features.find((f) => f.status === "in_progress" || f.status === "in_validation");
	const featureId = activeFeature?.id ?? "F-xxx";

	switch (stage) {
		case "draft":
			return {
				stage,
				description:
					"Edit validation-contract.md to replace starter placeholders with real assertions (VC-xxx), then approve the contract.",
				commands: ["/skill:mission-orchestrator", "/mission-approve"],
			};
		case "planning": {
			const noFeatures = mission.features.length === 0;
			return {
				stage,
				description: noFeatures
					? "No features planned yet. Use the orchestrator to plan the mission, then start the first feature."
					: "Features are planned. Start the next pending feature.",
				commands: noFeatures
					? ["/skill:mission-orchestrator", "/mission-add-feature <title>", "/mission-next"]
					: ["/mission-next"],
			};
		}
		case "implementation":
			return {
				stage,
				description: `Feature ${featureId} is in progress. Run the worker skill to implement it and write a handoff.`,
				commands: [`/skill:mission-worker ${featureId}`],
			};
		case "handoff":
			return {
				stage,
				description: `Worker wrote handoff for ${featureId}. Move it to validation to start the validator.`,
				commands: [`/mission-validate ${featureId}`],
			};
		case "validation":
			return {
				stage,
				description: `Feature ${featureId} is ready for validation. Run scrutiny and optionally user-testing validators.`,
				commands: [`/skill:mission-validator ${featureId}`, `/skill:mission-user-testing-validator ${featureId}`],
			};
		case "repair":
			return {
				stage,
				description:
					"Blocked features need corrective follow-up features. Run repair to create them, then start the next feature.",
				commands: ["/mission-repair", "/mission-next"],
			};
		case "done":
			return {
				stage,
				description: "All features are done. Mission is complete.",
				commands: [],
			};
	}
}

// ---------------------------------------------------------------------------
// Dashboard data builders (pure, exported for tests)
// ---------------------------------------------------------------------------

export function buildMissionDashboardData(_cwd: string, mission: MissionState): MissionDashboardData {
	const stage = deriveMissionStage(mission);
	const expectedInput = computeExpectedInput(mission, stage);

	const { features } = mission;
	const total = features.length;
	const done = features.filter((f) => f.status === "done").length;
	const blocked = features.filter((f) => f.status === "blocked").length;
	const inProgress = features.filter((f) => f.status === "in_progress").length;
	const inValidation = features.filter((f) => f.status === "in_validation").length;
	const pending = features.filter((f) => f.status === "pending").length;
	const percent = total > 0 ? Math.round((done / total) * 100) : 0;

	const toSummary = (f: MissionFeature): FeatureSummary => ({
		id: f.id,
		title: f.title,
		status: f.status,
		milestone: f.milestone,
		assertions: f.assertions,
		isRepair: !!f.createdFrom,
	});

	const activeFeatureRaw = features.find((f) => f.status === "in_progress" || f.status === "in_validation");

	return {
		id: mission.id,
		goal: mission.goal,
		status: mission.status,
		approved: mission.approved,
		stage,
		expectedInput,
		progress: { total, done, blocked, inProgress, inValidation, pending, percent },
		activeFeature: activeFeatureRaw ? toSummary(activeFeatureRaw) : null,
		blockers: features.filter((f) => f.status === "blocked").map(toSummary),
		features: features.map(toSummary),
		latestValidation: mission.validations.at(-1) ?? null,
		latestHandoff: mission.handoffs.at(-1) ?? null,
		contractPath: mission.contractPath,
		createdAt: mission.createdAt,
		updatedAt: mission.updatedAt,
	};
}

export function buildAllMissionsDashboardData(cwd: string): AllMissionsDashboardData {
	const ids = listMissionIds(cwd);
	const activeMissionId = getActiveMissionId(cwd);
	const missions: MissionSummary[] = ids.map((id) => {
		const mission = loadMission(cwd, id);
		const { id: mId, goal, status, approved, stage, progress } = buildMissionDashboardData(cwd, mission);
		return { id: mId, goal, status, approved, stage, progress };
	});
	return { missions, activeMissionId };
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

type RunningServer = { server: Server; port: number };

const _servers = new Map<string, RunningServer>();

export function startDashboardServer(cwd: string, port: number): Promise<number> {
	const existing = _servers.get(cwd);
	if (existing) {
		return Promise.reject(
			new Error(`Dashboard already running on port ${existing.port}. Run /mission-dashboard-stop first.`),
		);
	}

	return new Promise((resolve, reject) => {
		const server = createServer((req: IncomingMessage, res: ServerResponse) => {
			handleRequest(req, res, cwd);
		});

		server.on("error", (err: Error) => {
			_servers.delete(cwd);
			reject(err);
		});

		server.listen(port, "127.0.0.1", () => {
			const addr = server.address();
			const actualPort = typeof addr === "object" && addr !== null ? addr.port : port;
			_servers.set(cwd, { server, port: actualPort });
			resolve(actualPort);
		});
	});
}

export function stopDashboardServer(cwd: string): Promise<void> {
	const running = _servers.get(cwd);
	if (!running) return Promise.reject(new Error("No dashboard server is running."));
	return new Promise((resolve, reject) => {
		running.server.close((err) => {
			_servers.delete(cwd);
			if (err) reject(err);
			else resolve();
		});
	});
}

export function getDashboardPort(cwd: string): number | undefined {
	return _servers.get(cwd)?.port;
}

// ---------------------------------------------------------------------------
// HTTP request handler
// ---------------------------------------------------------------------------

const DASHBOARD_HTML_PATH = join(dirname(fileURLToPath(import.meta.url)), "dashboard.html");

let _cachedHtml: string | undefined;

function getDashboardHtml(): string {
	if (!_cachedHtml) {
		_cachedHtml = readFileSync(DASHBOARD_HTML_PATH, "utf8");
	}
	return _cachedHtml;
}

function jsonResponse(res: ServerResponse, data: unknown, status = 200): void {
	const body = JSON.stringify(data, null, 2);
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Cache-Control": "no-store",
		"X-Content-Type-Options": "nosniff",
	});
	res.end(body);
}

function handleRequest(req: IncomingMessage, res: ServerResponse, cwd: string): void {
	const url = req.url ?? "/";
	const method = (req.method ?? "GET").toUpperCase();

	if (method !== "GET" && method !== "HEAD") {
		res.writeHead(405, { Allow: "GET, HEAD" });
		res.end();
		return;
	}

	if (url === "/" || url === "/index.html") {
		try {
			const html = getDashboardHtml();
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
			res.end(html);
		} catch (err) {
			jsonResponse(res, { error: String(err) }, 500);
		}
		return;
	}

	if (url === "/api/missions") {
		try {
			jsonResponse(res, buildAllMissionsDashboardData(cwd));
		} catch (err) {
			jsonResponse(res, { error: String(err) }, 500);
		}
		return;
	}

	if (url === "/api/missions/active") {
		try {
			const id = getActiveMissionId(cwd);
			if (!id) {
				jsonResponse(res, { error: "No active mission" }, 404);
				return;
			}
			const mission = loadMission(cwd, id);
			jsonResponse(res, buildMissionDashboardData(cwd, mission));
		} catch (err) {
			jsonResponse(res, { error: String(err) }, 500);
		}
		return;
	}

	const contractMatch = url.match(/^\/api\/missions\/([^/]+)\/contract$/);
	if (contractMatch) {
		try {
			const id = decodeURIComponent(contractMatch[1]);
			const mission = loadMission(cwd, id);
			const contractAbsPath = join(cwd, mission.contractPath);
			if (!existsSync(contractAbsPath)) {
				jsonResponse(res, { error: "Contract not found" }, 404);
				return;
			}
			const content = readFileSync(contractAbsPath, "utf8");
			res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "no-store" });
			res.end(content);
		} catch (err) {
			jsonResponse(res, { error: String(err) }, 500);
		}
		return;
	}

	const missionMatch = url.match(/^\/api\/missions\/([^/]+)$/);
	if (missionMatch) {
		try {
			const id = decodeURIComponent(missionMatch[1]);
			const mission = loadMission(cwd, id);
			jsonResponse(res, buildMissionDashboardData(cwd, mission));
		} catch (err) {
			jsonResponse(res, { error: String(err) }, 404);
		}
		return;
	}

	jsonResponse(res, { error: "Not found" }, 404);
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

type CommandContext = {
	cwd: string;
	ui: { notify: (msg: string, sev: "info" | "warning" | "error") => void };
};

export function registerDashboardCommands(pi: ExtensionAPI): void {
	pi.registerCommand("mission-dashboard", {
		description: "Start a local read-only mission dashboard: /mission-dashboard [port] (default 4317)",
		handler: async (args: string, ctx: CommandContext) => {
			const portArg = args.trim();
			const port = portArg ? parseInt(portArg, 10) : 4317;
			if (Number.isNaN(port) || port < 1 || port > 65535) {
				ctx.ui.notify(`Invalid port: "${portArg}". Use a number between 1 and 65535.`, "error");
				return;
			}
			try {
				const actualPort = await startDashboardServer(ctx.cwd, port);
				ctx.ui.notify(
					`Mission dashboard running at http://127.0.0.1:${actualPort} — open in browser. Stop with /mission-dashboard-stop.`,
					"info",
				);
			} catch (err) {
				ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
			}
		},
	});

	pi.registerCommand("mission-dashboard-stop", {
		description: "Stop the local mission dashboard server",
		handler: async (_args: string, ctx: CommandContext) => {
			try {
				await stopDashboardServer(ctx.cwd);
				ctx.ui.notify("Mission dashboard stopped.", "info");
			} catch (err) {
				ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
			}
		},
	});
}
