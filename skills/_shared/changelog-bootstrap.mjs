// Pre-bake the bail-out checks and reference values for the changelog skill.
//
// Prints:
//   in_repo: yes|no
//   last_tag: <tag>|(no tags)
//   ---changelogs---
//   <one CHANGELOG.md path per line>     (empty if none tracked)
//
// All values are bounded. The unbounded `git log` and `git diff` calls
// remain LLM-issued via Bash (their output can exceed the 50KB tail budget).
//
// Always exits 0 — non-repo cwd collapses to `in_repo: no` and empty sections.
import { execFileSync } from "node:child_process";

const safe = (args, fb) => {
	try {
		return execFileSync("git", args, {
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "ignore"],
		});
	} catch {
		return fb;
	}
};

const root = safe(["rev-parse", "--show-toplevel"], "").trim();
const inRepo = root ? "yes" : "no";

process.stdout.write(`in_repo: ${inRepo}\n`);

if (!root) {
	process.stdout.write("last_tag: (not in a git repo)\n");
	process.stdout.write("---changelogs---\n");
	process.exit(0);
}

const lastTag = safe(["describe", "--tags", "--abbrev=0"], "").trim();
process.stdout.write(`last_tag: ${lastTag || "(no tags)"}\n`);

const changelogs = safe(["ls-files", "CHANGELOG.md", "**/CHANGELOG.md"], "");
process.stdout.write("---changelogs---\n");
process.stdout.write(changelogs);
