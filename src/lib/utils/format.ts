export function formatCameraHeight(height: number): string {
  if (!Number.isFinite(height)) {
    return "--";
  }

  const absolute = Math.abs(height);

  if (absolute >= 1000) {
    const km = height / 1000;
    return `${km.toLocaleString(undefined, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    })} km`;
  }

  return `${Math.round(height).toLocaleString()} m`;
}

export function formatCoordinate(value: number): string {
  if (!Number.isFinite(value)) {
    return "--";
  }
  return value.toFixed(4);
}

export function formatLatLon(
  latitude: number,
  longitude: number
): string {
  return `${formatCoordinate(latitude)}, ${formatCoordinate(longitude)}`;
}
