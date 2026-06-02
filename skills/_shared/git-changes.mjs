// Pre-bake the "what's changed" snapshot for the commit skill.
//
// Prints:
//   in_repo: yes|no
//   ---status---
//   <git status --short>            (capped at 200 lines + footer)
//   ---diffstat---
//   <git diff HEAD --stat --ignore-submodules=all>  | fallback for no-HEAD
//
// Full `git diff` is deliberately NOT included — large diffs would push the
// 50KB / 2000-line tail-truncation budget. The commit skill issues
// `git diff <file>` via the Bash tool when it needs per-file detail.
//
// Always exits 0 — non-repo cwd or no-HEAD initial repo collapses to safe
// fallback strings so the skill body never receives a `[Shell error: ...]`.
import { execFileSync } from "node:child_process";

const LINE_CAP = 200;

const safe = (args, fb) => {
	try {
		return execFileSync("git", args, {
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	} catch {
		return fb;
	}
};

// Emit `raw` line-capped at LINE_CAP, with a truncation footer when over-limit.
// Empty input → `emptyLabel`. Both the status and diffstat sections are
// line-per-file in shape, so the "more files truncated" footer matches the
// convention in code-review/_helpers/review-range.mjs.
const emitCapped = (raw, emptyLabel) => {
	const lines = raw.split("\n");
	const trailingEmpty = lines.length > 0 && lines.at(-1) === "";
	const real = trailingEmpty ? lines.slice(0, -1) : lines;
	if (real.length === 0 || (real.length === 1 && real[0] === "")) {
		process.stdout.write(`${emptyLabel}\n`);
	} else if (real.length > LINE_CAP) {
		process.stdout.write(real.slice(0, LINE_CAP).join("\n"));
		process.stdout.write(`\n(... ${real.length - LINE_CAP} more files truncated ...)\n`);
	} else {
		process.stdout.write(`${real.join("\n")}\n`);
	}
};

const root = safe(["rev-parse", "--show-toplevel"], "");
const inRepo = root ? "yes" : "no";

process.stdout.write(`in_repo: ${inRepo}\n`);

if (!root) {
	process.exit(0);
}

process.stdout.write("---status---\n");
emitCapped(safe(["status", "--short"], ""), "(working tree clean)");

// `git diff HEAD --stat` errors on a fresh repo with no commits — substitute
// a fallback marker so the LLM knows the status block above already covers
// what would land in the initial commit.
const hasHead = safe(["rev-parse", "--verify", "--quiet", "HEAD"], "") !== "";
process.stdout.write("---diffstat---\n");
if (!hasHead) {
	process.stdout.write("(no HEAD yet — initial commit; status above lists all files to be added)\n");
} else {
	emitCapped(safe(["diff", "HEAD", "--stat", "--ignore-submodules=all"], ""), "(no changes against HEAD)");
}
