"use client";

import { Fuel, Heart, Package, Shield } from "lucide-react";
import Image from "next/image";
import type { ResourceKey } from "@/lib/game-data";

type ResourceValues = Record<ResourceKey, number>;

const compartments: Array<{
  key: ResourceKey;
  label: string;
  zone: string;
  Icon: typeof Fuel;
}> = [
  { key: "Fuel", label: "Propulsion", zone: "fuel", Icon: Fuel },
  { key: "Hull", label: "Hull control", zone: "hull", Icon: Shield },
  { key: "Supplies", label: "Cargo hold", zone: "supplies", Icon: Package },
  { key: "Morale", label: "Crew deck", zone: "morale", Icon: Heart },
];

function condition(value: number) {
  if (value <= 2) return "critical";
  if (value <= 4) return "caution";
  return "stable";
}

export function ShipSchematic({
  values,
  compact = false,
  decorative = false,
}: {
  values?: ResourceValues;
  compact?: boolean;
  decorative?: boolean;
}) {
  const resourceValues: ResourceValues = values ?? {
    Fuel: 7,
    Hull: 8,
    Supplies: 6,
    Morale: 7,
  };

  return (
    <figure
      className={`ship-schematic ${compact ? "compact" : ""} ${decorative ? "decorative" : ""}`}
      aria-label={
        decorative
          ? "Final Voyage deep-space vessel"
          : "Spacecraft compartment status linked to current resources"
      }
    >
      <div className="ship-grid" aria-hidden="true" />
      <div className="ship-asset" aria-hidden="true">
        <Image
          src="/assets/final-voyage-cutaway.webp"
          alt=""
          width="1600"
          height="667"
          draggable={false}
          priority={decorative}
        />
        {!decorative &&
          compartments.map(({ key, zone }) => (
            <span
              className={`ship-live-zone ${zone} ${condition(resourceValues[key])}`}
              key={key}
            />
          ))}
      </div>

      {!decorative && (
        <div className="ship-callouts">
          {compartments.map(({ key, label, zone, Icon }) => (
            <div
              className={`ship-callout ${zone} ${condition(resourceValues[key])}`}
              key={key}
            >
              <Icon size={15} />
              <span>{label}</span>
              <b>{condition(resourceValues[key])}</b>
            </div>
          ))}
        </div>
      )}
      <figcaption>
        {decorative
          ? "FV-06 deep-space survival vessel"
          : "FV-06 // live compartment telemetry"}
      </figcaption>
    </figure>
  );
}
