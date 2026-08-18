import { CardTitle } from "@everr/ui/components/card";
import type { ReactNode } from "react";

/**
 * One heading for every alerting card. The heading level is document
 * structure, not style: pages whose cards sit under an h2 pass `level={3}`.
 */
export function SectionHeading({
  children,
  level = 2,
}: {
  children: ReactNode;
  level?: 2 | 3;
}) {
  const Tag = level === 2 ? "h2" : "h3";
  return (
    <CardTitle>
      <Tag>{children}</Tag>
    </CardTitle>
  );
}
