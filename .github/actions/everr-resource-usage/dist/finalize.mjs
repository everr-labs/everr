import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
function parseArgs(argv) {
    const args = {};
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith("--")) {
            continue;
        }
        const key = token.slice(2);
        const value = argv[index + 1];
        if (value === undefined || value.startsWith("--")) {
            throw new Error(`missing value for --${key}`);
        }
        args[key] = value;
        index += 1;
    }
    return args;
}
function toNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}
function toInteger(value, fallback = 0) {
    const parsed = Math.trunc(toNumber(value, fallback));
    return Number.isFinite(parsed) ? parsed : fallback;
}
function toString(value, fallback = "") {
    return typeof value === "string" ? value : fallback;
}
function parseDate(value, fallback = new Date(0)) {
    const parsed = value ? new Date(value) : fallback;
    return Number.isNaN(parsed.valueOf()) ? fallback : parsed;
}
function formatError(error) {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
export function buildMetadata(metadata) {
    const startedAt = parseDate(metadata.startedAt);
    const completedAt = parseDate(metadata.completedAt, startedAt);
    return {
        schemaVersion: 2,
        checkRunId: toInteger(metadata.checkRunId),
        repo: metadata.repo,
        runId: toInteger(metadata.runId),
        runAttempt: toInteger(metadata.runAttempt),
        githubJob: metadata.githubJob,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        runner: {
            name: metadata.runnerName ?? "",
            os: metadata.runnerOs ?? "",
            arch: metadata.runnerArch ?? "",
        },
        filesystem: {
            device: metadata.filesystemDevice ?? "",
            mountpoint: metadata.filesystemMountpoint ?? "",
            type: metadata.filesystemType ?? "",
        },
    };
}
function parseCPULogicalSamples(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .map((item) => ({
        logicalNumber: toInteger(item && typeof item === "object"
            ? item.logicalNumber
            : undefined),
        utilization: toNumber(item && typeof item === "object"
            ? item.utilization
            : undefined),
    }))
        .sort((left, right) => left.logicalNumber - right.logicalNumber);
}
function parseNetworkInterfaces(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .map((item) => ({
        name: toString(item && typeof item === "object"
            ? item.name
            : undefined),
        receiveBytes: toNumber(item && typeof item === "object"
            ? item.receiveBytes
            : undefined),
        transmitBytes: toNumber(item && typeof item === "object"
            ? item.transmitBytes
            : undefined),
    }))
        .sort((left, right) => left.name.localeCompare(right.name));
}
function sanitizeSample(parsed) {
    const cpu = parsed.cpu && typeof parsed.cpu === "object"
        ? parsed.cpu
        : {};
    const memory = parsed.memory && typeof parsed.memory === "object"
        ? parsed.memory
        : {};
    const filesystem = parsed.filesystem && typeof parsed.filesystem === "object"
        ? parsed.filesystem
        : {};
    const network = parsed.network && typeof parsed.network === "object"
        ? parsed.network
        : {};
    return {
        timestamp: toString(parsed.timestamp),
        cpu: {
            logical: parseCPULogicalSamples(cpu.logical),
        },
        memory: {
            limitBytes: toNumber(memory.limitBytes),
            usedBytes: toNumber(memory.usedBytes),
            availableBytes: toNumber(memory.availableBytes),
            utilization: toNumber(memory.utilization),
        },
        filesystem: {
            device: toString(filesystem.device),
            mountpoint: toString(filesystem.mountpoint),
            type: toString(filesystem.type),
            limitBytes: toNumber(filesystem.limitBytes),
            usedBytes: toNumber(filesystem.usedBytes),
            freeBytes: toNumber(filesystem.freeBytes),
            utilization: toNumber(filesystem.utilization),
        },
        network: {
            interfaces: parseNetworkInterfaces(network.interfaces),
        },
    };
}
export async function loadSamples(samplesPath) {
    if (!samplesPath || !existsSync(samplesPath)) {
        return [];
    }
    const raw = await readFile(samplesPath, "utf8");
    if (raw.trim() === "") {
        return [];
    }
    return raw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line, index) => {
        let parsed;
        try {
            parsed = JSON.parse(line);
        }
        catch (error) {
            throw new Error(`invalid NDJSON sample on line ${index + 1}: ${formatError(error)}`);
        }
        return sanitizeSample(parsed);
    });
}
function serializeSamples(samples) {
    if (samples.length === 0) {
        return "";
    }
    return `${samples.map((sample) => JSON.stringify(sample)).join("\n")}\n`;
}
export async function finalizePartialArtifact({ samplesPath, outputDir, metadata, }) {
    const samples = await loadSamples(samplesPath);
    const finalizedMetadata = buildMetadata(metadata);
    await mkdir(outputDir, { recursive: true });
    await writeFile(`${outputDir}/metadata.json`, `${JSON.stringify(finalizedMetadata, null, 2)}\n`, "utf8");
    await writeFile(`${outputDir}/samples.ndjson`, serializeSamples(samples), "utf8");
    return finalizedMetadata;
}
async function main() {
    const args = parseArgs(process.argv.slice(2));
    await finalizePartialArtifact({
        samplesPath: args["samples-path"],
        outputDir: args["output-dir"],
        metadata: {
            checkRunId: args["check-run-id"],
            repo: args.repo,
            runId: args["run-id"],
            runAttempt: args["run-attempt"],
            githubJob: args["github-job"],
            runnerName: args["runner-name"] ?? "",
            runnerOs: args["runner-os"] ?? "",
            runnerArch: args["runner-arch"] ?? "",
            startedAt: args["started-at"],
            completedAt: args["completed-at"],
            filesystemDevice: args["filesystem-device"] ?? "",
            filesystemMountpoint: args["filesystem-mountpoint"] ?? "",
            filesystemType: args["filesystem-type"] ?? "",
        },
    });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        console.error(formatError(error));
        process.exitCode = 1;
    });
}
