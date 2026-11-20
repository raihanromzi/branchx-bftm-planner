"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { MapContainer, Marker, TileLayer } from "react-leaflet";

// The static mini map on the Prospect detail (E2-S4): one marker, no panning or zooming. Leaflet touches
// `window`, so the detail page loads this module on the client only (next/dynamic with ssr: false).
// The OpenStreetMap credit is a real link in the caption under the map (prospect-detail-screen.tsx), not
// Leaflet's 11 px control: the map is an image to assistive tech (role="img"), so a control inside it could
// not be reached, and it would be smaller than a touch target.

const ZOOM = 16;

/** The same 28 px accent pin as the location picker (E2-S3). */
const markerIcon = L.divIcon({
  className: "",
  html: '<span class="block size-7 -translate-y-5 rounded-full rounded-br-none rotate-45 border-2 border-background bg-primary shadow-md"></span>',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

export default function ProspectMiniMap({ lat, lng }: { lat: number; lng: number }) {
  return (
    <MapContainer
      center={[lat, lng]}
      zoom={ZOOM}
      dragging={false}
      touchZoom={false}
      doubleClickZoom={false}
      scrollWheelZoom={false}
      boxZoom={false}
      keyboard={false}
      zoomControl={false}
      attributionControl={false}
      className="size-full"
    >
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        maxZoom={19}
      />
      <Marker position={[lat, lng]} icon={markerIcon} interactive={false} keyboard={false} alt="" />
    </MapContainer>
  );
}
