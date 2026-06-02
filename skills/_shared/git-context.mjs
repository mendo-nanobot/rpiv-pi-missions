// Print six labeled lines summarising the current cwd's git state.
// Always exits 0 — every failure path collapses to a stable fallback so the
// skill body never receives a `[Shell error: ...]` substitution.
//
//   branch: <name>|no-branch
//   commit: <short-sha>|no-commit
//   repo:   <basename of toplevel>|unknown
//   root:   <absolute toplevel path>|(empty)
//   in_repo: yes|no
//   author: <git config user.name>|unknown
import { execFileSync } from "node:child_process";
import { basename } from "node:path";

const safe = (args, fb) => {
	try {
		const out = execFileSync("git", args, {
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		return out || fb;
	} catch {
		return fb;
	}
};

const root = safe(["rev-parse", "--show-toplevel"], "");
process.stdout.write(
	[
		`branch: ${safe(["branch", "--show-current"], "no-branch")}`,
		`commit: ${safe(["rev-parse", "--short", "HEAD"], "no-commit")}`,
		`repo: ${root ? basename(root) : "unknown"}`,
		`root: ${root}`,
		`in_repo: ${root ? "yes" : "no"}`,
		`author: ${safe(["config", "user.name"], "unknown")}`,
		"",
	].join("\n"),
);
