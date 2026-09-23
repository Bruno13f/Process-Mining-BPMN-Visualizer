import { type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next';

interface BpmnFrequencyHeatmapProps {
  limitsFrequencyActivities: { min: number, max: number }
}

export function BpmnFrequencyHeatmap({ limitsFrequencyActivities }: BpmnFrequencyHeatmapProps) {

  const { t } = useTranslation()

  return (
    <div className={
      'absolute top-2 right-2 z-10 min-w-[320px] max-w-[600px] max-h-[calc(100%-1rem)] bg-white border-[#808080] rounded-md shadow-md border flex items-center justify-center px-3 py-3'
    }>
      <div className="w-full flex flex-col items-start">
        <span className="text-lg font-medium mb-2">{t('heatmapTooltip.titleFrequency')}</span>
        <div className="w-full h-4 rounded-xl flex overflow-hidden relative mb-2">
          {[0,1,2,3,4].map(i => (
            <div
              key={i}
              className="flex-1 h-4"
              style={{
                background: `linear-gradient(to right, rgba(4,90,141,${0.2 + 0.2*i}), rgba(4,90,141,${0.2 + 0.2*(i+1)}))`
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
            const min = limitsFrequencyActivities.min;
            const max = limitsFrequencyActivities.max;
            if (min === max) {
              return [0, 0.2, 0.4, 0.6, 0.8, 1].map((pos, i) => {
                const style: CSSProperties = {
                  position: 'absolute',
                  left: `calc(${pos*100}% - 12px)`
                };
                return <span key={i} style={style} className="text-xs text-gray-600">{Math.floor(min)}</span>;
              });
            }
            const step = (max - min) / 5;
            return [0,1,2,3,4,5].map(i => {
              const value = Math.floor(min + i * step);
              let style: CSSProperties = {
                position: 'absolute',
                left: `calc(${i*20}% - 12px)`,
                textAlign: 'center',
                width: '24px'
              };
              if (i === 0) style = { ...style, left: 0, textAlign: 'left' };
              if (i === 5) style = { ...style, left: 'calc(100% - 24px)', textAlign: 'right' };
              return (
                <span key={i} style={style} className="text-xs text-gray-600">{value}</span>
              );
            });
          })()}
        </div>
      </div>
    </div>
  )
}
