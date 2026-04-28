import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["packages/*/**/*.test.ts"],
		setupFiles: ["./test/setup.ts"],
		unstubGlobals: true,
		clearMocks: true,
		restoreMocks: true,
		passWithNoTests: true,
		coverage: {
			provider: "v8",
			reporter: ["text", "html"],
			include: ["packages/*/**/*.ts"],
			exclude: ["**/node_modules/**", "**/.pi/**", "**/*.test.ts", "**/index.ts", "**/docs/**"],
		},
	},
});
