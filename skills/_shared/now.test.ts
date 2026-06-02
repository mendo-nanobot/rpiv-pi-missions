import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const NOW_MJS = fileURLToPath(new URL("./now.mjs", import.meta.url));

const runNow = () => execFileSync("node", [NOW_MJS], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });

describe("now.mjs", () => {
	it("emits exactly one tab-separated line: <iso>\\t<slug>", () => {
		const out = runNow();
		// Single line, no leading/trailing newline — every consumer in the
		// skill set concatenates `echo` or `git-context.mjs` output directly
		// after this. A trailing \n would still parse, but a trailing space or
		// extra tab would silently corrupt the slug-based filename.
		expect(out).not.toContain("\n");
		const [iso, slug, ...rest] = out.split("\t");
		expect(rest).toHaveLength(0);
		expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{4}$/);
		expect(slug).toMatch(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/);
	});

	it("slug is derived from iso: T→_, :→-, first 19 chars", () => {
		const out = runNow();
		const [iso, slug] = out.split("\t");
		expect(slug).toBe(iso.slice(0, 19).replaceAll(":", "-").replace("T", "_"));
	});

	it("no trailing newline (contract that revise/SKILL.md's `echo` separator depends on)", () => {
		const out = runNow();
		// If this assertion ever flips, every Metadata block that combines
		// now.mjs with a second helper via `echo` will have a blank line
		// inserted between them — harmless — but the explicit no-`echo` peer
		// (none currently exist after the I1 fix) would now parse cleanly.
		// Keep this contract pinned so revise/SKILL.md's `echo` line is
		// load-bearing as documented.
		expect(out.endsWith("\n")).toBe(false);
		expect(out.endsWith("\t")).toBe(false);
	});

	it("iso timezone offset is exactly +HHMM or -HHMM (no colon, no Z)", () => {
		const out = runNow();
		const [iso] = out.split("\t");
		expect(iso).toMatch(/[+-]\d{4}$/);
		expect(iso.endsWith("Z")).toBe(false);
		expect(iso).not.toMatch(/[+-]\d{2}:\d{2}$/);
	});
});
