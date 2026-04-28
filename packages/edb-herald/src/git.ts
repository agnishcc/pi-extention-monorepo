import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { HeraldMode } from "./types";

// ── Git helpers ────────────────────────────────────────────────────────────────

export async function git(pi: ExtensionAPI, args: string[], _cwd: string): Promise<string> {
	try {
		const result = await pi.exec("git", args, { timeout: 10000 });
		return result.stdout.trim();
	} catch {
		return "";
	}
}

export async function isGitRepo(pi: ExtensionAPI, _cwd: string): Promise<boolean> {
	const result = await pi.exec("git", ["rev-parse", "--git-dir"], { timeout: 5000 }).catch(() => null);
	return result !== null && result.code === 0;
}

// ── Task builder ───────────────────────────────────────────────────────────────

export function parseMode(args: string): HeraldMode {
	const a = args.trim().toLowerCase();
	if (a === "commit") return "commit";
	if (a === "pr") return "pr";
	return "both";
}

export function truncate(text: string, maxLen: number): string {
	if (text.length <= maxLen) return text;
	return `${text.slice(0, maxLen)}\n\n... [truncated — ${text.length - maxLen} additional characters omitted]`;
}

export async function buildTask(pi: ExtensionAPI, mode: HeraldMode, cwd: string): Promise<string> {
	// Gather git context in parallel
	const [status, staged, unstaged, log, branch] = await Promise.all([
		git(pi, ["status", "--short"], cwd),
		git(pi, ["diff", "--cached"], cwd),
		git(pi, ["diff"], cwd),
		git(pi, ["log", "--oneline", "-15"], cwd),
		git(pi, ["branch", "--show-current"], cwd),
	]);

	// Mode instruction
	const modeNote: Record<HeraldMode, string> = {
		commit: "**Mode: commit only.** Perform Steps 1–5. Do NOT push or create a PR.",
		pr: "**Mode: PR only.** Perform Steps 6–7. The commits are already done.",
		both: "**Mode: full flow.** Complete all steps 1–7.",
	};

	// Build diff section
	let diffSection: string;
	if (mode === "pr") {
		const [mainExists, masterExists] = await Promise.all([
			git(pi, ["rev-parse", "--verify", "origin/main"], cwd),
			git(pi, ["rev-parse", "--verify", "origin/master"], cwd),
		]);
		const base = mainExists ? "origin/main" : masterExists ? "origin/master" : "main";
		const prDiff = await git(pi, ["diff", `${base}...HEAD`], cwd);
		diffSection = prDiff
			? `## Diff vs \`${base}\`\n\`\`\`diff\n${truncate(prDiff, 14000)}\n\`\`\``
			: `## Diff vs base\n(no diff found against \`${base}\` — base branch may not exist locally)`;
	} else {
		const parts: string[] = [];
		if (staged) parts.push(`### Staged\n\`\`\`diff\n${truncate(staged, 8000)}\n\`\`\``);
		if (unstaged) parts.push(`### Unstaged\n\`\`\`diff\n${truncate(unstaged, 8000)}\n\`\`\``);
		diffSection =
			parts.length > 0
				? `## Changes\n\n${parts.join("\n\n")}`
				: `## Changes\n\n(no changes detected — working tree is clean)`;
	}

	const lines: string[] = [
		`## Herald — ${mode} mode`,
		"",
		modeNote[mode],
		"",
		`## Branch`,
		`\`${branch || "(unknown)"}\``,
		"",
		`## Git Status`,
		"```",
		status || "(clean)",
		"```",
		"",
		diffSection,
		"",
		`## Recent Commits`,
		"```",
		log || "(no commits yet)",
		"```",
		"",
		"---",
		"",
		"If `final-plan.md` exists anywhere in this repository " +
			"(check `./final-plan.md` or `./plans/*/final-plan.md`), read it before proceeding.",
		"",
		"Begin.",
	];

	return lines.join("\n");
}
