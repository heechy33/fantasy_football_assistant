import type { MouseEvent } from 'react';

export interface InfoTooltipProps {
  /** Explanatory text shown on hover/focus and exposed to screen readers. */
  text: string;
  /** Accessible label for the trigger button, e.g. "What is ADP?". Falls back to a generic label. */
  label?: string;
}

/**
 * Small "?" badge that reveals a plain-language explanation on hover/focus (and tap on touch
 * devices, via CSS `:focus`/`:active`). Display-only — stops click propagation so it never
 * triggers a parent card's `onViewDetails`/`onClick`.
 */
export function InfoTooltip({ text, label }: InfoTooltipProps) {
  function onClick(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
  }

  return (
    <span className="info-tooltip">
      <button
        type="button"
        className="info-tooltip-trigger"
        aria-label={label ?? 'More information'}
        onClick={onClick}
      >
        ?
      </button>
      <span className="info-tooltip-bubble" role="tooltip">{text}</span>
    </span>
  );
}
