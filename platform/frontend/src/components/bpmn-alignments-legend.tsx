import { Check, Info } from 'lucide-react'
import { MoveTypeTooltip } from './move-type-tooltip'
import { DeviationTypeTooltip } from './deviation-type-tooltip'
import { useTranslation } from 'react-i18next'
import type { PerformanceActivityMetric } from '@/types/analysis-backend'
import { formatSecondsHuman, formatSecondsFull } from '@/utils/functions'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

type AlignmentsLegendActivityMetric = PerformanceActivityMetric[string] & {
  selected_sojourn?: number
  cycle_time?: number
}

interface BpmnAlignmentsLegendProps {
  activitiesWithAvgTime: Record<string, AlignmentsLegendActivityMetric>,
  viewMode: 'alignments' | 'performance'
  onViewModeChange: (mode: 'alignments' | 'performance') => void
  subViewMode: 'moves' | 'conformance'
  onSubViewModeChange: (mode: 'moves' | 'conformance') => void
  timeConformanceView: 'model' | 'deviations'
  onTimeConformanceViewChange: (mode: 'model' | 'deviations') => void
  performanceMetric: 'average' | 'median'
  onPerformanceMetricChange: (metric: 'average' | 'median') => void
  hasTimeConformanceData: boolean
  selectedMoveTypes: {
    synchronous: boolean
    model: boolean
    log: boolean
  }
  onMoveTypeToggle: (moveType: 'synchronous' | 'model' | 'log') => void
}

export function BpmnAlignmentsLegend({
  activitiesWithAvgTime,
  viewMode,
  onViewModeChange,
  subViewMode,
  onSubViewModeChange,
  timeConformanceView,
  onTimeConformanceViewChange,
  performanceMetric,
  onPerformanceMetricChange,
  hasTimeConformanceData,
  selectedMoveTypes,
  onMoveTypeToggle
}: BpmnAlignmentsLegendProps) {
  const { t } = useTranslation()
  const isMovesSubView = subViewMode === 'moves'
  const isAlignmentsView = viewMode === 'alignments'
  const activitiesArray = Object.entries(activitiesWithAvgTime)
    .map(([activityName, metrics]) => {
      const selectedSojourn = Number.isFinite(metrics.selected_sojourn)
        ? metrics.selected_sojourn as number
        : performanceMetric === 'median'
          ? metrics.median_sojourn
          : metrics.avg_sojourn
      const cycleTime = Number.isFinite(metrics.cycle_time) && (metrics.cycle_time as number) > 0
        ? metrics.cycle_time as number
        : undefined

      return {
        activity: activityName,
        ...metrics,
        selected_sojourn: selectedSojourn,
        cycle_time: cycleTime
      }
    })
    .sort((a, b) => b.selected_sojourn - a.selected_sojourn)

  const renderEstimatedVsRealCycleTimeList = (className: string) => (
    <div className={className}>
      <div className='flex flex-row gap-x-2 items-center shrink-0'>
        <span className="text-lg font-medium">{t('legend.estimatedVsRealCycleTime')}</span>
      </div>
      <div
        className="flex flex-col gap-2 flex-1 min-h-0 overflow-y-auto pr-2"
        style={{
          scrollbarWidth: 'thin',
          scrollbarColor: '#808080 #D8D8D8'
        }}
      >
        {activitiesArray.length > 0 ? (
          activitiesArray.map((item, index) => (
            <div key={item.activity} className="flex items-center gap-2 justify-between">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <div className="w-2 h-2 bg-red-500 rounded-full shrink-0"></div>
                <span className="text-sm text-black break-words">{item.originalActivity || "No label"}</span>
              </div>
              {
                item.event_count > 0 ? (
                  <Tooltip key={index}>
                    <TooltipTrigger asChild>
                      <span className="flex items-center gap-1 shrink-0 hover:cursor-default">
                        <span className="text-xs text-red-600 font-medium bg-red-100 px-2 py-0.5 rounded whitespace-nowrap">
                          {Number.isFinite(item.cycle_time) && (item.cycle_time as number) > 0
                            ? formatSecondsHuman(item.cycle_time as number)
                            : 'N/A'}
                        </span>
                        <span className="text-xs text-black font-medium">vs</span>
                        <span className="text-xs text-red-600 font-medium bg-red-100 px-2 py-0.5 rounded whitespace-nowrap">
                          {formatSecondsHuman(item.selected_sojourn)}
                        </span>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="z-200">
                      <p>
                        {Number.isFinite(item.cycle_time) && (item.cycle_time as number) > 0
                          ? `${formatSecondsFull(item.cycle_time as number, true)} vs ${formatSecondsFull(item.selected_sojourn, true)}`
                          : `N/A vs ${formatSecondsFull(item.selected_sojourn, true)}`}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <span className="text-xs text-red-600 font-medium bg-red-100 px-2 py-0.5 rounded shrink-0 hover:cursor-default">
                    N/A
                  </span>
                )
              }
            </div>
          ))
        ) : (
          <span className="text-sm text-gray-500 italic">{t('deviations.noCTEntries')}</span>
        )}
      </div>
    </div>
  )

  return (
    <div className={`absolute top-2 left-2 z-10 w-[320px] max-w-[90vw] max-h-[calc(100%-1rem)] bg-white border-[#808080] rounded-md shadow-md border flex flex-col gap-y-2`}>
      
      <div className='w-full flex flex-col gap-y-2 p-3 pb-4'>
        <span className="text-lg font-medium">{t('legend.viewOptions')}</span>
        <div className="flex flex-row items-center gap-2">
          <button
            onClick={() => onViewModeChange('alignments')}
            className={`px-2 py-1 text-sm cursor-pointer rounded-lg transition-colors text-left flex items-center gap-2 ${
              isAlignmentsView
                ? 'bg-gray-200 text-black font-medium border border-black'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {t('legend.alignments')}
          </button>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <button
                  onClick={() => {
                    if (!hasTimeConformanceData) return
                    onViewModeChange('performance')
                  }}
                  disabled={!hasTimeConformanceData}
                  className={`px-2 py-1 text-sm rounded-lg transition-colors text-left flex items-center gap-2 ${
                    !hasTimeConformanceData
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : viewMode === 'performance'
                        ? 'bg-gray-200 text-black font-medium border border-black cursor-pointer'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200 cursor-pointer'
                  }`}
                >
                  {t('legend.timePerformance')}
                </button>
              </span>
            </TooltipTrigger>
            {!hasTimeConformanceData && (
              <TooltipContent className="z-200 max-w-[260px]">
                <p>{t('legend.timeConformanceUnavailable')}</p>
              </TooltipContent>
            )}
          </Tooltip>
        </div>
      </div>

      <div className={`w-full flex flex-col gap-y-2 border-b border-[#808080] -mt-4 pt-0 p-3 pb-4 ${isAlignmentsView ? '' : 'hidden'}`}>
        <span className="text-md font-medium">{t('legend.alignmentsView')}</span>
        <div className="flex flex-row items-center gap-2">
          <button
            onClick={() => onSubViewModeChange('conformance')}
            className={`px-2 py-1 text-sm cursor-pointer rounded-lg transition-colors text-left flex items-center gap-2 ${
              subViewMode === 'conformance'
                ? 'bg-gray-200 text-black font-medium border border-black'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {t('legend.overallConformance')}
          </button>
          <button
            onClick={() => onSubViewModeChange('moves')}
            className={`px-2 py-1 cursor-pointer text-sm rounded-lg transition-colors text-left flex items-center gap-2 ${
              subViewMode === 'moves'
                ? 'bg-gray-200 text-black font-medium border border-black'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {t('legend.moveDetails')}
          </button>
        </div>
      </div>

      <div className={`w-full flex flex-col gap-y-2 -mt-4 pt-0 p-3 pb-4 ${!isAlignmentsView ? '' : 'hidden'}`}>
        <span className="text-md font-medium">{t('legend.timeConformanceView')}</span>
        <div className="flex flex-row items-center gap-2">
          <button
            onClick={() => onTimeConformanceViewChange('model')}
            className={`px-2 py-1 text-sm cursor-pointer rounded-lg transition-colors text-left flex items-center gap-2 ${
              timeConformanceView === 'model'
                ? 'bg-gray-200 text-black font-medium border border-black'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {t('legend.timeConformanceViewModel')}
          </button>
          <button
            onClick={() => onTimeConformanceViewChange('deviations')}
            className={`px-2 py-1 cursor-pointer text-sm rounded-lg transition-colors text-left flex items-center gap-2 ${
              timeConformanceView === 'deviations'
                ? 'bg-gray-200 text-black font-medium border border-black'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {t('legend.timeConformanceViewDeviations')}
          </button>
        </div>
      </div>

      <div className={`w-full flex flex-col gap-y-2 border-b border-[#808080] -mt-4 pt-0 p-3 pb-4 ${!isAlignmentsView ? '' : 'hidden'}`}>
        <span className="text-md font-medium">{t('legend.timeConformanceMetric')}</span>
        <div className="flex flex-row items-center gap-2">
          <button
            onClick={() => onPerformanceMetricChange('average')}
            className={`px-2 py-1 text-sm cursor-pointer rounded-lg transition-colors text-left flex items-center gap-2 ${
              performanceMetric === 'average'
                ? 'bg-gray-200 text-black font-medium border border-black'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {t('legend.timeConformanceMetricAverage')}
          </button>
          <button
            onClick={() => onPerformanceMetricChange('median')}
            className={`px-2 py-1 cursor-pointer text-sm rounded-lg transition-colors text-left flex items-center gap-2 ${
              performanceMetric === 'median'
                ? 'bg-gray-200 text-black font-medium border border-black'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {t('legend.timeConformanceMetricMedian')}
          </button>
        </div>
      </div>

      <div className={`w-full flex flex-col gap-y-2 px-3 pb-4 ${isAlignmentsView && isMovesSubView ? '' : 'hidden'}`}>
        <span className="text-lg font-medium">{t('legend.moveTypes')}</span>
        <div className="flex flex-col gap-1">
          <button
            onClick={() => onMoveTypeToggle('synchronous')}
            className={`px-2 py-1 text-sm rounded-lg hover:cursor-pointer transition-colors text-left flex items-center gap-2 ${
              selectedMoveTypes.synchronous
                ? 'bg-green-100 border border-green-500 hover:bg-green-200'
                : 'bg-gray-50 border border-gray-300 hover:bg-gray-200'
            }`}
          >
            {selectedMoveTypes.synchronous ? (
              <Check className="w-4 h-4 text-green-600"/>
            ) : (
              <div className="w-4 h-4"></div>
            )}
            <span className={`font-medium flex flex-row items-center gap-2 ${
              selectedMoveTypes.synchronous ? 'text-zinc-800' : 'text-gray-500'
            }`}>
              {t('legend.synchronousMoves')}
              <div className="relative group">
                <Info className={`h-3.5 w-3.5 cursor-pointer ${selectedMoveTypes.synchronous ? 'text-black' : 'text-gray-500'}`} />
                <MoveTypeTooltip type="synchronous" />
              </div>
            </span>
          </button>
          <button
            onClick={() => onMoveTypeToggle('model')}
            className={`px-2 py-1 text-sm rounded-lg hover:cursor-pointer transition-colors text-left flex items-center gap-2 ${
              selectedMoveTypes.model
                ? 'bg-blue-100 border border-blue-800 hover:bg-blue-200'
                : 'bg-gray-50 border border-gray-300 hover:bg-gray-200'
            }`}
          >
            {selectedMoveTypes.model ? (
              <Check className="w-4 h-4 text-blue-800"/>
            ) : (
              <div className="w-4 h-4"></div>
            )}
            <span className={`font-medium flex flex-row items-center gap-2 ${selectedMoveTypes.model ? 'text-zinc-800' : 'text-gray-500'}`}>
              {t('legend.modelMoves')}
              <div className="relative group">
                <Info className={`h-3.5 w-3.5 cursor-pointer ${selectedMoveTypes.model ? 'text-black' : 'text-gray-500'}`} />
                <MoveTypeTooltip type="model" />
              </div>
            </span>
          </button>
          <button
            onClick={() => onMoveTypeToggle('log')}
            className={`px-2 py-1 text-sm rounded-lg hover:cursor-pointer transition-colors text-left flex items-center gap-2 ${
              selectedMoveTypes.log
                ? 'bg-purple-100 border border-purple-600 hover:bg-purple-200'
                : 'bg-gray-50 border border-gray-300 hover:bg-gray-200'
            }`}
          >
            {selectedMoveTypes.log ? (
              <Check className="w-4 h-4 text-purple-600"/>
            ) : (
              <div className="w-4 h-4"></div>
            )}
            <span className={`font-medium flex flex-row items-center gap-2 ${
              selectedMoveTypes.log ? 'text-zinc-800' : 'text-gray-500'
            }`}>
              {t('legend.logMoves')}
              <div className="relative group">
                <Info className={`h-3.5 w-3.5 ${selectedMoveTypes.log ? 'text-black' : 'text-gray-500'}`} />
                <MoveTypeTooltip type="log" />
              </div>
            </span>
          </button>
        </div>
      </div>

      <div className={`w-full flex flex-col gap-y-2 px-3 pb-4 ${isAlignmentsView && !isMovesSubView ? '' : 'hidden'}`}>
        <span className="text-lg font-medium">{t('legend.howItWorks')}</span>
        <div className="text-sm text-black space-y-2">
          <p>{t('legend.qualityScoreDesc')}</p>
          <p>
            <span className="text-sm text-green-500 font-medium">{t('legend.conformantMoves')}</span> {t('legend.conformantMovesDesc')}
          </p>
          <p>
            <span className="text-sm text-red-500 font-medium">{t('legend.nonConformantMoves')}</span> {t('legend.nonConformantMovesDesc')}
          </p>
        </div>
      </div>

      <div className={`w-full min-h-0 flex-col gap-y-3 px-3 pb-4 ${isAlignmentsView ? 'hidden' : 'flex'}`}>
        {timeConformanceView === 'deviations' ? (
          <>
            <div className="w-full flex flex-col gap-y-2 shrink-0">
              <span className="text-lg font-medium">{t('legend.howItWorks')}</span>
              <div className="text-sm text-black space-y-2">
                <p>
                  <span className="text-sm font-medium">
                    {t(performanceMetric === 'median'
                      ? 'legend.performanceConformanceMedianTime'
                      : 'legend.performanceConformanceAverageTime'
                    )}
                  </span> {t('legend.performanceConformanceAverageTimeDesc')}
                </p>
                <p>
                  <span className="text-sm font-medium">{t('legend.performanceConformanceCycleTime')}</span> {t('legend.performanceConformanceCycleTimeDesc')}
                </p>
                <p>
                  <span className="text-sm font-medium">{t('legend.performanceConformanceTotalTime')}</span> {t('legend.performanceConformanceTotalTimeDesc')}
                </p>
                <p>
                  <span className="text-sm font-medium">{t('legend.performanceConformanceInteraction')}</span> {t('legend.performanceConformanceInteractionDesc')}
                </p>
              </div>
            </div>
            <div className="w-full flex flex-col gap-y-2 shrink-0">
              <span className="text-lg font-medium">{t('deviations.legend')}</span>
              <div className="flex items-center gap-2">
                <div
                  className="min-w-[25%] min-h-8 border-2 border-black flex items-center justify-start"
                  style={{ backgroundColor: '#ffcfcf', borderColor: '#000000' }}
                >
                  <span className="text-[10px] text-black font-normal" style={{ writingMode: 'sideways-lr' }}>{t('deviations.label')}</span>
                </div>
                <span className="text-sm text-black font-medium flex flex-row items-center gap-2">
                  {t('deviations.unexpectedLanes')}
                  <div className="relative group">
                    <Info className="h-3.5 w-3.5 cursor-pointer text-black" />
                    <DeviationTypeTooltip type="lanes" />
                  </div>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div
                  className="min-w-[25%] min-h-8 rounded-md border-2 border-black flex items-center justify-center"
                  style={{ backgroundColor: '#ffcfcf', borderColor: '#ff0000' }}
                >
                  <span className="text-xs text-black font-normal">{t('deviations.label')}</span>
                </div>
                <span className="text-sm text-black font-medium flex flex-row items-center gap-2">
                  {t('deviations.unexpectedActivities')}
                  <div className="relative group">
                    <Info className="h-3.5 w-3.5 cursor-pointer text-black" />
                    <DeviationTypeTooltip type="activities" />
                  </div>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-[25%] flex items-center justify-center">
                  <div className="w-8 h-8 rounded-full bg-white border-2 border-red-500 shrink-0" aria-hidden="true" />
                </div>
                <span className="text-sm text-black font-medium flex flex-row items-center gap-2">
                  {t('deviations.unexpectedEndEvent')}
                  <div className="relative group">
                    <Info className="h-3.5 w-3.5 cursor-pointer text-black" />
                    <DeviationTypeTooltip type="endEvent" />
                  </div>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="max-w-[25%] flex items-center">
                  <div className="w-16 h-0 rounded-md border border-black border-dashed border-1.5" style={{ borderColor: '#ff0000' }}/>
                  <div className="w-0 h-0 border-l-4 border-t-2 border-b-2 border-transparent ml-0.5" style={{ borderLeftColor: '#ff0000' }}/>
                </div>
                <span className="text-sm text-black font-medium flex flex-row items-center gap-2">
                  {t('deviations.unexpectedFlow')}
                  <div className="relative group">
                    <Info className="h-3.5 w-3.5 cursor-pointer text-black" />
                    <DeviationTypeTooltip type="flow" />
                  </div>
                </span>
              </div>
            </div>
          </>
        ) : (
          <>
            <span className="text-lg font-medium">{t('legend.howItWorks')}</span>
            <div className="text-sm text-black space-y-2">
              <p>
                <span className="text-sm font-medium">
                  {t(performanceMetric === 'median'
                    ? 'legend.performanceConformanceMedianTime'
                    : 'legend.performanceConformanceAverageTime'
                  )}
                </span> {t('legend.performanceConformanceAverageTimeDesc')}
              </p>
              <p>
                <span className="text-sm font-medium">{t('legend.performanceConformanceCycleTime')}</span> {t('legend.performanceConformanceCycleTimeDesc')}
              </p>
              <p>
                <span className="text-sm font-medium">{t('legend.performanceConformanceTotalTime')}</span> {t('legend.performanceConformanceTotalTimeDesc')}
              </p>
              <p>
                <span className="text-sm font-medium">{t('legend.performanceConformanceInteraction')}</span> {t('legend.performanceConformanceInteractionDesc')}
              </p>
            </div>
            {renderEstimatedVsRealCycleTimeList('w-full h-[20vh] min-h-0 flex flex-col gap-y-2')}
          </>
        )}
      </div>

    </div>
  )
}
