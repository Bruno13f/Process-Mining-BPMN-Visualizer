import { formatSecondsFull } from '@/utils/functions'
import { useTranslation } from 'react-i18next'

interface BpmnTimeConformanceActivityTooltipProps {
  activityName: string
  x: number
  y: number
  executionTime: number
  waitingTime: number
  realCycleTime: number
  estimatedCycleTime: number
  requiresPathSelection: boolean
}

const formatTime = (seconds: number | undefined) => {
  if (!Number.isFinite(seconds)) return 'N/A'

  return formatSecondsFull(seconds as number, false) || 'N/A'
}

export function BpmnTimeConformanceActivityTooltip({
  activityName,
  x,
  y,
  executionTime,
  waitingTime,
  realCycleTime,
  estimatedCycleTime,
  requiresPathSelection = false
}: BpmnTimeConformanceActivityTooltipProps) {
  const { t } = useTranslation()

  return (
    <div
      className="fixed z-50 bg-white border-1 border-[#808080] rounded-md pointer-events-none shadow-md"
      style={{
        left: `${x}px`,
        top: `${y - 10}px`,
        transform: 'translate(-50%, -100%)',
        minWidth: '260px',
        maxWidth: '380px'
      }}
    >
      <div className="text-base font-semibold mb-2 border-b border-[#808080] pb-1 px-3 pt-1">
        {activityName}
      </div>

      <div className="space-y-2 px-3 pb-3">
        {requiresPathSelection ? (
          <p className="text-sm text-black leading-snug">
            {t('timeConformanceTooltip.selectPathForBreakdown')}
          </p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1">
              <span className="text-sm font-medium text-black">{t('timeConformanceTooltip.realCycleTime')}</span>
              <div className="flex flex-wrap items-center gap-1.5 text-sm text-black">
                <span className="text-xs text-red-600 font-medium bg-red-100 px-2 py-0.5 mt-1 rounded whitespace-nowrap">
                  {formatTime(waitingTime)}
                </span>
                <span>+</span>
                <span className="text-xs text-red-600 font-medium bg-red-100 px-2 py-0.5 rounded whitespace-nowrap">
                  {formatTime(executionTime)}
                </span>
                <span>=</span>
                <span className="text-xs text-red-600 font-medium bg-red-100 px-2 py-0.5 rounded whitespace-nowrap">
                  {formatTime(realCycleTime)}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-black">{t('timeConformanceTooltip.estimatedCycleTime')}</span>
              <span className="text-xs text-red-600 font-medium bg-red-100 px-2 py-0.5 rounded shrink-0 whitespace-nowrap">
                {formatTime(estimatedCycleTime)}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
