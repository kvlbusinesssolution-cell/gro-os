/**
 * Static OpenStreetMap iframe embed — no API key/billing required (unlike
 * Google Maps Embed), fine for the marker-pin use case this needs. A ~1.5km
 * box around the pin gives enough surrounding street context without being
 * so zoomed out the marker is meaningless.
 */
export function MapEmbed({ latitude, longitude, label }: { latitude: number; longitude: number; label: string }) {
  const delta = 0.01;
  const bbox = `${longitude - delta},${latitude - delta},${longitude + delta},${latitude + delta}`;
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${latitude},${longitude}`;

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <iframe title={`Map showing ${label}`} src={src} className="h-64 w-full" loading="lazy" />
    </div>
  );
}
