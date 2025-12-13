type Props = {
  className?: string;
};

/**
 * Official attribution lockup placement.
 * Ensure your usage matches Strava Brand Guidelines (logos, spacing, etc.):
 * https://developers.strava.com/
 */
export default function StravaAttribution({ className = '' }: Props) {
  return (
    <a
      href="https://www.strava.com"
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center ${className}`.trim()}
      aria-label="Powered by Strava"
    >
      <span className="sr-only">Powered by Strava</span>
      <img
        src="/strava/powered_by_strava_black.svg"
        alt="Powered by Strava"
        className="h-5 w-auto dark:hidden"
        loading="lazy"
      />
      <img
        src="/strava/powered_by_strava_white.svg"
        alt="Powered by Strava"
        className="hidden h-5 w-auto dark:block"
        loading="lazy"
      />
    </a>
  );
}


