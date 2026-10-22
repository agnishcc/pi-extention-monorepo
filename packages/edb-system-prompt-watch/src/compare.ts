import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { generateUnifiedPatch, getAgentDir, VERSION } from "@earendil-works/pi-coding-agent";
import { findPromptSourcePath, resolvePiPackageDir } from "./state";

export interface ChangedPromptItem {
	defaultItem: string;
	activeItem: string;
	similarity: number;
}

export interface PromptComparisonResult {
	isIdentical: boolean;
	piVersion: string;
	promptSourcePath: string;
	activePrompt: string;
	defaultPrompt: string;
	missingFromActive: string[];
	modifiedOrChanged: ChangedPromptItem[];
	uniqueToActive: string[];
	unifiedDiff: string;
	formattedSummary: string;
}

/**
 * Extracts bullet points and guideline lines from a prompt string.
 */
export function extractBulletPoints(text: string): string[] {
	const lines = text.split("\n");
	const items: string[] = [];
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
			items.push(trimmed.slice(2).trim());
		}
	}
	return items;
}

/**
 * Computes Jaccard word similarity between two strings (0.0 to 1.0).
 */
export function calculateSimilarity(a: string, b: string): number {
	const wordsA = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
	const wordsB = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
	if (wordsA.size === 0 || wordsB.size === 0) return 0;

	let intersection = 0;
	for (const word of wordsA) {
		if (wordsB.has(word)) intersection++;
	}
	const union = new Set([...wordsA, ...wordsB]).size;
	return union === 0 ? 0 : intersection / union;
}

/**
 * Retrieves the custom SYSTEM.md file content if active prompt is not available from context.
 */
export function readFallbackSystemPrompt(cwd = process.cwd()): string {
	const agentCustom = join(getAgentDir(), "SYSTEM.md");
	if (existsSync(agentCustom)) {
		try {
			return readFileSync(agentCustom, "utf8");
		} catch {
			// Ignore read error
		}
	}

	const projectCustom = join(cwd, ".pi", "SYSTEM.md");
	if (existsSync(projectCustom)) {
		try {
			return readFileSync(projectCustom, "utf8");
		} catch {
			// Ignore read error
		}
	}

	return "";
}

/**
 * Retrieves the bundled default system prompt from the installed Pi package.
 */
export async function getBundledDefaultPrompt(
	packageDir?: string,
	cwd = process.cwd(),
): Promise<{ prompt: string; sourcePath: string; version: string }> {
	const resolvedPkgDir = packageDir ?? (await resolvePiPackageDir());
	const sourcePath = findPromptSourcePath(resolvedPkgDir);

	try {
		const fileUrl = pathToFileURL(sourcePath).href;
		const mod = (await import(fileUrl)) as { buildSystemPrompt?: (opts: { cwd: string }) => string };
		if (typeof mod.buildSystemPrompt === "function") {
			const prompt = mod.buildSystemPrompt({ cwd });
			return { prompt, sourcePath, version: VERSION };
		}
	} catch {
		// Fallback to reading file directly if dynamic import fails
	}

	const rawContent = readFileSync(sourcePath, "utf8");
	return { prompt: rawContent, sourcePath, version: VERSION };
}

/**
 * Compares the active system prompt against Pi's bundled default system prompt.
 */
export function comparePrompts(
	activePrompt: string,
	defaultPrompt: string,
	meta?: { piVersion?: string; promptSourcePath?: string },
): PromptComparisonResult {
	const piVersion = meta?.piVersion ?? VERSION;
	const promptSourcePath = meta?.promptSourcePath ?? "bundled default";

	const normalizedActive = activePrompt.trim();
	const normalizedDefault = defaultPrompt.trim();

	const isIdentical = normalizedActive === normalizedDefault;

	const activeBullets = extractBulletPoints(activePrompt);
	const defaultBullets = extractBulletPoints(defaultPrompt);

	const missingFromActive: string[] = [];
	const modifiedOrChanged: ChangedPromptItem[] = [];
	const matchedActiveIndices = new Set<number>();

	for (const defItem of defaultBullets) {
		const exactIndex = activeBullets.findIndex(
			(actItem, idx) => !matchedActiveIndices.has(idx) && actItem === defItem,
		);

		if (exactIndex !== -1) {
			matchedActiveIndices.add(exactIndex);
			continue;
		}

		// Find closest partial / similar match
		let bestSim = 0;
		let bestIdx = -1;

		for (let i = 0; i < activeBullets.length; i++) {
			if (matchedActiveIndices.has(i)) continue;
			const sim = calculateSimilarity(defItem, activeBullets[i]!);
			if (sim > bestSim && sim >= 0.4) {
				bestSim = sim;
				bestIdx = i;
			}
		}

		if (bestIdx !== -1) {
			matchedActiveIndices.add(bestIdx);
			modifiedOrChanged.push({
				defaultItem: defItem,
				activeItem: activeBullets[bestIdx]!,
				similarity: bestSim,
			});
		} else {
			missingFromActive.push(defItem);
		}
	}

	const uniqueToActive = activeBullets.filter((_, idx) => !matchedActiveIndices.has(idx));

	const unifiedDiff = generateUnifiedPatch(
		"SYSTEM.md (Active vs Bundled Default)",
		activePrompt.endsWith("\n") ? activePrompt : `${activePrompt}\n`,
		defaultPrompt.endsWith("\n") ? defaultPrompt : `${defaultPrompt}\n`,
	);

	// Format a structured summary
	const summaryLines: string[] = [];
	summaryLines.push(`# System Prompt Comparison (Pi v${piVersion})`);
	summaryLines.push(`Source: ${promptSourcePath}`);
	summaryLines.push("");

	if (isIdentical) {
		summaryLines.push("✓ Your active system prompt is identical to Pi's bundled default system prompt.");
	} else {
		summaryLines.push(
			`Status: Differences found (${missingFromActive.length} missing, ${modifiedOrChanged.length} changed, ${uniqueToActive.length} custom).`,
		);
		summaryLines.push("");

		if (missingFromActive.length > 0) {
			summaryLines.push(
				`## ⚠️ Parts We Don't Have (In Pi default, missing from active prompt) [${missingFromActive.length}]`,
			);
			for (const item of missingFromActive) {
				summaryLines.push(`  + ${item}`);
			}
			summaryLines.push("");
		}

		if (modifiedOrChanged.length > 0) {
			summaryLines.push(`## 🔄 Parts That Have Changed (Modified wording) [${modifiedOrChanged.length}]`);
			for (const item of modifiedOrChanged) {
				summaryLines.push(`  - [Active]  ${item.activeItem}`);
				summaryLines.push(`  + [Default] ${item.defaultItem}`);
			}
			summaryLines.push("");
		}

		if (uniqueToActive.length > 0) {
			summaryLines.push(`## ✨ Custom Additions (Unique to your active prompt) [${uniqueToActive.length}]`);
			for (const item of uniqueToActive) {
				summaryLines.push(`  * ${item}`);
			}
			summaryLines.push("");
		}
	}

	const formattedSummary = summaryLines.join("\n");

	return {
		isIdentical,
		piVersion,
		promptSourcePath,
		activePrompt,
		defaultPrompt,
		missingFromActive,
		modifiedOrChanged,
		uniqueToActive,
		unifiedDiff,
		formattedSummary,
	};
}
