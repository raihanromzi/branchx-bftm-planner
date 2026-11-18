"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useMemo, useRef } from "react";
import { AttributionControl, MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";

// The map inside the Prospect form's location picker (E2-S3). Leaflet touches `window`, so the form loads
// this module on the client only (next/dynamic with ssr: false). OpenStreetMap tiles; one draggable marker.

/** Jabodetabek, the team's area: the view before a location is set. */
const DEFAULT_BOUNDS: L.LatLngBoundsExpression = [
  [-6.75, 106.45],
  [-6.05, 107.2],
];
/** Street level, so a tap lands on the right building. */
const LOCATION_ZOOM = 17;

/**
 * The marker: a 28 px pin drawn with the accent token, instead of Leaflet's default image icon (whose
 * image paths break under a bundler). Decorative for screen readers: the coordinate line says where it is.
 */
const markerIcon = L.divIcon({
  className: "",
  html: '<span class="block size-7 -translate-y-5 rounded-full rounded-br-none rotate-45 border-2 border-background bg-primary shadow-md"></span>',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

export type LocationPickerMapProps = {
  value: { lat: number; lng: number } | null;
  /** Bumped when the location comes from GPS or the coordinate inputs: the map moves to it. */
  recenterKey: number;
  onPick: (lat: number, lng: number) => void;
  label: string;
};

export default function LocationPickerMap({ value, recenterKey, onPick, label }: LocationPickerMapProps) {
  return (
    <MapContainer
      bounds={value ? undefined : DEFAULT_BOUNDS}
      center={value ? [value.lat, value.lng] : undefined}
      zoom={value ? LOCATION_ZOOM : undefined}
      scrollWheelZoom={false}
      attributionControl={false}
      className="size-full"
      // Leaflet makes the map's box focusable (arrow keys pan it); give that box a name.
      ref={(map) => {
        map?.getContainer().setAttribute("aria-label", label);
      }}
    >
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        maxZoom={19}
      />
      <AttributionControl prefix={false} />
      <TapToPick onPick={onPick} />
      <Recenter value={value} recenterKey={recenterKey} />
      {value && <DraggableMarker position={value} onPick={onPick} />}
    </MapContainer>
  );
}

function TapToPick({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(event) {
      onPick(event.latlng.lat, event.latlng.lng);
    },
  });
  return null;
}

function Recenter({ value, recenterKey }: { value: { lat: number; lng: number } | null; recenterKey: number }) {
  const map = useMap();
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  });
  useEffect(() => {
    if (recenterKey === 0) return;
    const current = valueRef.current;
    if (current) map.setView([current.lat, current.lng], Math.max(map.getZoom(), LOCATION_ZOOM));
  }, [recenterKey, map]);
  return null;
}

function DraggableMarker({
  position,
  onPick,
}: {
  position: { lat: number; lng: number };
  onPick: (lat: number, lng: number) => void;
}) {
  const handlers = useMemo<L.LeafletEventHandlerFnMap>(
    () => ({
      dragend(event) {
        const { lat, lng } = (event.target as L.Marker).getLatLng();
        onPick(lat, lng);
      },
    }),
    [onPick],
  );
  return (
    <Marker
      position={[position.lat, position.lng]}
      icon={markerIcon}
      draggable
      keyboard={false}
      eventHandlers={handlers}
      alt=""
    />
  );
}
