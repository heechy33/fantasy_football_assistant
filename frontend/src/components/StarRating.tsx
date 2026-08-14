import { memo } from 'react';

export interface StarRatingProps {
  label: 'Upside' | 'Bust' | 'SOS';
  value: number | null;
}

const STAR_PATH = 'M12 2.5l2.9 5.88 6.49.94-4.7 4.58 1.11 6.47L12 17.77l-5.8 3.05 1.11-6.47-4.7-4.58 6.49-.94L12 2.5z';

function ariaLabel(label: StarRatingProps['label'], value: number | null): string {
  if (value == null) return `${label}: not published`;
  return `${label}: ${value} out of 5`;
}

export const StarRating = memo(function StarRating({ label, value }: StarRatingProps) {
  const filledCount = value == null ? 0 : Math.max(0, Math.min(5, value));
  return (
    <div className="star-rating">
      <span className="star-rating-name">{label}</span>
      <span className="star-rating-stars" role="img" aria-label={ariaLabel(label, value)}>
        {Array.from({ length: 5 }, (_, index) => {
          const filled = index < filledCount;
          return (
            <svg
              key={index}
              className={filled ? 'star-icon star-filled' : 'star-icon star-hollow'}
              viewBox="0 0 24 24"
              width="14"
              height="14"
              aria-hidden="true"
              focusable="false"
            >
              <path d={STAR_PATH} />
            </svg>
          );
        })}
      </span>
    </div>
  );
});
