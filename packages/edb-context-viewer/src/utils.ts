/**
 * Shared utility helpers for edb-context-viewer.
 */

/** Format a token count as a human-readable string (e.g. 45k, 1.2M). */
export const formatTokens = (n: number | null | undefined): string => {
	if (n == null) return "N/A";
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
	return n.toString();
};
