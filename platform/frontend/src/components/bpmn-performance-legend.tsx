
import { Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { DeviationTypeTooltip } from './deviation-type-tooltip'
import { DualRangeSlider } from './ui/dual-range-slider'
import { useEffect, useRef, useState } from 'react'
import { formatSecondsFull, formatSecondsHuman } from '../utils/functions'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import type { PerformanceActivityMetric } from '@/types/analysis-backend'

type PerformanceLegendActivityMetric = PerformanceActivityMetric[string] & {
  selected_sojourn?: number
}

interface BpmnPerformanceLegendProps {
  activitiesWithAvgTime: Record<string, PerformanceLegendActivityMetric>
  deviatedLanes: string[]
  frequencyFilter: [number, number]
  onFrequencyFilterChange: (filter: [number, number]) => void
  viewMode: 'model' | 'deviations'
  onViewModeChange: (mode: 'model' | 'deviations') => void
  limitsAvgTimeFlows: { min: number, max: number }
  metric: 'average' | 'median'
  onMetricChange: (metric: 'average' | 'median') => void
  hasDeviationData: boolean
}

export function BpmnPerformanceLegend({ activitiesWithAvgTime, deviatedLanes, frequencyFilter, onFrequencyFilterChange, viewMode, onViewModeChange, limitsAvgTimeFlows, metric, onMetricChange, hasDeviationData }: BpmnPerformanceLegendProps) {

  // Convert Record to array and sort by the active metric.
  const activitiesArray = Object.entries(activitiesWithAvgTime)
    .map(([activityName, metrics]) => {
      const selectedSojourn = Number.isFinite(metrics.selected_sojourn)
        ? metrics.selected_sojourn as number
        : metric === 'median'
          ? Number.isFinite(metrics.median_sojourn) ? metrics.median_sojourn : metrics.avg_sojourn
          : metrics.avg_sojourn

      return {
        activity: activityName,
        ...metrics,
        selected_sojourn: selectedSojourn
      }
    })
    .sort((a, b) => b.selected_sojourn - a.selected_sojourn)

  const { t, i18n } = useTranslation()

  const [localValues, setLocalValues] = useState(frequencyFilter)
  const timeoutRef = useRef<number | null>(null)

  useEffect(() => {
    setLocalValues(frequencyFilter)
  }, [frequencyFilter, limitsAvgTimeFlows, metric, viewMode])
  
  // Update local values immediately for visual feedback
  const handleFilterChange = (newValues: number[]) => {
    setLocalValues([newValues[0], newValues[1]])
  }

  // Update parent after slider commit, with a 500 ms debounce.
  const handleFilterCommit = (newValues: number[]) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    timeoutRef.current = setTimeout(() => {
      onFrequencyFilterChange([newValues[0], newValues[1]])
    }, 500)
  }

  return (
    <div className={`absolute top-2 left-2 z-10 w-[320px] max-w-[90vw] max-h-[calc(100%-1rem)] bg-white border-[#808080] rounded-md shadow-md border flex flex-col gap-y-2`}>
      <div className='h-fit flex flex-col items-start justify-center p-3 pb-4 gap-y-2'>
        <span className="text-lg font-medium">{t('tabs.viewOptions')}</span>
        <div className='flex flex-row items-center gap-2'>
          <button
            onClick={() => onViewModeChange('model')}
            className={`px-2 py-1 text-sm cursor-pointer rounded-lg transition-colors text-left flex items-center gap-2 ${
              viewMode === 'model'
                ? 'bg-gray-200 text-black font-medium border border-black'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {t('tabs.processModel')}
          </button>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <button
                  onClick={() => {
                    if (!hasDeviationData) return
                    onViewModeChange('deviations')
                  }}
                  disabled={!hasDeviationData}
                  className={`px-2 py-1 text-sm rounded-lg transition-colors text-left flex items-center gap-2 ${
                    !hasDeviationData
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : viewMode === 'deviations'
                        ? 'bg-gray-200 text-black font-medium border border-black cursor-pointer'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200 cursor-pointer'
                  }`}
                >
                  {t('tabs.deviations')}
                </button>
              </span>
            </TooltipTrigger>
            {!hasDeviationData && (
              <TooltipContent className="z-200 max-w-[260px]">
                <p>{t('legend.performanceDeviationsUnavailable')}</p>
              </TooltipContent>
            )}
          </Tooltip>
        </div>
      </div>
      
      <div className={`w-full flex flex-col gap-y-2 border-b border-[#808080] -mt-4 pt-0 p-3 pb-4`}>
        <span className="text-md font-medium">{t('tabs.metric')}</span>
        <div className="flex flex-row items-center gap-2">
          <button
            onClick={() => onMetricChange('average')}
            className={`px-2 py-1 text-sm cursor-pointer rounded-lg transition-colors text-left flex items-center gap-2 ${
              metric === 'average'
                ? 'bg-gray-200 text-black font-medium border border-black'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {t('tabs.average')}
          </button>
          <button
            onClick={() => onMetricChange('median')}
            className={`px-2 py-1 cursor-pointer text-sm rounded-lg transition-colors text-left flex items-center gap-2 ${
              metric === 'median'
                ? 'bg-gray-200 text-black font-medium border border-black'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {t('tabs.median')}
          </button>
        </div>
      </div>

      {viewMode === 'deviations' ? (
        <>
          <div className="w-full flex flex-col gap-y-2 shrink-0 px-3">
          <span className="text-lg font-medium">{t('deviations.legend')}</span>
          <div className="flex items-center gap-2">
            <div className={`${i18n.language == 'pt' ? 'min-w-[20%]' : 'min-w-[25%]'} min-h-8 border-2 border-black flex items-center justify-start`}
            style={{ backgroundColor: '#ffcfcf', borderColor: '#000000' }}>
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
            <div className={`${i18n.language == 'pt' ? 'min-w-[20%]' : 'min-w-[25%]'} min-h-8 rounded-md border-2 border-black flex items-center justify-center`}
            style={{ backgroundColor: '#ffcfcf', borderColor: '#ff0000' }}>
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
            <div className={`${i18n.language == 'pt' ? 'w-[20%]' : 'w-[25%]'} flex items-center justify-center`}>
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
            <div className={`${i18n.language == 'pt' ? 'max-w-[20%]' : 'max-w-[25%]'} flex items-center`}>
              <div className="w-16 h-0 rounded-md border border-black border-dashed border-1.5"
              style={{ borderColor: '#ff0000' }}/>
              <div className="w-0 h-0 border-l-4 border-t-2 border-b-2 border-transparent ml-0.5"
              style={{ borderLeftColor: '#ff0000' }}/>
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
          
          <div className="w-full flex flex-col gap-y-1 shrink-0 px-3">
            <span className="text-lg font-medium">{t('deviations.withDeviationsPerformance')}</span>
            <span className="text-sm font-medium mb-6">{t('deviations.withDeviationsPerformanceDescription')}</span>
            <DualRangeSlider
              label={(value) => value !== undefined ? formatSecondsHuman(value) : ''}
              value={localValues}
              onValueChange={handleFilterChange}
              onValueCommit={handleFilterCommit}
              min={limitsAvgTimeFlows.min}
              max={limitsAvgTimeFlows.max}
              step={1}
            />
            <span className='text-sm text-black mt-2'>{t('deviations.withDeviationsPerformanceNote')}</span>
          </div>

          <div className="w-full h-[14vh] min-h-0 flex flex-col gap-y-2 px-3">
            <div className='flex flex-row gap-x-2 items-center shrink-0'>
              <span className="text-lg font-medium">{t('deviations.unexpectedActivities')}</span>
              <div className="relative group">
                <Info className="h-3.5 w-3.5 cursor-pointer text-black" />
                <DeviationTypeTooltip type="unexpectedPerformance" />
              </div>
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
                  <div key={index} className="flex items-center gap-2 justify-between">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <div className="w-2 h-2 bg-red-500 rounded-full shrink-0"></div>
                      <span className="text-sm text-black break-words">{item.originalActivity || "No label"}</span>
                    </div>
                    <Tooltip key={index}>
                      <TooltipTrigger asChild>
                        <span className="text-xs text-red-600 font-medium bg-red-100 px-2 py-0.5 rounded shrink-0 hover:cursor-default">{formatSecondsHuman(item.selected_sojourn)}</span>
                      </TooltipTrigger>
                      <TooltipContent className="z-200">
                        <p>{formatSecondsFull(item.selected_sojourn, true)}</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                ))
              ) : (
                <span className="text-sm text-gray-500 italic">{t('deviations.noActivitiesFound')}</span>
              )}
            </div>
          </div>

          <div className="w-full flex-1 min-h-0 flex flex-col gap-y-2 px-3 pb-3">
            <div className='flex flex-row gap-x-2 items-center shrink-0'>
              <span className="text-lg font-medium">{t('deviations.unexpectedLanes')}</span>
              <div className="relative group">
                <Info className="h-3.5 w-3.5 cursor-pointer text-black" />
                <DeviationTypeTooltip type="unexpectedLanes" />
              </div>
            </div>
            <div 
              className="flex flex-col gap-2 flex-1 min-h-0 overflow-y-auto"
              style={{
                scrollbarWidth: 'thin',
                scrollbarColor: '#808080 #D8D8D8'
              }}
            >
              {deviatedLanes.length > 0 ? (
                deviatedLanes.map((item, index) => (
                  <div key={index} className={`flex items-center gap-2 justify-between ${index === deviatedLanes.length - 1 ? 'mb-2' : ''}`}>
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <div className="w-2 h-2 bg-red-500 rounded-full shrink-0"></div>
                      <span className="text-sm text-black break-words max-w-[90%]">{item || "No lane name"}</span>
                    </div>
                  </div>
                ))
              ) : (
                <span className="text-sm text-gray-500 italic">{t('deviations.noRolesFound')}</span>
              )}
            </div>
          </div>
        </>
        ) :
        <div className='pb-4'>
          <div className="w-full flex flex-col gap-y-2 px-3 pb-4">
            <div className="flex flex-row gap-x-2 items-center">
              <span className="text-lg font-medium">{t('legend.howItWorks')}</span>
            </div>
            <div className="text-sm text-black space-y-2">
              <p>
                <span className='text-sm text-black font-medium'>{t('legend.howItWorksLabelPerformance')}</span> {t('legend.howItWorksDescriptionPerformance')}
              </p>
              <p>
                <span className='text-sm text-black font-medium'>{t('legend.howItWorksExampleLabelPerformance')}</span> {t('legend.howItWorksExampleDescriptionPerformance')}
              </p>
            </div>
          </div>
          <div className="w-full h-[26vh] min-h-0 flex flex-col gap-y-2 px-3">
            <div className='flex flex-row gap-x-2 items-center shrink-0'>
              <span className="text-lg font-medium">{t('legend.modelActivities')}</span>
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
                  <div key={index} className="flex items-center gap-2 justify-between">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <div className="w-2 h-2 bg-red-500 rounded-full shrink-0"></div>
                      <span className="text-sm text-black break-words">{item.originalActivity || "No label"}</span>
                    </div>
                    {
                      item.event_count > 0 ? (
                        <Tooltip key={index}>
                          <TooltipTrigger asChild>
                            <span className="text-xs text-red-600 font-medium bg-red-100 px-2 py-0.5 rounded shrink-0 hover:cursor-default">{
                            formatSecondsHuman(item.selected_sojourn)}</span>
                          </TooltipTrigger>
                          <TooltipContent className="z-200">
                            <p>{formatSecondsFull(item.selected_sojourn, true)}</p>
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
                <span className="text-sm text-gray-500 italic">{t('deviations.noActivitiesFound')}</span>
              )}
            </div>
          </div>
        </div>
      }
    </div>
  )
}
