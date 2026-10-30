"use client";

import { Fuel, Heart, Package, Shield } from "lucide-react";
import type { ResourceKey } from "@/lib/game-data";

type ResourceValues = Record<ResourceKey, number>;

const compartments: Array<{
  key: ResourceKey;
  label: string;
  className: string;
  Icon: typeof Fuel;
}> = [
  { key: "Fuel", label: "Propulsion", className: "ship-zone-fuel", Icon: Fuel },
  {
    key: "Hull",
    label: "Hull control",
    className: "ship-zone-hull",
    Icon: Shield,
  },
  {
    key: "Supplies",
    label: "Cargo hold",
    className: "ship-zone-supplies",
    Icon: Package,
  },
  {
    key: "Morale",
    label: "Crew deck",
    className: "ship-zone-morale",
    Icon: Heart,
  },
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
          ? "Final Voyage spacecraft schematic"
          : "Spacecraft system schematic linked to current resources"
      }
    >
      <div className="ship-grid" aria-hidden="true" />
      <svg viewBox="0 0 920 520" role="img" aria-hidden={decorative}>
        <defs>
          <linearGradient id="hull-metal" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#d8d3c8" />
            <stop offset="0.45" stopColor="#6e716f" />
            <stop offset="1" stopColor="#262a2b" />
          </linearGradient>
          <linearGradient id="dark-metal" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#343838" />
            <stop offset="1" stopColor="#101313" />
          </linearGradient>
          <filter id="system-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="9" />
          </filter>
        </defs>

        <g className="ship-shadow" opacity=".7">
          <path d="M105 260 205 156 680 133 838 260 680 387 205 364Z" />
        </g>

        <g className="ship-outline">
          <path
            d="M82 238h92l36-94 454-29 188 145-188 145-454-29-36-94H82Z"
            fill="url(#hull-metal)"
          />
          <path
            d="M96 252h100l40-80 411-28 157 116-157 116-411-28-40-80H96Z"
            fill="#141818"
          />
          <path
            d="M647 144 804 260 647 376 702 260Z"
            fill="url(#dark-metal)"
            stroke="#a8a79f"
          />
          <path
            d="M190 173 236 87h82l-19 77M190 347l46 86h82l-19-77"
            fill="#202424"
            stroke="#737773"
            strokeWidth="4"
          />
          <path
            d="M133 206 71 167H26l36 93-36 93h45l62-39"
            fill="#252929"
            stroke="#777a75"
            strokeWidth="5"
          />
          <path
            d="M113 221H43l29 39-29 39h70"
            fill="#0e1111"
            stroke="#525652"
            strokeWidth="4"
          />
          <circle
            cx="666"
            cy="260"
            r="28"
            fill="#090b0b"
            stroke="#d5d0c5"
            strokeWidth="4"
          />
          <circle cx="666" cy="260" r="13" fill="#c82b30" />
        </g>

        <g
          className={`ship-zone ship-zone-fuel ${condition(resourceValues.Fuel)}`}
        >
          <ellipse
            cx="150"
            cy="260"
            rx="76"
            ry="88"
            className="zone-glow"
            filter="url(#system-glow)"
          />
          <path d="M111 196h91v128h-91z" />
          <path
            d="M122 214h69M122 236h69M122 284h69M122 306h69"
            className="detail-line"
          />
          <circle cx="137" cy="260" r="12" />
          <circle cx="174" cy="260" r="12" />
        </g>

        <g
          className={`ship-zone ship-zone-hull ${condition(resourceValues.Hull)}`}
        >
          <ellipse
            cx="477"
            cy="260"
            rx="91"
            ry="139"
            className="zone-glow"
            filter="url(#system-glow)"
          />
          <path d="M426 156h103l55 104-55 104H426l-48-104Z" />
          <path
            d="M445 183h65l34 77-34 77h-65l-28-77Z"
            className="inner-zone"
          />
          <path d="M477 183v154M417 260h127" className="detail-line" />
        </g>

        <g
          className={`ship-zone ship-zone-supplies ${condition(resourceValues.Supplies)}`}
        >
          <ellipse
            cx="314"
            cy="306"
            rx="88"
            ry="77"
            className="zone-glow"
            filter="url(#system-glow)"
          />
          <path d="M228 266h158v84l-71 20-87-20Z" />
          <path
            d="M249 284h43v43h-43zM305 284h58v20h-58zM305 313h58v20h-58z"
            className="inner-zone"
          />
        </g>

        <g
          className={`ship-zone ship-zone-morale ${condition(resourceValues.Morale)}`}
        >
          <ellipse
            cx="313"
            cy="210"
            rx="88"
            ry="77"
            className="zone-glow"
            filter="url(#system-glow)"
          />
          <path d="M228 170 315 150l71 20v84H228Z" />
          <circle cx="267" cy="207" r="17" className="inner-zone" />
          <circle cx="316" cy="195" r="17" className="inner-zone" />
          <circle cx="354" cy="220" r="17" className="inner-zone" />
        </g>

        <g className="ship-detail-lines" fill="none">
          <path d="M206 260h420" />
          <path d="M386 170v180M584 197v126" />
          <path d="M211 171 647 144M211 349l436 27" />
        </g>
      </svg>

      {!decorative && (
        <div className="ship-callouts">
          {compartments.map(({ key, label, className, Icon }) => (
            <div
              className={`ship-callout ${className} ${condition(resourceValues[key])}`}
              key={key}
            >
              <Icon size={14} />
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
