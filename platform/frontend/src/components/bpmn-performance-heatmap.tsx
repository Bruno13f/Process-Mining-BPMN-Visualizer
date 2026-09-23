import { type CSSProperties } from 'react'
import { formatSecondsFull, formatSecondsHuman } from '../utils/functions'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { useTranslation } from 'react-i18next';

interface BpmnPerformanceHeatmapProps {
  limitsSelectedSojournTimeActivities: { min: number, max: number }
  activeMetric: 'average' | 'median'
}

export function BpmnPerformanceHeatmap({ limitsSelectedSojournTimeActivities, activeMetric }: BpmnPerformanceHeatmapProps) {

  const { t } = useTranslation()

  return (
    <div className={
      'absolute top-2 right-2 z-10 min-w-[320px] max-w-[600px] max-h-[calc(100%-1rem)] bg-white border-[#808080] rounded-md shadow-md border flex flex-col gap-y-2 items-center justify-center px-3 py-3'
    }>
      <div className="w-full flex flex-col items-start">
        <span className="text-lg font-medium mb-2">
          {activeMetric === 'average' ? t('heatmapTooltip.titleAveragePerformance') : t('heatmapTooltip.titleMedianPerformance')}
        </span>
        <div className="w-full h-4 rounded-xl flex overflow-hidden relative mb-2">
          {[0,1,2,3,4].map(i => (
            <div
              key={i}
              className="flex-1 h-4"
              style={{
                background: `linear-gradient(to right, rgba(255, 0, 0, ${0.2 + 0.2*i}), rgba(255, 0, 0, ${0.2 + 0.2*(i+1)}))`
              }}
            />
          ))}
          {[1,2,3,4].map(i => (
            <div
              key={i}
              className="absolute top-0 bottom-0 w-0.5"
              style={{
                left: `${(i*20)}%`,
                background: '#FFFFFF',
                opacity: 1
              }}
            />
          ))}
        </div>
        <div className="relative w-full h-5 mt-1">
          {(() => {
            const min = limitsSelectedSojournTimeActivities.min;
            const max = limitsSelectedSojournTimeActivities.max;
            if (min === max) {
              return [0, 0.2, 0.4, 0.6, 0.8, 1].map((pos, i) => {
                const style: CSSProperties = {
                  position: 'absolute',
                  left: `calc(${pos*100}% - 12px)`
                };
                return <span key={i} style={style} className="text-xs text-gray-600">{formatSecondsHuman(min)}</span>;
              });
            }
            const step = (max - min) / 5;
            return [0,1,2,3,4,5].map(i => {
              const value = min + i * step;
              let style: CSSProperties = {
                position: 'absolute',
                left: `calc(${i*20}% - 18px)`,
                textAlign: 'center',
                width: '36px'
              };
              if (i === 0) style = { ...style, left: 0, textAlign: 'left' };
              if (i === 5) style = { ...style, left: 'calc(100% - 36px)', textAlign: 'right' };
              return (
                <Tooltip key={i}>
                  <TooltipTrigger asChild>
                    <span key={i} style={style} className="text-xs text-gray-600 hover:cursor-default">{formatSecondsHuman(value)}</span>
                  </TooltipTrigger>
                  <TooltipContent className="z-200">
                    <p>{formatSecondsFull(value, true)}</p>
                  </TooltipContent>
                </Tooltip>
              );
            });
          })()}
        </div>
      </div>
    </div>
  )
}
