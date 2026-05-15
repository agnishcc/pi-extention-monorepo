// ── Nerd Font detection ────────────────────────────────────────────────────────

/**
 * Detect if the terminal supports Nerd Fonts.
 * Checks environment variables and common terminal identifiers.
 */
export function hasNerdFonts(): boolean {
	if (process.env.POWERLINE_NERD_FONTS === "1") return true;
	if (process.env.POWERLINE_NERD_FONTS === "0") return false;
	if (process.env.GHOSTTY_RESOURCES_DIR) return true;
	const term = (process.env.TERM_PROGRAM || "").toLowerCase();
	return ["iterm", "wezterm", "kitty", "ghostty", "alacritty"].some((t) => term.includes(t));
}

const NERD = hasNerdFonts();

// ── Icons (fallback to text symbols when Nerd Fonts unavailable) ─────────────

/** Git branch icon */
export const iconGit = NERD ? "\uF7A1" : ""; //  or fallback to empty (branch name is clear enough)

/** Thinking/lightning icon (shown with thinking level) */
export const iconThink = NERD ? "\uF0E7" : ""; //  or fallback to empty

/** Cache read icon (󰩺 nf-md-cached — circular arrows) */
export const iconCacheRead = NERD ? "\uDB82\uDE7A" : "R"; // 󰩺 or fallback to R

/** Cache write icon (󱀚 nf-md-cloud-upload) */
export const iconCacheWrite = NERD ? "\uDB84\uDC1A" : "W"; // 󱀚 or fallback to W

/**
 * Wrap text with an icon prefix if nerd fonts are available.
 */
export function withIcon(icon: string, text: string): string {
	return icon ? `${icon} ${text}` : text;
}
