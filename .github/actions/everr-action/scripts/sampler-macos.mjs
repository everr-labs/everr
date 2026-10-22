import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { cpus, freemem, totalmem } from "node:os";
import { dirname } from "node:path";

const samplesPath = process.argv[2];
const workspacePath = process.argv[3];
const intervalMs = (parseInt(process.argv[4], 10) || 5) * 1000;

let previousTimes = cpus().map((cpu) => cpu.times);
let filesystemType = "unknown";
let filesystemDevice = "";
let filesystemMountpoint = "";

function resolveFilesystemInfo() {
  try {
    const dfOutput = execFileSync("df", ["-Pk", workspacePath], {
      encoding: "utf8",
    });
    const dfLines = dfOutput.trim().split("\n");
    if (dfLines.length < 2) return;
    const fields = dfLines[1].trim().split(/\s+/);
    if (fields.length < 6) return;
    filesystemDevice = fields[0];
    filesystemMountpoint = fields[5];

    const mountOutput = execFileSync("mount", [], { encoding: "utf8" });
    for (const line of mountOutput.split("\n")) {
      if (line.includes(` on ${filesystemMountpoint} `)) {
        const match = line.match(/\(([^,)]+)/);
        if (match) filesystemType = match[1];
        break;
      }
    }
  } catch {
    // filesystem info is best-effort
  }
}

function readFilesystemStats() {
  try {
    const dfOutput = execFileSync("df", ["-Pk", workspacePath], {
      encoding: "utf8",
    });
    const dfLines = dfOutput.trim().split("\n");
    if (dfLines.length < 2) {
      return { limitBytes: 0, usedBytes: 0, freeBytes: 0, utilization: 0 };
    }
    const fields = dfLines[1].trim().split(/\s+/);
    if (fields.length < 6) {
      return { limitBytes: 0, usedBytes: 0, freeBytes: 0, utilization: 0 };
    }
    const totalKb = parseInt(fields[1], 10);
    const usedKb = parseInt(fields[2], 10);
    const freeKb = parseInt(fields[3], 10);
    const limitBytes = totalKb * 1024;
    const usedBytes = usedKb * 1024;
    const freeBytes = freeKb * 1024;
    const utilization = limitBytes > 0 ? usedBytes / limitBytes : 0;
    return { limitBytes, usedBytes, freeBytes, utilization };
  } catch {
    return { limitBytes: 0, usedBytes: 0, freeBytes: 0, utilization: 0 };
  }
}

function readNetworkInterfaces() {
  const interfaces = [];
  try {
    const output = execFileSync("netstat", ["-ibn"], { encoding: "utf8" });
    const lines = output.split("\n").slice(1);
    for (const line of lines) {
      const fields = line.trim().split(/\s+/);
      if (fields.length < 7) continue;
      const name = fields[0];
      if (name === "lo0" || name === "") continue;
      const receiveBytes = parseInt(fields[fields.length - 6], 10);
      const transmitBytes = parseInt(fields[fields.length - 3], 10);
      if (Number.isNaN(receiveBytes) || Number.isNaN(transmitBytes)) continue;
      interfaces.push({ name, receiveBytes, transmitBytes });
    }
  } catch {
    // network stats are best-effort
  }
  return interfaces;
}

function buildCPULogicalJson(currentTimes) {
  const items = currentTimes.map((times, i) => {
    const prev = previousTimes[i];
    const prevTotal = prev
      ? prev.user + prev.nice + prev.sys + prev.idle + prev.irq
      : times.user + times.nice + times.sys + times.idle + times.irq;
    const prevIdle = prev ? prev.idle + prev.irq : times.idle + times.irq;
    const currentTotal = times.user + times.nice + times.sys + times.idle + times.irq;
    const currentIdle = times.idle + times.irq;
    const deltaTotal = currentTotal - prevTotal;
    const deltaIdle = currentIdle - prevIdle;
    const utilization = deltaTotal > 0 ? (deltaTotal - deltaIdle) / deltaTotal : 0;
    return {
      logicalNumber: i,
      utilization: Number(utilization.toFixed(6)),
    };
  });
  return JSON.stringify(items);
}

function buildNetworkInterfacesJSON() {
  return JSON.stringify(readNetworkInterfaces());
}

function emitSample() {
  const currentTimes = cpus().map((cpu) => cpu.times);
  const cpuLogicalJson = buildCPULogicalJson(currentTimes);

  const totalMemory = totalmem();
  const freeMemory = freemem();
  const usedMemory = totalMemory - freeMemory;
  const memoryUtilization = totalMemory > 0 ? usedMemory / totalMemory : 0;

  const fsStats = readFilesystemStats();
  const networkJson = buildNetworkInterfacesJSON();
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  const sample = JSON.stringify({
    timestamp,
    cpu: { logical: JSON.parse(cpuLogicalJson) },
    memory: {
      limitBytes: totalMemory,
      usedBytes: usedMemory,
      availableBytes: freeMemory,
      utilization: Number(memoryUtilization.toFixed(6)),
    },
    filesystem: {
      device: filesystemDevice,
      mountpoint: filesystemMountpoint,
      type: filesystemType,
      limitBytes: fsStats.limitBytes,
      usedBytes: fsStats.usedBytes,
      freeBytes: fsStats.freeBytes,
      utilization: Number(fsStats.utilization.toFixed(6)),
    },
    network: {
      interfaces: JSON.parse(networkJson),
    },
  });

  appendFileSync(samplesPath, sample + "\n");
  previousTimes = currentTimes;
}

function shutdown() {
  emitSample();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

mkdirSync(dirname(samplesPath), { recursive: true });
resolveFilesystemInfo();

setTimeout(() => {
  emitSample();
  setInterval(emitSample, intervalMs);
}, intervalMs);
