import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const LIST_RECENT_MJS = fileURLToPath(new URL("./list-recent.mjs", import.meta.url));

const run = (cwd: string, ...argv: string[]) =>
	execFileSync("node", [LIST_RECENT_MJS, ...argv], {
		cwd,
		encoding: "utf-8",
		stdio: ["ignore", "pipe", "ignore"],
	});

const touch = (path: string, mtimeSec: number) => {
	writeFileSync(path, "");
	utimesSync(path, mtimeSec, mtimeSec);
};

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "rpiv-list-recent-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("list-recent.mjs", () => {
	it("returns files sorted by mtime descending (newest first)", () => {
		touch(join(dir, "old.md"), 1_000_000_000);
		touch(join(dir, "mid.md"), 1_000_000_500);
		touch(join(dir, "new.md"), 1_000_001_000);
		const out = run(dir, dir, "10");
		expect(out.trim().split("\n")).toEqual(["new.md", "mid.md", "old.md"]);
	});

	it("caps output at N entries", () => {
		for (let i = 0; i < 5; i++) touch(join(dir, `f${i}.md`), 1_000_000_000 + i);
		const out = run(dir, dir, "3");
		expect(out.trim().split("\n")).toHaveLength(3);
	});

	it("emits nothing for a missing directory (exit 0)", () => {
		const missing = join(dir, "does-not-exist");
		const out = run(dir, missing, "10");
		expect(out).toBe("");
	});

	it("emits nothing for an empty directory (exit 0)", () => {
		const out = run(dir, dir, "10");
		expect(out).toBe("");
	});

	it("skips subdirectories (files only)", () => {
		touch(join(dir, "real.md"), 1_000_000_000);
		execFileSync("mkdir", [join(dir, "sub")]);
		const out = run(dir, dir, "10");
		expect(out.trim().split("\n")).toEqual(["real.md"]);
	});

	it("defaults count to 10 when not provided", () => {
		for (let i = 0; i < 15; i++) touch(join(dir, `f${i}.md`), 1_000_000_000 + i);
		const out = run(dir, dir);
		expect(out.trim().split("\n")).toHaveLength(10);
	});

	it("clamps count to ≥1 when given 0 or negative", () => {
		touch(join(dir, "only.md"), 1_000_000_000);
		const out = run(dir, dir, "0");
		// Math.max(1, ...) — 0 becomes 1, so we get the single newest file.
		expect(out.trim().split("\n")).toEqual(["only.md"]);
	});
});
