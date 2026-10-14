import { defineConfig } from "drizzle-kit";

const databaseHost = process.env.DATABASE_HOST;
const databaseName = process.env.DATABASE_NAME;
const databasePort = process.env.DATABASE_PORT;
const databaseUser = process.env.DATABASE_USER;
const databasePassword = process.env.DATABASE_PASSWORD;

if (
	!databaseHost ||
	!databaseName ||
	!databasePort ||
	!databaseUser ||
	!databasePassword
) {
	throw new Error(
		"DATABASE_HOST, DATABASE_NAME, DATABASE_PORT, DATABASE_USER, and DATABASE_PASSWORD are required to run Drizzle commands.",
	);
}

const databaseURL = new URL("postgresql://localhost");
databaseURL.hostname = databaseHost;
databaseURL.pathname = `/${databaseName}`;
databaseURL.port = databasePort;
databaseURL.username = databaseUser;
databaseURL.password = databasePassword;

export default defineConfig({
	out: "./drizzle/core",
	schema: "./src/db/schema/index.ts",
	dialect: "postgresql",
	migrations: {
		table: "__everr_core_migrations",
		schema: "drizzle",
	},
	dbCredentials: {
		url: databaseURL.toString(),
	},
});
