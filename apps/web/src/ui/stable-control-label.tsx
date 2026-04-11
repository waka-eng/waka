import type { ReactElement } from "react";

export interface StableControlLabelProps {
  label: string;
  widestLabel: string;
}

export function StableControlLabel({
  label,
  widestLabel,
}: StableControlLabelProps): ReactElement {
  return (
    <span className="inline-grid">
      <span aria-hidden="true" className="invisible col-start-1 row-start-1">
        {widestLabel}
      </span>
      <span className="col-start-1 row-start-1">{label}</span>
    </span>
  );
}
