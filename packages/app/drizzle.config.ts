import { defineConfig } from "drizzle-kit";

const databaseURL = process.env.DATABASE_URL;

if (!databaseURL) {
	throw new Error("DATABASE_URL is required to run Drizzle commands.");
}

export default defineConfig({
	out: "./drizzle",
	schema: "./src/db/schema.ts",
	dialect: "postgresql",
	dbCredentials: {
		url: databaseURL,
	},
});
