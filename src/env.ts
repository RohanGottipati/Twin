export const CESIUM_ION_TOKEN =
  process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN ?? "";

export function hasCesiumToken(): boolean {
  return CESIUM_ION_TOKEN.trim().length > 0;
}
