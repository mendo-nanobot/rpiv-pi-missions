// List N most recently modified files in a directory, newest first, one per line.
// Usage: node list-recent.mjs <dir> [count=10]
//   <dir>   — relative paths are resolved against the git root (or cwd if not in a repo).
//   <count> — max entries to print (default 10).
// Empty stdout when the directory does not exist or contains no files.
// Always exits 0 — directory-missing is a recoverable state, not an error.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

const [rawDir = ".", nStr = "10"] = process.argv.slice(2);
const n = Math.max(1, Number.parseInt(nStr, 10) || 10);

const gitRoot = (() => {
	try {
		return execFileSync("git", ["rev-parse", "--show-toplevel"], {
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	} catch {
		return "";
	}
})();

const dir = isAbsolute(rawDir) ? rawDir : resolve(gitRoot || process.cwd(), rawDir);

if (!existsSync(dir)) process.exit(0);

const items = readdirSync(dir, { withFileTypes: true })
	.filter((d) => d.isFile())
	.map((d) => ({ name: d.name, mtime: statSync(join(dir, d.name)).mtimeMs }))
	.sort((a, b) => b.mtime - a.mtime)
	.slice(0, n);

for (const it of items) console.log(it.name);
