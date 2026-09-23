import { useTranslation } from 'react-i18next'

interface BpmnFrequencyFlowTooltipProps {
  elementId: string, 
  x: number,
  y: number,
  frequency?: number, 
  paths?: Record<string, number>
}

export function BpmnFrequencyFlowTooltip({ elementId, x, y, frequency, paths }: BpmnFrequencyFlowTooltipProps) {
  const { t } = useTranslation()
  const formatPathLabel = (label: string) => label
    .replace(/\u00e2\u017e\u0153/g, '→')
    .replace(/âžœ/g, '→')

  return (
    <div
      className="fixed z-50 bg-white border-1 border-[#808080] rounded-md pointer-events-none w-fit max-w-[400px]"
      style={{
        left: `${x}px`,
        top: `${y - 10}px`,
        transform: 'translate(-50%, -100%)',
      }}
    >
      <div className="text-base font-semibold mb-2 border-b border-[#808080] pb-1 px-3 pt-1">
        {elementId}
      </div>

      <div className="space-y-2 px-3 pb-3">
        <div className="flex items-center justify-start gap-2 items-center">
          <span className="text-sm font-medium text-black">{t('frequencyFlowTooltip.flowFrequency')}</span>
          <span className="text-xs text-red-600 font-medium bg-red-100 px-2 py-0.5 rounded shrink-0 whitespace-nowrap">{frequency ? frequency : '0'}</span>
        </div>
        <div>
          <span className="text-sm font-medium mb-1 text-black">{t('frequencyFlowTooltip.flows')}</span>
          <div className='space-y-1 ml-1'>
            {paths && Object.keys(paths).length > 0 ? (
              Object.entries(paths)
                .sort(([, freqA], [, freqB]) => freqB - freqA)
                .map(([key, value]) => (
                  <div key={key} className="flex items-center gap-2 justify-between">
                    <div className="flex items-center gap-2 min-w-0 mt-1">
                      <div className="w-2 h-2 bg-red-500 rounded-full shrink-0"></div>
                      <span className="text-sm text-black break-words max-w-[95%]">{formatPathLabel(key)}</span>
                    </div>
                    <span className="text-xs text-red-600 font-medium bg-red-100 px-2 py-0.5 rounded shrink-0 whitespace-nowrap">{value}</span>
                  </div>
                ))
            ) : (
              <span className="text-sm px-2 py-0.5">{t('frequencyFlowTooltip.noPaths')}</span>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
