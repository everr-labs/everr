import { siGo, siVitest } from "simple-icons";

const frameworks: Record<string, { path: string; hex: string }> = {
  go: siGo,
  vitest: siVitest,
};

interface FrameworkIconProps {
  framework: string | undefined;
  className?: string;
}

export function FrameworkIcon({ framework, className }: FrameworkIconProps) {
  if (!framework) return null;
  const icon = frameworks[framework];
  if (!icon) return null;
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      fill={`#${icon.hex}`}
      className={className}
    >
      <title>{framework}</title>
      <path d={icon.path} />
    </svg>
  );
}
