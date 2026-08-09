import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { MapPin, ClipboardPaste } from 'lucide-react';
import { toast } from 'sonner';
import { useToolLogger } from '@/hooks/use-tool-logger';
import {
  isValidChinaLngLat,
  lookupProvince,
  parseCoordinatePair,
  type CoordinateSystem,
} from '@/lib/china-province-utils';
import { copyToClipboard } from '@/lib/utils';

const EXAMPLES = [
  { label: '北京天安门', lng: '116.397428', lat: '39.90923' },
  { label: '上海外滩', lng: '121.490317', lat: '31.245094' },
  { label: '广州塔', lng: '113.32452', lat: '23.10647' },
  { label: '成都春熙路', lng: '104.081534', lat: '30.655835' },
  { label: '乌鲁木齐', lng: '87.617733', lat: '43.792818' },
];

export default function ProvinceLookup() {
  const log = useToolLogger('province-lookup');
  const [longitude, setLongitude] = useState('116.397428');
  const [latitude, setLatitude] = useState('39.90923');
  const [pairText, setPairText] = useState('');
  const [order, setOrder] = useState<'lng-lat' | 'lat-lng'>('lng-lat');
  const [coordinateSystem, setCoordinateSystem] = useState<CoordinateSystem>('gcj02');

  const result = useMemo(() => {
    const lng = Number(longitude);
    const lat = Number(latitude);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return { type: 'invalid' as const };
    if (!isValidChinaLngLat(lng, lat)) return { type: 'oor' as const, lng, lat };
    const hit = lookupProvince(lng, lat, coordinateSystem);
    if (!hit) {
      log.warn('未匹配到省级行政区', { lng, lat, coordinateSystem });
      return { type: 'miss' as const, lng, lat };
    }
    log.info('查询省份成功', { name: hit.name, adcode: hit.adcode, lng, lat });
    return { type: 'hit' as const, hit };
  }, [longitude, latitude, coordinateSystem, log]);

  const applyPair = () => {
    const parsed = parseCoordinatePair(pairText, order);
    if (!parsed) {
      toast.error('无法解析坐标，请使用如 116.4, 39.9 的格式');
      log.warn('坐标对解析失败', { pairText, order });
      return;
    }
    setLongitude(String(parsed.longitude));
    setLatitude(String(parsed.latitude));
    log.info('从文本填入坐标', parsed);
  };

  const pastePair = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setPairText(text.trim());
      const parsed = parseCoordinatePair(text, order);
      if (parsed) {
        setLongitude(String(parsed.longitude));
        setLatitude(String(parsed.latitude));
        toast.success('已从剪贴板填入坐标');
        log.info('从剪贴板填入坐标', parsed);
      } else {
        toast.message('已粘贴文本，请确认格式后点击解析');
      }
    } catch {
      toast.error('无法读取剪贴板');
    }
  };

  const outputText =
    result.type === 'hit'
      ? `${result.hit.name}\nadcode: ${result.hit.adcode}\n经度: ${result.hit.longitude}\n纬度: ${result.hit.latitude}\n坐标系: ${result.hit.coordinateSystem === 'gcj02' ? 'GCJ-02' : 'WGS-84'}`
      : '';

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-2xl space-y-8">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">经纬度查省份</h2>
          <p className="text-sm text-muted-foreground">
            输入中国范围内的经纬度，离线判断所属省级行政区（省 / 直辖市 / 自治区 / 特别行政区）。
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>经度 (Longitude)</Label>
            <Input
              type="number"
              step="any"
              value={longitude}
              onChange={(e) => setLongitude(e.target.value)}
              className="font-mono text-lg"
              placeholder="116.397428"
            />
          </div>
          <div className="space-y-2">
            <Label>纬度 (Latitude)</Label>
            <Input
              type="number"
              step="any"
              value={latitude}
              onChange={(e) => setLatitude(e.target.value)}
              className="font-mono text-lg"
              placeholder="39.90923"
            />
          </div>
        </div>

        <div className="space-y-3 rounded-lg border p-4">
          <Label>批量粘贴坐标对</Label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Input
              value={pairText}
              onChange={(e) => setPairText(e.target.value)}
              placeholder="116.397428, 39.90923"
              className="font-mono"
            />
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={pastePair}>
                <ClipboardPaste className="mr-2 h-4 w-4" />
                粘贴
              </Button>
              <Button type="button" onClick={applyPair}>
                解析
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-4">
            <div className="space-y-2">
              <Label>顺序</Label>
              <Select
                value={order}
                onChange={(e) => setOrder(e.target.value as 'lng-lat' | 'lat-lng')}
                options={[
                  { value: 'lng-lat', label: '经度, 纬度' },
                  { value: 'lat-lng', label: '纬度, 经度' },
                ]}
                className="w-44"
              />
            </div>
            <div className="space-y-2">
              <Label>坐标系</Label>
              <Select
                value={coordinateSystem}
                onChange={(e) => {
                  setCoordinateSystem(e.target.value as CoordinateSystem);
                  log.info(`切换坐标系: ${e.target.value}`);
                }}
                options={[
                  { value: 'gcj02', label: 'GCJ-02（国测局 / 国内地图）' },
                  { value: 'wgs84', label: 'WGS-84（GPS / 国际标准）' },
                ]}
                className="w-64"
              />
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label>示例</Label>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <Button
                key={ex.label}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setLongitude(ex.lng);
                  setLatitude(ex.lat);
                  setPairText(`${ex.lng}, ${ex.lat}`);
                  log.info('填入示例坐标', ex);
                }}
              >
                <MapPin className="mr-1.5 h-3.5 w-3.5" />
                {ex.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="rounded-lg border p-5">
          {result.type === 'invalid' && (
            <p className="text-sm text-muted-foreground">请输入有效的数字经纬度。</p>
          )}
          {result.type === 'oor' && (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              坐标 ({result.lng}, {result.lat}) 超出中国常用范围，请检查输入。
            </p>
          )}
          {result.type === 'miss' && (
            <p className="text-sm text-muted-foreground">
              未匹配到省级行政区。可能位于海域、境外，或边界简化导致遗漏；可尝试切换坐标系。
            </p>
          )}
          {result.type === 'hit' && (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">所属省级行政区</p>
                  <p className="mt-1 text-3xl font-semibold tracking-tight">{result.hit.name}</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    if (await copyToClipboard(outputText)) {
                      toast.success('已复制结果');
                    }
                  }}
                >
                  复制结果
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-md bg-muted/50 px-3 py-2">
                  <p className="text-xs text-muted-foreground">行政区划代码</p>
                  <p className="font-mono text-sm">{result.hit.adcode}</p>
                </div>
                <div className="rounded-md bg-muted/50 px-3 py-2">
                  <p className="text-xs text-muted-foreground">坐标系</p>
                  <p className="text-sm">
                    {result.hit.coordinateSystem === 'gcj02' ? 'GCJ-02' : 'WGS-84 → GCJ-02'}
                  </p>
                </div>
                <div className="rounded-md bg-muted/50 px-3 py-2">
                  <p className="text-xs text-muted-foreground">经度</p>
                  <p className="font-mono text-sm">{result.hit.longitude}</p>
                </div>
                <div className="rounded-md bg-muted/50 px-3 py-2">
                  <p className="text-xs text-muted-foreground">纬度</p>
                  <p className="font-mono text-sm">{result.hit.latitude}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">
          边界数据基于省级 GeoJSON 离线点面判断，已做几何简化，近边界处可能存在少量偏差。国内地图坐标多为
          GCJ-02；手机 GPS 通常为 WGS-84，请按来源选择坐标系。
        </p>
      </div>
    </div>
  );
}
