import chinaProvinces from '@/data/china-provinces.json';

export interface ProvinceInfo {
  adcode: string;
  name: string;
  center?: [number, number];
}

export interface ProvinceLookupResult extends ProvinceInfo {
  longitude: number;
  latitude: number;
  coordinateSystem: CoordinateSystem;
}

export type CoordinateSystem = 'gcj02' | 'wgs84';

type Ring = [number, number][];
type Polygon = Ring[];
type MultiPolygon = Polygon[];

interface ProvinceFeature {
  adcode: string;
  name: string;
  center?: [number, number];
  coordinates: MultiPolygon;
}

const provinces = (chinaProvinces as { provinces: ProvinceFeature[] }).provinces;

/** 射线法：判断点是否在多边形环内（含边界近似） */
function pointInRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];

    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** GeoJSON 多边形：外环 + 可选内环（洞） */
function pointInPolygon(lng: number, lat: number, polygon: Polygon): boolean {
  if (!polygon.length || !pointInRing(lng, lat, polygon[0])) return false;
  for (let i = 1; i < polygon.length; i++) {
    if (pointInRing(lng, lat, polygon[i])) return false;
  }
  return true;
}

function pointInMultiPolygon(lng: number, lat: number, multi: MultiPolygon): boolean {
  return multi.some((polygon) => pointInPolygon(lng, lat, polygon));
}

/** WGS-84 → GCJ-02（省级边界数据为 GCJ-02） */
export function wgs84ToGcj02(lng: number, lat: number): [number, number] {
  if (outOfChina(lng, lat)) return [lng, lat];
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - 0.006693421622965943 * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat =
    (dLat * 180.0) /
    (((6378245.0 * (1 - 0.006693421622965943)) / (magic * sqrtMagic)) * Math.PI);
  dLng = (dLng * 180.0) / ((6378245.0 / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return [lng + dLng, lat + dLat];
}

function outOfChina(lng: number, lat: number): boolean {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(x: number, y: number): number {
  let ret =
    -100.0 +
    2.0 * x +
    3.0 * y +
    0.2 * y * y +
    0.1 * x * y +
    0.2 * Math.sqrt(Math.abs(x));
  ret +=
    ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret +=
    ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30.0)) * 2.0) /
    3.0;
  return ret;
}

function transformLng(x: number, y: number): number {
  let ret =
    300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret +=
    ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret +=
    ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) * 2.0) /
    3.0;
  return ret;
}

export function parseCoordinatePair(
  text: string,
  order: 'lng-lat' | 'lat-lng' = 'lng-lat'
): { longitude: number; latitude: number } | null {
  const cleaned = text.trim().replace(/[，、；;|/]/g, ',');
  const parts = cleaned
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length !== 2) return null;
  const a = Number(parts[0]);
  const b = Number(parts[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return order === 'lng-lat'
    ? { longitude: a, latitude: b }
    : { longitude: b, latitude: a };
}

export function isValidChinaLngLat(longitude: number, latitude: number): boolean {
  return (
    Number.isFinite(longitude) &&
    Number.isFinite(latitude) &&
    longitude >= 70 &&
    longitude <= 140 &&
    latitude >= 0 &&
    latitude <= 56
  );
}

/** 根据经纬度查询所属省级行政区（离线点面判断） */
export function lookupProvince(
  longitude: number,
  latitude: number,
  coordinateSystem: CoordinateSystem = 'gcj02'
): ProvinceLookupResult | null {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;

  const [lng, lat] =
    coordinateSystem === 'wgs84' ? wgs84ToGcj02(longitude, latitude) : [longitude, latitude];

  for (const province of provinces) {
    if (pointInMultiPolygon(lng, lat, province.coordinates)) {
      return {
        adcode: province.adcode,
        name: province.name,
        center: province.center,
        longitude,
        latitude,
        coordinateSystem,
      };
    }
  }
  return null;
}

export function getAllProvinceNames(): string[] {
  return provinces.map((p) => p.name);
}
