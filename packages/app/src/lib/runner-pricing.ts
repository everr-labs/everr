export interface RunnerPricing {
  ratePerMinute: number;
  os: "linux" | "windows" | "macos";
  isSelfHosted: boolean;
  minuteMultiplier: number;
  tier: string;
}

export interface CostResult {
  estimatedCost: number;
  actualMinutes: number;
  billingMinutes: number;
  pricing: RunnerPricing;
}

const SELF_HOSTED_PRICING: RunnerPricing = {
  ratePerMinute: 0,
  os: "linux",
  isSelfHosted: true,
  minuteMultiplier: 1,
  tier: "Self-Hosted",
};

const FALLBACK_PRICING: RunnerPricing = {
  ratePerMinute: 0.006,
  os: "linux",
  isSelfHosted: false,
  minuteMultiplier: 1,
  tier: "Unknown",
};

interface PricingEntry {
  match: (labels: string[]) => boolean;
  pricing: RunnerPricing;
}

const PRICING_TABLE: PricingEntry[] = [
  // Blacksmith runners
  ...blacksmithRunners(),

  // Self-hosted
  {
    match: (labels) => labels.includes("self-hosted"),
    pricing: SELF_HOSTED_PRICING,
  },

  // GPU runners
  {
    match: (labels) =>
      labels.some((l) => l.includes("gpu")) && hasOs(labels, "windows"),
    pricing: {
      ratePerMinute: 0.102,
      os: "windows",
      isSelfHosted: false,
      minuteMultiplier: 2,
      tier: "GPU 4-core",
    },
  },
  {
    match: (labels) => labels.some((l) => l.includes("gpu")),
    pricing: {
      ratePerMinute: 0.052,
      os: "linux",
      isSelfHosted: false,
      minuteMultiplier: 1,
      tier: "GPU 4-core",
    },
  },

  // macOS larger runners
  {
    match: (labels) =>
      hasOs(labels, "macos") &&
      labels.some((l) => l.includes("xlarge") || l.includes("12-core")),
    pricing: {
      ratePerMinute: 0.077,
      os: "macos",
      isSelfHosted: false,
      minuteMultiplier: 10,
      tier: "macOS 12-core",
    },
  },
  {
    match: (labels) =>
      hasOs(labels, "macos") && labels.some((l) => l.includes("m2")),
    pricing: {
      ratePerMinute: 0.102,
      os: "macos",
      isSelfHosted: false,
      minuteMultiplier: 10,
      tier: "macOS M2 Pro",
    },
  },

  // macOS standard
  {
    match: (labels) => hasOs(labels, "macos"),
    pricing: {
      ratePerMinute: 0.062,
      os: "macos",
      isSelfHosted: false,
      minuteMultiplier: 10,
      tier: "macOS 3-core",
    },
  },

  // ARM Windows larger runners
  ...armWindowsRunners(),

  // Windows larger runners (descending cores)
  ...windowsLargerRunners(),

  // ARM Linux
  ...armLinuxRunners(),

  // Windows standard
  {
    match: (labels) => hasOs(labels, "windows"),
    pricing: {
      ratePerMinute: 0.01,
      os: "windows",
      isSelfHosted: false,
      minuteMultiplier: 2,
      tier: "Windows 2-core",
    },
  },

  // x64 Linux larger runners (descending cores)
  ...linuxLargerRunners(),

  // Linux 1-core
  {
    match: (labels) =>
      hasOs(labels, "linux") && labels.some((l) => l.includes("1-core")),
    pricing: {
      ratePerMinute: 0.002,
      os: "linux",
      isSelfHosted: false,
      minuteMultiplier: 1,
      tier: "Linux 1-core",
    },
  },

  // Linux 2-core standard (ubuntu-latest, etc.)
  {
    match: (labels) => hasOs(labels, "linux"),
    pricing: {
      ratePerMinute: 0.006,
      os: "linux",
      isSelfHosted: false,
      minuteMultiplier: 1,
      tier: "Linux 2-core",
    },
  },
];

function hasOs(labels: string[], os: "linux" | "windows" | "macos"): boolean {
  if (os === "linux") {
    return labels.some(
      (l) =>
        l.includes("ubuntu") ||
        l.includes("linux") ||
        l === "ubuntu-latest" ||
        l.startsWith("ubuntu-"),
    );
  }
  if (os === "windows") {
    return labels.some(
      (l) =>
        l.includes("windows") ||
        l === "windows-latest" ||
        l.startsWith("windows-"),
    );
  }
  return labels.some(
    (l) =>
      l.includes("macos") || l === "macos-latest" || l.startsWith("macos-"),
  );
}

function hasCoreCount(labels: string[], cores: number): boolean {
  return labels.some(
    (l) => l.includes(`${cores}-core`) || l.includes(`${cores}core`),
  );
}

function hasBlacksmithLabel(labels: string[], pattern: RegExp): boolean {
  return labels.some((label) => pattern.test(label));
}

function blacksmithRunners(): PricingEntry[] {
  const linuxXCores = [2, 4, 8, 16, 32];
  const linuxArmCores = [2, 4, 8, 16, 32];
  const windowsCores = [2, 4, 8, 16, 32];

  return [
    ...linuxXCores.map((cores) => ({
      match: (labels: string[]) =>
        hasBlacksmithLabel(
          labels,
          new RegExp(`^blacksmith-${cores}vcpu-ubuntu-(2204|2404)$`),
        ),
      pricing: {
        ratePerMinute: 0.004 * (cores / 2),
        os: "linux" as const,
        isSelfHosted: false,
        minuteMultiplier: cores / 2,
        tier: `Blacksmith Ubuntu x64 ${cores} vCPU`,
      },
    })),
    ...linuxArmCores.map((cores) => ({
      match: (labels: string[]) =>
        hasBlacksmithLabel(
          labels,
          new RegExp(`^blacksmith-${cores}vcpu-ubuntu-(2204|2404)-arm$`),
        ),
      pricing: {
        ratePerMinute: 0.0025 * (cores / 2),
        os: "linux" as const,
        isSelfHosted: false,
        minuteMultiplier: (cores / 2) * 0.625,
        tier: `Blacksmith Ubuntu ARM ${cores} vCPU`,
      },
    })),
    ...windowsCores.map((cores) => ({
      match: (labels: string[]) =>
        hasBlacksmithLabel(
          labels,
          new RegExp(`^blacksmith-${cores}vcpu-windows-2025$`),
        ),
      pricing: {
        ratePerMinute: 0.008 * (cores / 2),
        os: "windows" as const,
        isSelfHosted: false,
        minuteMultiplier: (cores / 2) * 2,
        tier: `Blacksmith Windows x64 ${cores} vCPU`,
      },
    })),
    {
      match: (labels) =>
        hasBlacksmithLabel(labels, /^blacksmith-6vcpu-macos-(latest|15|26)$/),
      pricing: {
        ratePerMinute: 0.08,
        os: "macos",
        isSelfHosted: false,
        minuteMultiplier: 20,
        tier: "Blacksmith macOS M4 6 vCPU",
      },
    },
    {
      match: (labels) =>
        hasBlacksmithLabel(labels, /^blacksmith-12vcpu-macos-(latest|15|26)$/),
      pricing: {
        ratePerMinute: 0.16,
        os: "macos",
        isSelfHosted: false,
        minuteMultiplier: 40,
        tier: "Blacksmith macOS M4 12 vCPU",
      },
    },
  ];
}

function windowsLargerRunners(): PricingEntry[] {
  const cores = [
    { c: 96, rate: 0.552 },
    { c: 64, rate: 0.322 },
    { c: 32, rate: 0.162 },
    { c: 16, rate: 0.082 },
    { c: 8, rate: 0.042 },
    { c: 4, rate: 0.022 },
  ];
  return cores.map(({ c, rate }) => ({
    match: (labels: string[]) =>
      hasOs(labels, "windows") && hasCoreCount(labels, c),
    pricing: {
      ratePerMinute: rate,
      os: "windows" as const,
      isSelfHosted: false,
      minuteMultiplier: 2,
      tier: `Windows ${c}-core`,
    },
  }));
}

function armLinuxRunners(): PricingEntry[] {
  const cores = [
    { c: 64, rate: 0.098 },
    { c: 32, rate: 0.05 },
    { c: 16, rate: 0.026 },
    { c: 8, rate: 0.014 },
    { c: 4, rate: 0.008 },
    { c: 2, rate: 0.005 },
  ];
  return cores.map(({ c, rate }) => ({
    match: (labels: string[]) =>
      hasOs(labels, "linux") &&
      labels.some((l) => l.includes("arm") || l.includes("arm64")) &&
      (c === 2 || hasCoreCount(labels, c)),
    pricing: {
      ratePerMinute: rate,
      os: "linux" as const,
      isSelfHosted: false,
      minuteMultiplier: 1,
      tier: `ARM Linux ${c}-core`,
    },
  }));
}

function armWindowsRunners(): PricingEntry[] {
  const cores = [
    { c: 64, rate: 0.194 },
    { c: 32, rate: 0.098 },
    { c: 16, rate: 0.05 },
    { c: 8, rate: 0.026 },
    { c: 4, rate: 0.014 },
    { c: 2, rate: 0.008 },
  ];
  return cores.map(({ c, rate }) => ({
    match: (labels: string[]) =>
      hasOs(labels, "windows") &&
      labels.some((l) => l.includes("arm") || l.includes("arm64")) &&
      hasCoreCount(labels, c),
    pricing: {
      ratePerMinute: rate,
      os: "windows" as const,
      isSelfHosted: false,
      minuteMultiplier: 2,
      tier: `ARM Windows ${c}-core`,
    },
  }));
}

function linuxLargerRunners(): PricingEntry[] {
  const cores = [
    { c: 96, rate: 0.252 },
    { c: 64, rate: 0.162 },
    { c: 32, rate: 0.082 },
    { c: 16, rate: 0.042 },
    { c: 8, rate: 0.022 },
    { c: 4, rate: 0.012 },
  ];
  return cores.map(({ c, rate }) => ({
    match: (labels: string[]) =>
      hasOs(labels, "linux") &&
      !labels.some((l) => l.includes("arm") || l.includes("arm64")) &&
      hasCoreCount(labels, c),
    pricing: {
      ratePerMinute: rate,
      os: "linux" as const,
      isSelfHosted: false,
      minuteMultiplier: 1,
      tier: `Linux ${c}-core`,
    },
  }));
}

export function getRunnerPricing(labelsString: string): RunnerPricing {
  const labels = labelsString
    .split(",")
    .map((l) => l.trim().toLowerCase())
    .filter(Boolean);

  if (labels.length === 0) {
    return FALLBACK_PRICING;
  }

  for (const entry of PRICING_TABLE) {
    if (entry.match(labels)) {
      return entry.pricing;
    }
  }

  return FALLBACK_PRICING;
}

/**
 * Calculate cost for runner usage.
 *
 * @param labelsString - comma-separated runner labels
 * @param durationMs - total actual duration in milliseconds
 * @param preRoundedMinutes - sum of per-job ceil'd minutes (each job rounded up
 *   individually). When provided, this is used for billing instead of rounding
 *   the aggregate duration. GitHub bills each job rounded up to the nearest
 *   minute, so callers that aggregate multiple jobs must pre-round in SQL.
 */
export function calculateCost(
  labelsString: string,
  durationMs: number,
  preRoundedMinutes?: number,
): CostResult {
  const pricing = getRunnerPricing(labelsString);
  const actualMinutes = durationMs / 60_000;
  const roundedMinutes = preRoundedMinutes ?? Math.ceil(actualMinutes);
  const billingMinutes = roundedMinutes * pricing.minuteMultiplier;
  const estimatedCost = roundedMinutes * pricing.ratePerMinute;

  return {
    estimatedCost,
    actualMinutes,
    billingMinutes,
    pricing,
  };
}

export function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}
