import { siGo, siRust, siVitest } from "simple-icons";

const frameworks: Record<string, { path: string; hex: string }> = {
  go: siGo,
  rust: siRust,
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
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- must stay an <svg> to render the icon path; role="img" pairs with the <title> for its accessible name
    <svg role="img" viewBox="0 0 24 24" fill={`#${icon.hex}`} className={className}>
      <title>{framework}</title>
      <path d={icon.path} />
    </svg>
  );
}
