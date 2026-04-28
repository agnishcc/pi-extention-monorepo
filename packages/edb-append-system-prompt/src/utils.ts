// ── Utils ──────────────────────────────────────────────────────────────────────

export function formatAge(ts: number): string {
	const s = Math.floor((Date.now() - ts) / 1000);
	if (s < 60) return `${s}s ago`;
	if (s < 3600) return `${Math.floor(s / 60)}m ago`;
	if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
	return `${Math.floor(s / 86400)}d ago`;
}

export function wordCount(text: string): number {
	return text.trim().split(/\s+/).filter(Boolean).length;
}
