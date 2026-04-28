import { execSync } from "node:child_process";
import type { UsageSnapshot } from "./common";
import { formatReset, stripAnsi, whichSync } from "./common";

export async function fetchKiroUsage(): Promise<UsageSnapshot> {
	const kiroBinary = whichSync("kiro-cli");
	if (!kiroBinary) {
		return { provider: "kiro", displayName: "Kiro", windows: [], error: "kiro-cli not found" };
	}

	try {
		try {
			execSync("kiro-cli whoami", { encoding: "utf-8", timeout: 5000 });
		} catch {
			return { provider: "kiro", displayName: "Kiro", windows: [], error: "Not logged in" };
		}

		const output = execSync("kiro-cli chat --no-interactive /usage", {
			encoding: "utf-8",
			timeout: 10000,
			env: { ...process.env, TERM: "xterm-256color" },
		});

		const stripped = stripAnsi(output);
		const windows: any[] = [];

		let planName = "Kiro";
		const planMatch = stripped.match(/\|\s*(KIRO\s+\w+)/i);
		if (planMatch) {
			planName = planMatch[1].trim();
		}

		let creditsPercent = 0;
		const percentMatch = stripped.match(/█+\s*(\d+)%/);
		if (percentMatch) {
			creditsPercent = parseInt(percentMatch[1], 10);
		}

		let creditsUsed = 0;
		let creditsTotal = 50;
		const creditsMatch = stripped.match(/\((\d+\.?\d*)\s+of\s+(\d+)\s+covered/);
		if (creditsMatch) {
			creditsUsed = parseFloat(creditsMatch[1]);
			creditsTotal = parseFloat(creditsMatch[2]);
			if (!percentMatch && creditsTotal > 0) {
				creditsPercent = (creditsUsed / creditsTotal) * 100;
			}
		}

		let resetsAt: Date | undefined;
		const resetMatch = stripped.match(/resets on (\d{2}\/\d{2})/);
		if (resetMatch) {
			const [month, day] = resetMatch[1].split("/").map(Number);
			const now = new Date();
			const year = now.getFullYear();
			resetsAt = new Date(year, month - 1, day);
			if (resetsAt < now) resetsAt.setFullYear(year + 1);
		}

		windows.push({
			label: "Credits",
			usedPercent: creditsPercent,
			resetDescription: resetsAt ? formatReset(resetsAt) : undefined,
		});

		const bonusMatch = stripped.match(/Bonus credits:\s*(\d+\.?\d*)\/(\d+)/);
		if (bonusMatch) {
			const bonusUsed = parseFloat(bonusMatch[1]);
			const bonusTotal = parseFloat(bonusMatch[2]);
			const bonusPercent = bonusTotal > 0 ? (bonusUsed / bonusTotal) * 100 : 0;
			const expiryMatch = stripped.match(/expires in (\d+) days?/);
			windows.push({
				label: "Bonus",
				usedPercent: bonusPercent,
				resetDescription: expiryMatch ? `${expiryMatch[1]}d left` : undefined,
			});
		}

		return { provider: "kiro", displayName: "Kiro", windows, plan: planName };
	} catch (e) {
		return { provider: "kiro", displayName: "Kiro", windows: [], error: String(e) };
	}
}
