import { formatSecondsFull } from '@/utils/functions'
import { useTranslation } from 'react-i18next'

interface BpmnPerformanceTooltipProps {
  activityName: string
  x: number
  y: number
  average_time: number
  min_time: number
  max_time: number
  median_time: number
  event_count: number
  roles?: { role: string; frequency: number }[]
  onClickDetails?: () => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}

export function BpmnPerformanceTooltip({ activityName, x, y, average_time, min_time, max_time, median_time, event_count, roles, onClickDetails, onMouseEnter, onMouseLeave }: BpmnPerformanceTooltipProps) {
  const { t } = useTranslation()
  const isClickable = !!onClickDetails

  return (
    <div
      data-activity-tooltip="true"
      className={`fixed z-50 bg-white border-1 border-[#808080] rounded-md ${isClickable ? 'pointer-events-auto cursor-pointer' : 'pointer-events-none'}`}
      onMouseEnter={isClickable ? onMouseEnter : undefined}
      onMouseLeave={isClickable ? onMouseLeave : undefined}
      onClick={(event) => {
        if (!onClickDetails) return

        event.stopPropagation()
        onClickDetails()
      }}
      style={{
        left: `${x}px`,
        top: `${y - 10}px`,
        transform: 'translate(-50%, -100%)',
        minWidth: '200px',
        maxWidth: '300px'
      }}
    >
      <div className="text-base font-semibold mb-2 border-b border-[#808080] pb-1 px-3 pt-1">
        {activityName}
      </div>

      <div className="space-y-2 px-3 pb-3">
        <div className="flex items-center justify-start gap-2">
          <span className="text-sm font-medium text-black">{t('activityTooltip.averageTime')}</span>
          <span className="text-xs text-red-600 font-medium bg-red-100 px-2 py-0.5 rounded shrink-0 whitespace-nowrap">{event_count === 0 ? 'N/A' : formatSecondsFull(average_time, false)}</span>
        </div>
        <div className="flex items-center justify-start gap-2">
          <span className="text-sm font-medium text-black">{t('activityTooltip.medianTime')}</span>
          <span className="text-xs text-red-600 font-medium bg-red-100 px-2 py-0.5 rounded shrink-0 whitespace-nowrap">{event_count === 0 ? 'N/A' : formatSecondsFull(median_time, false)}</span>
        </div>
        <div className="flex items-center justify-start gap-2">
          <span className="text-sm font-medium text-black">{t('activityTooltip.minTime')}</span>
          <span className="text-xs text-red-600 font-medium bg-red-100 px-2 py-0.5 rounded shrink-0 whitespace-nowrap">{event_count === 0 ? 'N/A' : formatSecondsFull(min_time, false)}</span>
        </div>
        <div className="flex items-center justify-start gap-2">
          <span className="text-sm font-medium text-black">{t('activityTooltip.maxTime')}</span>
          <span className="text-xs text-red-600 font-medium bg-red-100 px-2 py-0.5 rounded shrink-0 whitespace-nowrap">{event_count === 0 ? 'N/A' : formatSecondsFull(max_time, false)}</span>
        </div>

        <div>
          <span className="text-sm font-medium mb-1 text-black">{t('activityTooltip.roles')}</span>
           <div className='space-y-1 ml-1'>
            {roles && roles.length > 0 ? (
              <>
                {roles.slice(0, 3).map((role, idx) => (
                  <div key={idx} className="flex items-center gap-2 justify-between">
                  <div className="flex items-center gap-2 min-w-0 mt-1">
                    <div className="w-2 h-2 bg-red-500 rounded-full shrink-0"></div>
                    <span className="text-sm text-black break-words max-w-[95%]">{role.role}</span>
                  </div>
                  <span className="text-xs text-red-600 font-medium bg-red-100 px-2 py-0.5 rounded shrink-0 whitespace-nowrap">{role.frequency}</span>
                </div>
                ))}
                {roles.length > 3 && (
                  <div className="text-xs italic text-zinc-500 mt-2">
                    {t('activityTooltip.seeMore', { count: roles.length - 3 })}
                  </div>
                )}
              </>
            ) : (
              <span className="text-sm text-black ml-1">{t('activityTooltip.noRoles')}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
