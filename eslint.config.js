// @ts-check
import antfu from "@antfu/eslint-config"

export default antfu({
	type: "lib",
	typescript: true,
	formatters: true,
	lessOpinionated: true,
	stylistic: {
		indent: "tab",
		quotes: "double",
	},
	ignores: [
		"drizzle/**",
	],
}, {
	rules: {
		"func-style": ["error", "expression"],
		"node/prefer-global/process": "off",
		"ts/explicit-function-return-type": ["off"],
		"perfectionist/sort-imports": ["error", {
			tsconfigRootDir: ".",
		}],
	},
})
