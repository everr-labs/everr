const TRIGGER_LABELS: Record<string, string> = {
  error: "Error",
  network: "Network",
  manual: "Manual",
};

export function recordingTitle(clip: { route: string; url: string }): string {
  if (clip.route) return clip.route;
  if (clip.url) return clip.url;
  return "Recording";
}

export function triggerLabel(trigger: string): string {
  if (!trigger) return "";
  return TRIGGER_LABELS[trigger] ?? trigger;
}
