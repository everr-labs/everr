import { Marquee } from "@/components/ui/marquee";

type Capability = { label: string; planned: boolean };

export function CapabilityMarquee({ features }: { features: Capability[] }) {
  const midpoint = Math.ceil(features.length / 2);
  const rows = [features.slice(0, midpoint), features.slice(midpoint)];

  return (
    <div className="cap-marquee-window">
      {rows.map((row, index) => (
        <Marquee
          className="cap-marquee-row"
          key={row[0].label}
          reverse={index === 1}
          pauseOnHover
        >
          <ul className="cap-marquee-group">
            {row.map(({ label, planned }) => (
              <li key={label} data-planned={planned || undefined}>
                <span>{label}</span>
                {planned && (
                  <small className="cap-planned-badge">Planned</small>
                )}
              </li>
            ))}
          </ul>
        </Marquee>
      ))}
    </div>
  );
}
