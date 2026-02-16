import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
    test: {
        globals: true,
        include: ["tests/**/*.test.ts"],
    },
    resolve: {
        alias: {
            "@app-core": path.resolve(__dirname, "src/core"),
            "@app-types": path.resolve(__dirname, "src/core/types"),
            "@app-utils": path.resolve(__dirname, "src/utils"),
            "@app-rc": path.resolve(__dirname, "src/rc"),
            "@app-strg": path.resolve(__dirname, "src/strengthening"),
        },
    },
});
