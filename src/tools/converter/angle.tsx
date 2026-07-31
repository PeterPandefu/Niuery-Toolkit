import { useState, useMemo } from 'react';
import { ToolLayout } from '@/components/shared/ToolLayout';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { toDegrees, fromDegrees, formatAngle, type AngleUnit } from '@/lib/converter-utils';

const UNIT_LABELS: Record<AngleUnit, string> = {
  degree: '度 (°)',
  radian: '弧度 (rad)',
  gradian: '梯度 (gon)',
  turn: '圈 (turn)',
};

const FORMULAS: Record<AngleUnit, string> = {
  degree: '基准单位',
  radian: 'rad = deg × π / 180',
  gradian: 'gon = deg × 10 / 9',
  turn: 'turn = deg / 360',
};

export default function AngleTool() {
  const [inputValue, setInputValue] = useState('90');
  const [fromUnit, setFromUnit] = useState<AngleUnit>('degree');
  const [toUnit, setToUnit] = useState<AngleUnit>('radian');

  const result = useMemo(() => {
    const num = parseFloat(inputValue);
    if (isNaN(num)) return null;
    const degrees = toDegrees(num, fromUnit);
    return fromDegrees(degrees, toUnit);
  }, [inputValue, fromUnit, toUnit]);

  const allConversions = useMemo(() => {
    const num = parseFloat(inputValue);
    if (isNaN(num)) return null;
    const degrees = toDegrees(num, fromUnit);
    return {
      degree: fromDegrees(degrees, 'degree'),
      radian: fromDegrees(degrees, 'radian'),
      gradian: fromDegrees(degrees, 'gradian'),
      turn: fromDegrees(degrees, 'turn'),
    };
  }, [inputValue, fromUnit]);

  const formatNumber = formatAngle;

  return (
    <ToolLayout
      inputTitle="输入角度"
      outputTitle="转换结果"
      outputValue={result !== null ? formatNumber(result) : ''}
      onClear={() => setInputValue('')}
      input={
        <div className="flex h-full flex-col gap-4 p-4">
          <div className="space-y-2">
            <Label>数值</Label>
            <Input
              type="number"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="输入角度值..."
              className="font-mono"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>从</Label>
              <Select
                value={fromUnit}
                onChange={(e) => setFromUnit(e.target.value as AngleUnit)}
                options={Object.entries(UNIT_LABELS).map(([value, label]) => ({ value, label }))}
              />
            </div>
            <div className="space-y-2">
              <Label>到</Label>
              <Select
                value={toUnit}
                onChange={(e) => setToUnit(e.target.value as AngleUnit)}
                options={Object.entries(UNIT_LABELS).map(([value, label]) => ({ value, label }))}
              />
            </div>
          </div>

          {/* 公式预览 */}
          <div className="rounded-md border bg-muted/50 p-3">
            <p className="text-xs font-medium text-muted-foreground mb-1">转换公式</p>
            <p className="text-sm font-mono">{FORMULAS[toUnit]}</p>
          </div>

          {/* 滑块可视化 */}
          <div className="space-y-2">
            <Label>可视化 (0° - 360°)</Label>
            <input
              type="range"
              min="0"
              max="360"
              step="1"
              value={
                allConversions
                  ? ((allConversions.degree % 360) + 360) % 360
                  : 0
              }
              onChange={(e) => {
                const deg = parseFloat(e.target.value);
                setInputValue(formatNumber(fromDegrees(deg, fromUnit)));
              }}
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>0°</span>
              <span>90°</span>
              <span>180°</span>
              <span>270°</span>
              <span>360°</span>
            </div>
          </div>
        </div>
      }
      output={
        <div className="flex h-full flex-col gap-4 p-4">
          {result !== null ? (
            <div className="rounded-md border bg-muted/50 p-4">
              <p className="text-2xl font-mono font-bold text-primary">
                {formatNumber(result)}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {UNIT_LABELS[toUnit]}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">输入有效数值查看结果</p>
          )}

          {/* 所有单位转换 */}
          {allConversions && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">所有单位</p>
              <div className="space-y-1">
                {(Object.entries(allConversions) as [AngleUnit, number][]).map(([unit, val]) => (
                  <div
                    key={unit}
                    className={`flex items-center justify-between rounded-md px-3 py-2 text-sm ${
                      unit === toUnit ? 'bg-primary/10 font-medium' : 'bg-muted/30'
                    }`}
                  >
                    <span className="text-muted-foreground">{UNIT_LABELS[unit]}</span>
                    <span className="font-mono">{formatNumber(val)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 常见角度参考 */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">常见角度</p>
            <div className="flex flex-wrap gap-1.5">
              {[0, 30, 45, 60, 90, 120, 135, 150, 180, 270, 360].map((deg) => (
                <button
                  key={deg}
                  onClick={() => setInputValue(formatNumber(fromDegrees(deg, fromUnit)))}
                  className="rounded-md border px-2 py-1 text-xs hover:bg-accent transition-colors"
                >
                  {deg}°
                </button>
              ))}
            </div>
          </div>
        </div>
      }
    />
  );
}
