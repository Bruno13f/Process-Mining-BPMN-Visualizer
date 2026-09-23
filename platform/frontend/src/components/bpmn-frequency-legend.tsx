
import { Info } from 'lucide-react'
import { DeviationTypeTooltip } from './deviation-type-tooltip'
import { useTranslation } from 'react-i18next'
import { DualRangeSlider } from './ui/dual-range-slider'
import { useState, useEffect, useRef } from 'react'
import type { FrequencyActivityMetric } from '@/types/analysis-backend'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

interface BpmnFrequencyLegendProps {
  activitiesWithFrequency: FrequencyActivityMetric
  deviatedLanes: string[]
  frequencyFilter: [number, number]
  onFrequencyFilterChange: (filter: [number, number]) => void
  viewMode: 'model' | 'deviations'
  onViewModeChange: (mode: 'model' | 'deviations') => void
  limitsFrequencyFlows: { min: number, max: number }
  hasDeviationData: boolean
  isLoading?: boolean
}

export function BpmnFrequencyLegend({ activitiesWithFrequency, deviatedLanes, frequencyFilter, onFrequencyFilterChange, viewMode, onViewModeChange, limitsFrequencyFlows, hasDeviationData, isLoading = false }: BpmnFrequencyLegendProps) {

  const { t, i18n } = useTranslation()
  
  // Convert Record to array and sort by frequency.
  const activitiesArray = Object.entries(activitiesWithFrequency)
    .map(([activityName, metrics]) => ({
      activity: activityName,
      ...metrics
    }))
    .sort((a, b) => b.frequency - a.frequency)

  const [localValues, setLocalValues] = useState(frequencyFilter)
  const timeoutRef = useRef<number | null>(null)

  useEffect(() => {
    setLocalValues(frequencyFilter)
  }, [frequencyFilter])

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
      <div className='h-fit border-b border-[#808080] flex flex-col items-start justify-center p-3 pb-4 gap-y-2'>
        <span className="text-lg font-medium">{t('tabs.viewOptions')}</span>
        <div className='flex flex-row items-center gap-2'>
          <button
            onClick={() => onViewModeChange('model')}
            disabled={isLoading}
            className={`px-2 py-1 text-sm rounded-lg transition-colors text-left flex items-center gap-2 ${
              viewMode === 'model'
                ? 'bg-gray-200 text-black font-medium border border-black'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            } ${isLoading ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
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
                  disabled={isLoading || !hasDeviationData}
                  className={`px-2 py-1 text-sm rounded-lg transition-colors text-left flex items-center gap-2 ${
                    !hasDeviationData
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : viewMode === 'deviations'
                        ? 'bg-gray-200 text-black font-medium border border-black cursor-pointer'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200 cursor-pointer'
                  } ${isLoading ? 'opacity-50' : ''}`}
                >
                  {t('tabs.deviations')}
                </button>
              </span>
            </TooltipTrigger>
            {!hasDeviationData && (
              <TooltipContent className="z-200 max-w-[260px]">
                <p>{t('legend.frequencyDeviationsUnavailable')}</p>
              </TooltipContent>
            )}
          </Tooltip>
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
          <span className="text-lg font-medium">{t('deviations.withDeviationsFrequency')}</span>
          <span className="text-sm font-medium mb-6">{t('deviations.withDeviationsFrequencyDescription')}</span>
          <DualRangeSlider
            label={(value) => value}
            value={localValues}
            onValueChange={handleFilterChange}
            onValueCommit={handleFilterCommit}
            min={limitsFrequencyFlows.min}
            max={limitsFrequencyFlows.max}
            step={1}
          />
          <span className='text-sm text-black mt-2'>{t('deviations.withDeviationsFrequencyNote')}</span>
        </div>

        <div className="w-full h-[26vh] min-h-0 flex flex-col gap-y-2 px-3">
          <div className='flex flex-row gap-x-2 items-center shrink-0'>
            <span className="text-lg font-medium">{t('deviations.unexpectedActivities')}</span>
            <div className="relative group">
              <Info className="h-3.5 w-3.5 cursor-pointer text-black" />
              <DeviationTypeTooltip type="unexpectedFrequency" />
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
                  <span className="text-xs text-red-600 font-medium bg-red-100 px-2 py-0.5 rounded shrink-0">{item.frequency}</span>
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
      </>) : (
        <>
          <div className='pb-4'>
            <div className="w-full flex flex-col gap-y-2 px-3 pb-4">
              <div className="flex flex-row gap-x-2 items-center">
                <span className="text-lg font-medium">{t('legend.howItWorks')}</span>
                <div className="relative group">
                  <Info className="h-3.5 w-3.5 cursor-pointer text-black" />
                  <DeviationTypeTooltip type="modelMismatch" />
                </div>
              </div>
              <div className="text-sm text-black space-y-2">
                <p>
                  <span className='text-sm text-black font-medium'>{t('legend.howItWorksLabelFrequency')}</span> {t('legend.howItWorksDescriptionFrequency')}
                </p>
                <p>
                  <span className='text-sm text-black font-medium'>{t('legend.howItWorksExampleLabelFrequency')}</span> {t('legend.howItWorksExampleDescriptionFrequency')}
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
                      <span className="text-xs text-red-600 font-medium bg-red-100 px-2 py-0.5 rounded shrink-0">{item.frequency}</span>
                    </div>
                  ))
                ) : (
                  <span className="text-sm text-gray-500 italic">{t('deviations.noActivitiesFound')}</span>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
