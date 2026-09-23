import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import NavigatedViewer from 'bpmn-js/lib/NavigatedViewer'
import { formatSecondsFull, formatSecondsHuman, normalizeActivityName } from '../utils/functions'
import { BpmnAlignmentsLegend } from './bpmn-alignments-legend'
import { BpmnConformanceHeatmap } from './bpmn-conformance-heatmap'
import { BpmnZoomControls } from './ui/bpmn-zoom-controls'
import type { ConformanceMetrics, HelperVariables, PerformanceActivityMetric, PerformanceFlowMetric, PerformanceMetrics, TimeConformanceFlowMetrics } from '@/types/analysis-backend'
import type { ActivityCoordinatesCollection, DeviationActivitySizeProfile, LaneElements } from '@/types/analysis-frontend'
import { useTranslation } from 'react-i18next'
import { ToastPromise } from './ui/toast-promise'
import { useBpmnZoom } from '@/hooks/useBpmnZoom'
import { BpmnPerformancePathTooltip } from './bpmn-performance-path-tooltip'
import { BpmnTimeConformanceActivityTooltip } from './bpmn-time-conformance-activity-tooltip'
import {
  BPMN_AUGMENTATION_ATTRS,
  bpmnAugmentationSelector,
  setBpmnAugmentationAttributes,
  stripFrequencySuffix
} from '@/utils/bpmn-utils'
import {
  addAverageTimeToModelActivities,
  applyModelPerformanceFocusOpacity,
  applyTimeConformanceStyle,
  buildModelPerformanceLabelData,
  buildModelActivityPathsFromFlows,
  buildWithDeviationsActivityPathsFromFlows,
  clearTimeConformanceStyles,
  drawSelectedModelPerformancePathLabel,
  type ModelPerformanceLabelData,
  type ModelPerformanceClickedElement,
  installActivityPerformanceInteractions,
} from '@/utils/bpmn-viewer-performance'
import {
  buildGenericDeviationActivitiesAndLanes,
  buildGenericDeviationArrows,
  type GenericDeviationArrow,
  type GenericDeviationFlowMetric,
  createActivityXML,
  createDeviationLane,
  createEndEventXML,
  createSmartDeviationArrowElement,
  findLaneForActivity,
  findPredecessorCoordinates,
  findSafePosition,
  getBpmnCoordinates,
  getSecondaryDeviationActivities,
  orderDeviationActivitiesByModelPredecessors,
  styleDeviationActivityElement,
  styleDeviationEndEventElements,
  styleDeviationLaneElements
} from '@/utils/bpmn-viewer-deviations'
import { BpmnAlignmentsConformanceTooltip } from './bpmn-alignments-conformance-tooltip'

interface BpmnAlignmentsViewerProps {
  xml: string
  conformance_metrics: ConformanceMetrics
  performance_metrics: PerformanceMetrics
  helper_variables: HelperVariables
  deviationSizeProfile?: DeviationActivitySizeProfile
  className?: string
}

type DiagramBounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

type ModelActivityMetricTime = {
  average: number
  median: number
}

export function BpmnAlignmentsViewer({ xml, conformance_metrics, performance_metrics, helper_variables, deviationSizeProfile, className = '' }: BpmnAlignmentsViewerProps) {
  
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<NavigatedViewer | null>(null)
  const { handleZoomIn, handleZoomOut, handleFitViewport, handleReset, handleSvgDownload } = useBpmnZoom(viewerRef)
  const [isLoaded, setIsLoaded] = useState(false)
  const [showViewer, setShowViewer] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const isDraggingRef = useRef(false)
  const [tooltip, setTooltip] = useState<{
    activityName: string
    moveData: any
    position: { x: number; y: number }
  } | null>(null)
  const [timeActivityTooltip, setTimeActivityTooltip] = useState<{
    activityName: string
    normalizedActivityName: string
    position: { x: number; y: number }
  } | null>(null)
  const [timeConformancePathSelectionActivities, setTimeConformancePathSelectionActivities] = useState<Set<string>>(new Set())
  const [viewMode, setViewMode] = useState<'alignments' | 'performance'>('alignments')
  const [clickedElement, setClickedElement] = useState<ModelPerformanceClickedElement>(null)
  const [subViewMode, setSubViewMode] = useState<'conformance' | 'moves'>('conformance')
  const [timeConformanceView, setTimeConformanceView] = useState<'model' | 'deviations'>('model')
  const [performanceMetric, setPerformanceMetric] = useState<'average' | 'median'>('average')
  const performanceMetricRef = useRef(performanceMetric)
  const previousMetricRef = useRef(performanceMetric)
  const previousViewModeRef = useRef(timeConformanceView)
  const modelActivityMetricTimeRef = useRef<Map<string, ModelActivityMetricTime>>(new Map())
  const modelPerformanceLabelDataRef = useRef<ModelPerformanceLabelData | null>(null)
  const [arrowsToCreate, setArrowsToCreate] = useState<Array<GenericDeviationArrow & { selected_sojourn: number }>>([])
  const [activitiesToStyle, setActivitiesToStyle] = useState<string[]>([])
  const [secondaryActivitiesToStyle, setSecondaryActivitiesToStyle] = useState<string[]>([])
  const [activitiesCoordinates, setActivitiesCoordinates] = useState<ActivityCoordinatesCollection>({})
  const [, setLanes] = useState<LaneElements>({})
  const [deviationLanes, setDeviationLanes] = useState<Set<string>>(new Set())
  const [endEventIds, setEndEventIds] = useState<Map<string, boolean>>(new Map())
  const [connectionPointsUsage, setConnectionPointsUsage] = useState<Map<string, { origins: number; destinations: number }>>(new Map())
  const [selectedMoveTypes, setSelectedMoveTypes] = useState({
    synchronous: true,
    model: true,
    log: true
  })
  const outsideClickPointerDown = useRef<{ x: number; y: number } | null>(null)
  const outsideClickMoved = useRef(false)
  const { activities_roles, roles_lanes, deviation_predecessors, model_next_activities } = helper_variables
  const { activities_moves } = conformance_metrics.alignments_metrics
  const time_conformance = timeConformanceView === 'deviations'
    ? conformance_metrics.time_conformance.all
    : conformance_metrics.time_conformance.model
  const hasTimeConformanceData = conformance_metrics.time_conformance.model.length > 0

  useEffect(() => {
    if (!hasTimeConformanceData && viewMode === 'performance') {
      setViewMode('alignments')
    }
  }, [hasTimeConformanceData, viewMode])

  performanceMetricRef.current = performanceMetric

  const selectedPerformanceMetrics = useMemo(() => {
      const selectValue = (metrics: { avg_sojourn: number; median_sojourn: number }): number => {
        const median = metrics.median_sojourn
  
        return performanceMetric === 'median'
          ? median
          : metrics.avg_sojourn
      }
  
      const selectActivityMetric = (activities: PerformanceActivityMetric) => {
        return Object.fromEntries(
          Object.entries(activities).map(([activityName, metrics]) => [
            activityName,
            {
              ...metrics,
              selected_sojourn: selectValue(metrics)
            }
          ])
        )
      }
  
      const selectFlowMetric = (flows: PerformanceFlowMetric[]) => {
        return flows.map((flow) => ({
          ...flow,
          selected_sojourn: selectValue(flow)
        }))
      }
  
      return {
        ...performance_metrics,
        activities: {
          model: selectActivityMetric(performance_metrics.activities.model),
          deviations: selectActivityMetric(performance_metrics.activities.deviations),
          all: selectActivityMetric(performance_metrics.activities.all)
        },
        flows: {
          model: selectFlowMetric(performance_metrics.flows.model),
          deviations: selectFlowMetric(performance_metrics.flows.deviations),
          all: selectFlowMetric(performance_metrics.flows.all)
        }
      }
    }, [performanceMetric, performance_metrics])
  const selectedPerformanceMetricsRef = useRef(selectedPerformanceMetrics)
  selectedPerformanceMetricsRef.current = selectedPerformanceMetrics

  const cleanupTimeConformanceAugmentations = useCallback(() => {
    clearTimeConformanceStyles(containerRef.current)
    containerRef.current
      ?.querySelectorAll(`${bpmnAugmentationSelector('flow-label')}, ${bpmnAugmentationSelector('flow-hover-target')}, ${bpmnAugmentationSelector('deviation-arrow')}`)
      .forEach((node) => node.remove())
  }, [])

  const resetTimeConformanceDeviationState = useCallback(() => {
    containerRef.current
      ?.querySelectorAll(bpmnAugmentationSelector('deviation-arrow'))
      .forEach((node) => node.remove())

    setArrowsToCreate([])
    setActivitiesToStyle([])
    setSecondaryActivitiesToStyle([])
    setActivitiesCoordinates({})
    setLanes({})
    setDeviationLanes(new Set())
    setEndEventIds(new Map())
    setConnectionPointsUsage(new Map())
  }, [])

  const getConformanceBorderColor = (activityName: string, moves?: any): string => {
    const moveData = moves || activities_moves[activityName]
    if (!moveData) return 'rgb(128, 128, 128)'

    const { synchronous_moves, model_moves, log_moves } = moveData
    const totalMoves = synchronous_moves + model_moves + log_moves
    
    if (totalMoves === 0) return 'rgb(128, 128, 128)'
    
    const synchronousPercentage = (synchronous_moves / totalMoves) * 100
    
    console.log(`Activity: ${activityName}, Sync: ${synchronous_moves}, Model: ${model_moves}, Log: ${log_moves}, Sync%: ${synchronousPercentage.toFixed(1)}%`)
    
    const ratio = synchronousPercentage / 100
    
    const red = Math.round(255 * (1 - ratio))
    const green = Math.round(255 * ratio)
    const blue = 0
    
    return `rgb(${red}, ${green}, ${blue})`
  }

  const cleanupBpmnAugmentations = (gfx: any) => {
    const existingOverlays = gfx.querySelectorAll(`rect${bpmnAugmentationSelector('activity-overlay')}, rect${bpmnAugmentationSelector('activity-background')}`)
    existingOverlays.forEach((overlay: any) => overlay.remove())

    const restoreAttribute = (node: any, attribute: string) => {
      const attributeDataKeys: Record<string, string> = {
        fill: 'originalfill',
        stroke: 'originalstroke',
        'stroke-width': 'originalstrokeWidth',
        rx: 'originalrx',
        ry: 'originalry'
      }
      const dataKey = attributeDataKeys[attribute]
      const originalValue = dataKey ? node.dataset?.[dataKey] : undefined
      if (originalValue === undefined) return

      if (originalValue) {
        node.setAttribute(attribute, originalValue)
      } else {
        node.removeAttribute(attribute)
      }
    }

    const restoreStyle = (node: any, property: string, dataKey: string) => {
      const originalValue = node.dataset?.[dataKey]
      if (originalValue === undefined) return

      if (originalValue) {
        node.style.setProperty(property, originalValue)
      } else {
        node.style.removeProperty(property)
      }
    }

    const shapes = gfx.querySelectorAll('rect, path, circle, ellipse, polygon')
    shapes.forEach((shape: any) => {
      restoreStyle(shape, 'cursor', 'originalCursorStyle')
      restoreStyle(shape, 'fill', 'originalFillStyle')
      restoreStyle(shape, 'stroke', 'originalStrokeStyle')
      restoreStyle(shape, 'stroke-width', 'originalStrokeWidthStyle')
      restoreAttribute(shape, 'fill')
      restoreAttribute(shape, 'stroke')
      restoreAttribute(shape, 'stroke-width')
      restoreAttribute(shape, 'rx')
      restoreAttribute(shape, 'ry')
    })

    const textElements = gfx.querySelectorAll('text')
    textElements.forEach((text: any) => {
      restoreStyle(text, 'fill', 'originalFillStyle')
      restoreStyle(text, 'font-weight', 'originalFontWeightStyle')
      restoreStyle(text, 'pointer-events', 'originalPointerEventsStyle')
      restoreAttribute(text, 'fill')
    })

    gfx.style.cursor = ''
    gfx.removeEventListener('mouseenter', gfx._handleMouseEnter)
    gfx.removeEventListener('mouseleave', gfx._handleMouseLeave)
    gfx.removeEventListener('mousemove', gfx._handleMouseMove)
    gfx._handleMouseEnter = undefined
    gfx._handleMouseLeave = undefined
    gfx._handleMouseMove = undefined
  }

  const storeOriginalBpmnState = (node: any) => {
    if (!node.dataset || node.dataset.originalBpmnStateStored) return

    node.dataset.originalBpmnStateStored = 'true'
    node.dataset.originalCursorStyle = node.style.cursor || ''
    node.dataset.originalFillStyle = node.style.fill || ''
    node.dataset.originalStrokeStyle = node.style.stroke || ''
    node.dataset.originalStrokeWidthStyle = node.style.strokeWidth || ''
    node.dataset.originalFontWeightStyle = node.style.fontWeight || ''
    node.dataset.originalPointerEventsStyle = node.style.pointerEvents || ''
    node.dataset.originalfill = node.getAttribute('fill') || ''
    node.dataset.originalstroke = node.getAttribute('stroke') || ''
    node.dataset.originalstrokeWidth = node.getAttribute('stroke-width') || ''
    node.dataset.originalrx = node.getAttribute('rx') || ''
    node.dataset.originalry = node.getAttribute('ry') || ''
  }

  const boldAverageTimeSuffixes = () => {
    if (viewMode !== 'performance' || !containerRef.current) return

    const labelLines = containerRef.current.querySelectorAll('text tspan')
    labelLines.forEach((line) => {
      const text = line.textContent?.trim() || ''
      if (!/^\(.+\)$/.test(text)) return

      const svgLine = line as SVGElement
      svgLine.setAttribute('font-weight', '700')
      svgLine.style.fontWeight = '700'
    })
  }

  const applyAlignmentsAugmentations = () => {
    if (!viewerRef.current || !isLoaded) return

    try {
      const elementRegistry = viewerRef.current.get('elementRegistry') as any

      const elements = elementRegistry.getAll()

      elements.forEach((element: any) => {
        if (element.businessObject && element.businessObject.name) {
          const originalActivityName = element.businessObject.name
          const normalizedActivityName = normalizeActivityName(originalActivityName)

          const moves = activities_moves[normalizedActivityName]
          
          if (moves && element.businessObject.$type && 
            element.businessObject.$type.includes('Task')) {
            
            const gfx = elementRegistry.getGraphics(element)
            if (gfx) {
              cleanupBpmnAugmentations(gfx)

              if (viewMode === 'performance') {
                gfx.style.display = 'none'
                gfx.offsetHeight // Trigger reflow
                gfx.style.display = ''
                return
              }

              gfx.style.cursor = 'pointer'
              const bbox = gfx.getBBox()

              if (viewMode === 'alignments') {
                if (subViewMode === 'conformance') {
                  const conformanceColor = getConformanceBorderColor(normalizedActivityName, moves)
                  const rgbMatch = conformanceColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
                  const backgroundColor = rgbMatch 
                    ? `rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}, 0.8)`
                    : 'rgba(128, 128, 128, 0.7)'
                  
                  const bbox = gfx.getBBox()
                  
                  // Create a background rectangle and insert it as the FIRST child (rendered behind)
                  const backgroundRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
                  backgroundRect.setAttribute('x', String(bbox.x))
                  backgroundRect.setAttribute('y', String(bbox.y))
                  backgroundRect.setAttribute('width', String(bbox.width))
                  backgroundRect.setAttribute('height', String(bbox.height))
                  backgroundRect.setAttribute('rx', '10')
                  backgroundRect.setAttribute('ry', '10')
                  backgroundRect.setAttribute('fill', backgroundColor)
                  backgroundRect.setAttribute('stroke', 'none')
                  setBpmnAugmentationAttributes(backgroundRect, 'activity-background', { view: 'alignments' })
                  backgroundRect.style.pointerEvents = 'none'
                  
                  const existingBg = gfx.querySelector(`rect${bpmnAugmentationSelector('activity-background')}`)
                  if (existingBg) {
                    existingBg.remove()
                  }
                  
                  if (gfx.firstChild) {
                    gfx.insertBefore(backgroundRect, gfx.firstChild)
                  } else {
                    gfx.appendChild(backgroundRect)
                  }
                  
                  const shapes = gfx.querySelectorAll(`rect:not(${bpmnAugmentationSelector('activity-background')}), path, circle, ellipse, polygon`)
                  shapes.forEach((shape: any) => {
                    storeOriginalBpmnState(shape)
                    shape.style.cursor = 'pointer'
                    shape.style.fill = 'rgba(0, 0, 0, 0)'
                    shape.style.stroke = '#000000'
                    shape.style.strokeWidth = '1.5px'
                    shape.setAttribute('fill', 'rgba(0, 0, 0, 0)')
                    shape.setAttribute('stroke', '#000000')
                    
                    if (shape.tagName === 'rect') {
                      shape.setAttribute('rx', '10')
                      shape.setAttribute('ry', '10')
                    }
                    
                    shape.style.setProperty('fill', 'rgba(0, 0, 0, 0)', 'important')
                    shape.style.setProperty('stroke', '#000000', 'important')
                    shape.style.setProperty('stroke-width', '1.5px', 'important')
                  })
                  
                  const textElements = gfx.querySelectorAll('text')
                  textElements.forEach((text: any) => {
                    storeOriginalBpmnState(text)
                    text.style.fill = 'black'
                    text.style.setProperty('fill', 'black', 'important')
                    text.setAttribute('fill', 'black')
                    text.style.fontWeight = '500'
                    text.style.pointerEvents = 'none'
                  })

                } else {
                  const shapes = gfx.querySelectorAll('rect, path, circle, ellipse, polygon')
                  shapes.forEach((shape: any) => {
                    storeOriginalBpmnState(shape)
                    shape.style.cursor = 'pointer'
                    shape.style.fill = `rgba(0,0,0,0)`
                    shape.style.stroke = '#000000'
                    shape.style.strokeWidth = "1px"

                    if (shape.tagName === 'rect') {
                      shape.setAttribute('rx', '6')
                      shape.setAttribute('ry', '6')
                    }
                  })
                  
                  const moveIndicatorHeight = 6
                  const indicatorY = bbox.y + bbox.height - moveIndicatorHeight - 2
                  
                  const totalMovesForIndicator = (moves.synchronous_moves || 0) + moves.model_moves + moves.log_moves
                  const synchronousProportion = totalMovesForIndicator > 0 ? (moves.synchronous_moves || 0) / totalMovesForIndicator : 0.33
                  const modelProportion = totalMovesForIndicator > 0 ? moves.model_moves / totalMovesForIndicator : 0.33
                  const logProportion = totalMovesForIndicator > 0 ? moves.log_moves / totalMovesForIndicator : 0.33
                  
                  if (moves.synchronous_moves > 0 && selectedMoveTypes.synchronous) {
                    const syncRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
                    syncRect.setAttribute('x', String(bbox.x + 2))
                    syncRect.setAttribute('y', String(indicatorY))
                    syncRect.setAttribute('width', String((bbox.width - 4) * synchronousProportion))
                    syncRect.setAttribute('height', String(moveIndicatorHeight))
                    syncRect.setAttribute('fill', '#10b981')
                    syncRect.setAttribute('rx', '2')
                    syncRect.setAttribute('ry', '2')
                    setBpmnAugmentationAttributes(syncRect, 'activity-overlay', { view: 'alignments' })
                    syncRect.style.pointerEvents = 'none'
                    gfx.appendChild(syncRect)
                  }
                
                  if (moves.model_moves > 0 && selectedMoveTypes.model) {
                    const modelRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
                    const modelWidth = (bbox.width - 4) * modelProportion
                    const modelX = bbox.x + 2 + (bbox.width - 4) * synchronousProportion
                    modelRect.setAttribute('x', String(modelX))
                    modelRect.setAttribute('y', String(indicatorY))
                    modelRect.setAttribute('width', String(modelWidth))
                    modelRect.setAttribute('height', String(moveIndicatorHeight))
                    modelRect.setAttribute('fill', '#1e3a8a')
                    modelRect.setAttribute('rx', '2')
                    modelRect.setAttribute('ry', '2')
                    setBpmnAugmentationAttributes(modelRect, 'activity-overlay', { view: 'alignments' })
                    modelRect.style.pointerEvents = 'none'
                    gfx.appendChild(modelRect)
                  }

                  if (moves.log_moves > 0 && selectedMoveTypes.log) {
                    const logRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
                    const logWidth = (bbox.width - 4) * logProportion
                    const logX = bbox.x + 2 + (bbox.width - 4) * (synchronousProportion + modelProportion)
                    logRect.setAttribute('x', String(logX))
                    logRect.setAttribute('y', String(indicatorY))
                    logRect.setAttribute('width', String(logWidth))
                    logRect.setAttribute('height', String(moveIndicatorHeight))
                    logRect.setAttribute('fill', '#7c3aed')
                    logRect.setAttribute('rx', '2')
                    logRect.setAttribute('ry', '2')
                    setBpmnAugmentationAttributes(logRect, 'activity-overlay', { view: 'alignments' })
                    logRect.style.pointerEvents = 'none'
                    gfx.appendChild(logRect)
                  }
                }
              }

              gfx.style.display = 'none'
              gfx.offsetHeight
              gfx.style.display = ''

              const handleMouseEnter = (event: MouseEvent) => {
                // Anchor tooltip to the activity's top-center (consistent with deviations viewer)
                try {
                  const clientRect = gfx.getBoundingClientRect()
                  const anchorX = clientRect.left + clientRect.width / 2
                  const anchorY = clientRect.top

                  setTooltip({
                    activityName: originalActivityName,
                    moveData: moves,
                    position: { x: anchorX, y: anchorY }
                  })
                } catch (err) {
                  // Fallback to mouse position if bounding rect fails
                  setTooltip({
                    activityName: originalActivityName,
                    moveData: moves,
                    position: { x: event.clientX, y: event.clientY }
                  })
                }
              }

              const handleMouseLeave = () => {
                setTooltip(null)
              }

              const handleMouseMove = () => {
                // Keep tooltip anchored to the activity top-center while hovering
                if (tooltip) {
                  try {
                    const clientRect = gfx.getBoundingClientRect()
                    const anchorX = clientRect.left + clientRect.width / 2
                    const anchorY = clientRect.top

                    setTooltip(prev => prev ? ({ ...prev, position: { x: anchorX, y: anchorY } }) : null)
                  } catch (err) {
                  }
                }
              }

              gfx._handleMouseEnter = handleMouseEnter
              gfx._handleMouseLeave = handleMouseLeave
              gfx._handleMouseMove = handleMouseMove
              
              gfx.addEventListener('mouseenter', handleMouseEnter)
              gfx.addEventListener('mouseleave', handleMouseLeave)
              gfx.addEventListener('mousemove', handleMouseMove)
            }
          } else {
            console.log(`❌ No moves data found for: ${originalActivityName} (${normalizedActivityName})`)
          }
        }
      })

    } catch (error) {
      console.error('Error applying colors to BPMN elements:', error)
    }
  }

  const setupBpmnViewer = useCallback(() => {
    if (!containerRef.current) return

    const viewer = new NavigatedViewer({
      container: containerRef.current,
      width: '100%',
      height: '100%'
    })

    viewerRef.current = viewer

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return
      
      event.preventDefault()
      if (viewerRef.current) {
        const canvas = viewerRef.current.get('canvas') as any
        const container = containerRef.current
        if (!container) return
        
        const rect = container.getBoundingClientRect()
        const x = event.clientX - rect.left
        const y = event.clientY - rect.top
        
        const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1
        const currentZoom = canvas.zoom()
        const newZoom = currentZoom * zoomFactor
        
        canvas.zoom(newZoom, { x, y })
      }
    }

    const container = containerRef.current
    container.addEventListener('wheel', handleWheel, { passive: false })

    return () => {
      container?.removeEventListener('wheel', handleWheel)
      viewer.destroy()
      viewerRef.current = null
    }
  }, [])

  // Build the deviation overlay used by the time-conformance view before importing the XML.
  const buildTimeConformanceDeviationXml = useCallback(async (baseXml: string) => {
    if (!viewerRef.current) return baseXml

    const coordResult = await getBpmnCoordinates({ viewer: viewerRef.current })
    if (!coordResult) return baseXml

    let { coordinates, allElements, lanes, activitiesLanes } = coordResult
    setActivitiesCoordinates(coordinates)
    setLanes(lanes)

    const activePerformanceMetrics = selectedPerformanceMetricsRef.current
    const deviationActivitiesNames = new Set(Object.keys(activePerformanceMetrics.activities.deviations))
    const primaryDeviationActivities = new Set(Object.keys(activePerformanceMetrics.activities.deviations))
    const deviationFlows = activePerformanceMetrics.flows.deviations as Array<PerformanceFlowMetric & { selected_sojourn: number }>
    const secondaryDeviationActivities = getSecondaryDeviationActivities({
      isDeviationFilterActive: false,
      primaryDeviationActivities,
      deviationActivitiesNames,
      deviationFlows
    })

    let modifiedXML = baseXml
    const genericDeviationActivities = Object.fromEntries(
      Object.entries(activePerformanceMetrics.activities.deviations).map(([activityName, activity]) => {
        const selectedSojourn = Number.isFinite(activity.selected_sojourn)
          ? activity.selected_sojourn
          : activity.avg_sojourn

        return [
          activityName,
          {
            originalActivity: activity.originalActivity,
            label: `${activity.originalActivity === '' ? 'No label' : activity.originalActivity} 
          (${formatSecondsFull(selectedSojourn, false)})`
          }
        ]
      })
    )
    const orderedDeviationActivities = orderDeviationActivitiesByModelPredecessors({
      deviationActivities: activePerformanceMetrics.activities.deviations,
      deviationPredecessors: deviation_predecessors,
      modelActivities: activePerformanceMetrics.activities.model
    })

    // Reuse the shared deviation builder so alignment/performance/frequency placement stays identical.
    const deviationActivityBuildResult = buildGenericDeviationActivitiesAndLanes({
      xmlString: modifiedXML,
      coordinates,
      allElements,
      lanes,
      activitiesLanes,
      deviationActivities: genericDeviationActivities,
      primaryDeviationActivities,
      secondaryDeviationActivities,
      orderedDeviationActivities,
      findPredecessorCoordinates: (activityName, currentCoordinates) => findPredecessorCoordinates(
        activityName,
        currentCoordinates,
        deviation_predecessors
      ),
      findLaneForActivity: (activityName, predecessorActivity, currentActivitiesLanes, currentLanes) => findLaneForActivity({
        deviationActivity: activityName,
        lastActivity: predecessorActivity,
        activitiesLanesMap: currentActivitiesLanes,
        lanesMap: currentLanes,
        activitiesRoles: activities_roles,
        rolesLanes: roles_lanes,
        getLaneName: (laneId) => {
          const elementRegistry = viewerRef.current?.get('elementRegistry') as any
          const laneElement = elementRegistry?.get(laneId)
          return laneElement?.businessObject?.name
        }
      }),
      createDeviationLane,
      findSafePosition,
      createActivityXML,
      deviationSizeProfile,
      onCoordinatesChange: setActivitiesCoordinates,
      onLanesChange: setLanes
    })

    modifiedXML = deviationActivityBuildResult.modifiedXML
    coordinates = deviationActivityBuildResult.coordinates
    allElements = deviationActivityBuildResult.allElements
    lanes = deviationActivityBuildResult.lanes
    activitiesLanes = deviationActivityBuildResult.activitiesLanes

    const toGenericDeviationFlow = (
      flow: PerformanceFlowMetric & { selected_sojourn: number }
    ): GenericDeviationFlowMetric => ({
      from: flow.from,
      to: flow.to,
      value: flow.selected_sojourn,
      label: formatSecondsFull(flow.selected_sojourn, false)
    })
    const genericDeviationFlows = deviationFlows.map(toGenericDeviationFlow)

    // Synthetic termination events and deviation arrows are generated through the shared path.
    const deviationArrowBuildResult = buildGenericDeviationArrows({
      xmlString: modifiedXML,
      coordinates,
      allElements,
      lanes,
      activitiesLanes,
      deviationFlows: genericDeviationFlows,
      allDeviationFlows: genericDeviationFlows,
      primaryDeviationActivities,
      isDeviationFilterActive: false,
      filterMin: Number.NEGATIVE_INFINITY,
      filterMax: Number.POSITIVE_INFINITY,
      findSafePosition,
      createEndEventXML,
      deviationSizeProfile
    })

    modifiedXML = deviationArrowBuildResult.modifiedXML
    coordinates = deviationArrowBuildResult.coordinates

    setActivitiesCoordinates(coordinates)
    setActivitiesToStyle(Array.from(deviationActivityBuildResult.newActivitiesToStyleSet))
    setSecondaryActivitiesToStyle(Array.from(deviationActivityBuildResult.newSecondaryActivitiesSet))
    setDeviationLanes(deviationActivityBuildResult.newDeviationLanesSet)
    setArrowsToCreate(deviationArrowBuildResult.arrowsToCreate.map((arrow) => ({
      ...arrow,
      selected_sojourn: arrow.value
    })))
    setEndEventIds(deviationArrowBuildResult.endEventIdsToStyle)

    return modifiedXML
  }, [
    deviation_predecessors,
    activities_roles,
    roles_lanes,
    deviationSizeProfile
  ])

  const importBpmnForCurrentView = useCallback(async () => {
    if (!viewerRef.current || !xml) return false

    setIsLoaded(false)
    setShowViewer(false)
    setClickedElement(null)
    resetTimeConformanceDeviationState()

    const activityMetricsForImport = timeConformanceView === 'deviations'
      ? performance_metrics.activities.all
      : performance_metrics.activities.model

    const baseXmlToImport = viewMode === 'performance'
      ? addAverageTimeToModelActivities(xml, activityMetricsForImport)
      : xml

    try {
      let xmlToImport = baseXmlToImport

      if (viewMode === 'performance' && timeConformanceView === 'deviations') {
        await viewerRef.current.importXML(baseXmlToImport)
        xmlToImport = await buildTimeConformanceDeviationXml(baseXmlToImport)
      }

      await viewerRef.current.importXML(xmlToImport)

      const canvas = viewerRef.current!.get('canvas') as any
      canvas.zoom('fit-viewport', 'auto')

      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          const currentZoom = canvas.zoom()
          canvas.zoom(currentZoom * 0.9, 'auto')
          boldAverageTimeSuffixes()
          if (viewMode !== 'performance') {
            setShowViewer(true)
          }
          resolve()
        })
      })

      return true
    } catch (error: any) {
      console.error('Error importing BPMN:', error)
      setShowViewer(true)
      return false
    }
  }, [
    xml,
    viewMode,
    timeConformanceView,
    performance_metrics.activities.all,
    performance_metrics.activities.model,
    resetTimeConformanceDeviationState,
    buildTimeConformanceDeviationXml
  ])

  const setupOutsideClickDismiss = useCallback(() => {
    const DRAG_THRESHOLD_PX = 4

    const handlePointerDown = (event: PointerEvent) => {
      outsideClickPointerDown.current = { x: event.clientX, y: event.clientY }
      outsideClickMoved.current = false
    }

    const handlePointerMove = (event: PointerEvent) => {
      const start = outsideClickPointerDown.current
      if (!start || event.buttons !== 1) return

      const deltaX = event.clientX - start.x
      const deltaY = event.clientY - start.y

      if (Math.hypot(deltaX, deltaY) > DRAG_THRESHOLD_PX) {
        outsideClickMoved.current = true
      }
    }

    const handleDocumentClick = (event: MouseEvent) => {
      if (!clickedElement || viewMode !== 'performance') return
      if (outsideClickMoved.current || isDraggingRef.current) return

      const target = event.target as HTMLElement | null
      if (!target) return

      if (target.closest('[data-flow-tooltip="true"]')) {
        return
      }

      if (target.closest('[data-bpmn-controls="true"]')) {
        return
      }

      setClickedElement(null)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('pointermove', handlePointerMove)
    document.addEventListener('click', handleDocumentClick)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('click', handleDocumentClick)
    }
  }, [clickedElement, viewMode])

  useEffect(() => {
    return setupBpmnViewer()
  }, [setupBpmnViewer])

  useEffect(() => {
    return setupOutsideClickDismiss()
  }, [setupOutsideClickDismiss])

  useEffect(() => {
    let isCancelled = false

    importBpmnForCurrentView().then((didImport) => {
      if (!isCancelled && didImport) {
        setIsLoaded(true)
        previousMetricRef.current = performanceMetricRef.current
        previousViewModeRef.current = timeConformanceView
      }
    })

    return () => {
      isCancelled = true
    }
    
  }, [importBpmnForCurrentView, timeConformanceView])

  const handleMoveTypeToggle = (moveType: 'synchronous' | 'model' | 'log') => {
    setSelectedMoveTypes(prev => ({
      ...prev,
      [moveType]: !prev[moveType]
    }))
  }

  const handlePerformanceMetricChange = (metric: 'average' | 'median') => {
    const isMetricChange = previousMetricRef.current !== metric
    const stayedInSameView = previousViewModeRef.current === timeConformanceView
    const shouldOnlyRefreshMetric =
      viewMode === 'performance' &&
      isLoaded &&
      stayedInSameView &&
      isMetricChange

    setPerformanceMetric(metric)
    performanceMetricRef.current = metric

    if (shouldOnlyRefreshMetric) {
      requestAnimationFrame(() => {
        refreshTimeConformanceMetricVisuals(metric)
        previousMetricRef.current = metric
        previousViewModeRef.current = timeConformanceView
      })
    }
  }

  useEffect(() => {
    
    if (!isLoaded || viewMode !== 'alignments' || !activities_moves) {
      setTooltip(null)
      return
    }

    const timeoutId = setTimeout(() => {
      applyAlignmentsAugmentations()
    }, 200)

    return () => clearTimeout(timeoutId)
  }, [isLoaded, activities_moves, viewMode, subViewMode, selectedMoveTypes])

  const normalizePerformanceMetricKey = (activityName: string) => {
    if (activityName === '<<start>>' || activityName === '<<end>>') {
      return activityName
    }

    return normalizeActivityName(activityName)
  }

  const buildModelActivityMetricTime = useCallback(() => {
    const modelActivityMetricTime = new Map<string, ModelActivityMetricTime>()

    time_conformance.forEach((flow) => {
      const targetActivity = normalizePerformanceMetricKey(flow.to)
      if (!targetActivity || targetActivity === '<<end>>') return

      if (!modelActivityMetricTime.has(targetActivity)) {
        modelActivityMetricTime.set(targetActivity, {
          average: flow.avg_target_time,
          median: flow.median_target_time ?? flow.avg_target_time
        })
      }
    })

    return modelActivityMetricTime
  }, [time_conformance])

  const timeConformanceLegendActivities = useMemo(() => {
    const modelTimeConformance = conformance_metrics.time_conformance.model
    const modelActivityMetricTime = new Map<string, ModelActivityMetricTime>()
    const cycleTimeByActivity = new Map<string, number>()

    modelTimeConformance.forEach((flow) => {
      const targetActivity = normalizePerformanceMetricKey(flow.to)
      if (!targetActivity || targetActivity === '<<end>>') return

      if (!modelActivityMetricTime.has(targetActivity)) {
        modelActivityMetricTime.set(targetActivity, {
          average: flow.avg_target_time,
          median: flow.median_target_time ?? flow.avg_target_time
        })
      }

      if (!cycleTimeByActivity.has(targetActivity) && Number.isFinite(flow.cycle_time) && flow.cycle_time > 0) {
        cycleTimeByActivity.set(targetActivity, flow.cycle_time)
      }
    })

    return Object.fromEntries(
      Object.entries(performance_metrics.activities.model)
      .filter(([activityName]) => {
        const normalizedActivityName = normalizePerformanceMetricKey(activityName)
        return cycleTimeByActivity.has(normalizedActivityName)
      })
      .map(([activityName, metrics]) => {
        const normalizedActivityName = normalizePerformanceMetricKey(activityName)
        const activityMetricTime = modelActivityMetricTime.get(normalizedActivityName)
        const selectedSojourn = performanceMetric === 'median'
          ? activityMetricTime?.median
          : activityMetricTime?.average

        return [
          activityName,
          {
            ...metrics,
            cycle_time: cycleTimeByActivity.get(normalizedActivityName),
            selected_sojourn: Number.isFinite(selectedSojourn)
              ? selectedSojourn
              : performanceMetric === 'median'
                ? metrics.median_sojourn
                : metrics.avg_sojourn
          }
        ]
      })
    )
  }, [conformance_metrics.time_conformance.model, performanceMetric, performance_metrics.activities.model])

  function resolveClickedElementMetricData(element: ModelPerformanceClickedElement): ModelPerformanceClickedElement {
    if (!element) return element

    const elementData = modelPerformanceLabelDataRef.current?.elementSojourns[element.elementId]
    if (!elementData?.paths || Object.keys(elementData.paths).length === 0) {
      return element
    }

    const pathEntries = Object.entries(elementData.paths)
    const selectedTotal = pathEntries.reduce((sum, [, pathData]) => {
      const selectedValue = Number.isFinite(pathData.selected_sojourn)
        ? pathData.selected_sojourn
        : pathData.average

      return sum + (Number.isFinite(selectedValue) ? selectedValue : 0)
    }, 0)
    const defaultPathKey = [...pathEntries]
      .sort(([, pathA], [, pathB]) => pathB.selected_sojourn - pathA.selected_sojourn)[0]?.[0]
    const hasExistingSelection = element.checkedPaths
      ? Object.keys(elementData.paths).some((pathKey) => element.checkedPaths?.[pathKey])
      : false

    return {
      ...element,
      avg_sojourn: selectedTotal,
      paths: elementData.paths,
      checkedPaths: Object.keys(elementData.paths).reduce<Record<string, boolean>>((acc, pathKey) => {
        acc[pathKey] = hasExistingSelection
          ? Boolean(element.checkedPaths?.[pathKey])
          : pathKey === defaultPathKey
        return acc
      }, {})
    }
  }

  const installTimeConformanceActivityInteractions = useCallback(() => {
    if (!viewerRef.current) return

    boldAverageTimeSuffixes()
    modelActivityMetricTimeRef.current = buildModelActivityMetricTime()

    const activityMetricsForImport = timeConformanceView === 'deviations'
      ? performance_metrics.activities.all
      : performance_metrics.activities.model
    const xmlWithAvgTimes = addAverageTimeToModelActivities(xml, activityMetricsForImport)
    const activityPaths = timeConformanceView === 'deviations'
      ? buildWithDeviationsActivityPathsFromFlows({
        xmlString: xmlWithAvgTimes,
        modelFlows: performance_metrics.flows.model,
        allFlows: performance_metrics.flows.all,
        deviationActivities: performance_metrics.activities.deviations,
        modelNextActivities: model_next_activities,
        container: containerRef.current
      })
      : buildModelActivityPathsFromFlows(
        xmlWithAvgTimes,
        performance_metrics.flows.model,
        model_next_activities
      )

    console.log("[DEBUG] Activity Paths:", activityPaths)

    const targetSourceCounts = new Map<string, Set<string>>()
    Object.entries(activityPaths).forEach(([fromActivityKey, targets]) => {
      Object.keys(targets).forEach((toActivityKey) => {
        const normalizedTargetKey = normalizePerformanceMetricKey(toActivityKey)
        if (!targetSourceCounts.has(normalizedTargetKey)) {
          targetSourceCounts.set(normalizedTargetKey, new Set())
        }

        targetSourceCounts.get(normalizedTargetKey)?.add(fromActivityKey)
      })
    })
    setTimeConformancePathSelectionActivities(
      new Set(
        [...targetSourceCounts.entries()]
          .filter(([, sources]) => sources.size > 1)
          .map(([activityKey]) => activityKey)
      )
    )

    const metric = performanceMetricRef.current
    const selectedFlows = timeConformanceView === 'deviations'
      ? selectedPerformanceMetricsRef.current.flows.all
      : selectedPerformanceMetricsRef.current.flows.model
    const selectedActivities = timeConformanceView === 'deviations'
      ? selectedPerformanceMetricsRef.current.activities.all
      : selectedPerformanceMetricsRef.current.activities.model

    installActivityPerformanceInteractions({
      viewer: viewerRef.current,
      container: containerRef.current,
      activityPaths,
      flows: selectedFlows as Array<PerformanceFlowMetric & { selected_sojourn: number }>,
      activities: selectedActivities,
      timeConformance: buildSelectedMetricTimeConformance(metric),
      isDragging: () => isDraggingRef.current,
      onClickedElement: (element) => {
        setClickedElement(resolveClickedElementMetricData(element))
      }
    })
  }, [
    xml,
    time_conformance,
    timeConformanceView,
    model_next_activities,
    performance_metrics.activities.all,
    performance_metrics.activities.deviations,
    performance_metrics.activities.model,
    performance_metrics.flows.all,
    performance_metrics.flows.model,
    buildModelActivityMetricTime
  ])

  const installTimeConformanceActivityTooltips = useCallback(() => {
    if (!viewerRef.current) return () => {}

    const elementRegistry = viewerRef.current.get('elementRegistry') as any
    const elements = elementRegistry.getAll?.() || []
    const listenerCleanups: Array<() => void> = []
    const activitiesWithCycleTime = new Set(
      time_conformance
        .filter((flow) => Number.isFinite(flow.cycle_time) && flow.cycle_time > 0)
        .map((flow) => normalizeActivityName(flow.to))
    )

    elements.forEach((element: any) => {
      const bo = element.businessObject
      const isActivity = bo?.name && bo?.$type && (
        bo.$type.includes('Task') ||
        bo.$type === 'bpmn:Activity' ||
        bo.$type === 'bpmn:SubProcess'
      )

      if (!isActivity) return

      const gfx = elementRegistry.getGraphics(element)
      if (!gfx) return

      const originalActivityName = stripFrequencySuffix(bo.name)
      const normalizedActivityName = normalizeActivityName(originalActivityName)
      if (!activitiesWithCycleTime.has(normalizedActivityName)) return

      const cursorNodes = Array.from(gfx.querySelectorAll('rect, path, circle, ellipse, polygon, text')) as SVGElement[]
      const originalGfxCursor = gfx.style.cursor
      const originalNodeCursors = cursorNodes.map((node) => ({
        node,
        cursor: node.style.cursor
      }))

      gfx.style.cursor = 'pointer'
      cursorNodes.forEach((node) => {
        node.style.cursor = 'pointer'
      })

      const updateTooltipPosition = () => {
        try {
          const clientRect = gfx.getBoundingClientRect()
          setTimeActivityTooltip({
            activityName: originalActivityName,
            normalizedActivityName,
            position: {
              x: clientRect.left + clientRect.width / 2,
              y: clientRect.top
            }
          })
        } catch {
          setTimeActivityTooltip({
            activityName: originalActivityName,
            normalizedActivityName,
            position: { x: 0, y: 0 }
          })
        }
      }

      const handleMouseEnter = () => {
        updateTooltipPosition()
      }

      const handleMouseMove = () => {
        updateTooltipPosition()
      }

      const handleMouseLeave = () => {
        setTimeActivityTooltip(null)
      }

      gfx.addEventListener('mouseenter', handleMouseEnter)
      gfx.addEventListener('mousemove', handleMouseMove)
      gfx.addEventListener('mouseleave', handleMouseLeave)

      listenerCleanups.push(() => {
        gfx.removeEventListener('mouseenter', handleMouseEnter)
        gfx.removeEventListener('mousemove', handleMouseMove)
        gfx.removeEventListener('mouseleave', handleMouseLeave)
        gfx.style.cursor = originalGfxCursor
        originalNodeCursors.forEach(({ node, cursor }) => {
          node.style.cursor = cursor
        })
      })
    })

    return () => {
      listenerCleanups.forEach((cleanup) => cleanup())
      setTimeActivityTooltip(null)
    }
  }, [time_conformance])

  const getSelectedFlowTime = (
    metric: 'average' | 'median',
    flowMetric: PerformanceFlowMetric | undefined
  ) => {
    if (!flowMetric) return Number.NaN

    return metric === 'median'
      ? flowMetric.median_sojourn
      : flowMetric.avg_sojourn
  }

  const getSelectedTimeConformanceValues = useCallback((
    flow: TimeConformanceFlowMetrics[number],
    metric: 'average' | 'median',
    activityExecutionTime?: number
  ) => {
    const to = normalizePerformanceMetricKey(flow.to)
    const selectedWaitingTime = metric === 'median'
      ? flow.median_waiting_time ?? flow.avg_waiting_time
      : flow.avg_waiting_time
    const selectedActivityTime = Number.isFinite(activityExecutionTime)
      ? activityExecutionTime as number
      : metric === 'median'
        ? flow.median_target_time ?? flow.avg_target_time
        : flow.avg_target_time
    const nextWaitingTime = Number.isFinite(selectedWaitingTime)
      ? selectedWaitingTime
      : flow.avg_waiting_time
    const nextActivityTime = Number.isFinite(selectedActivityTime)
      ? selectedActivityTime
      : flow.avg_target_time
    const isEndEvent = to === '<<end>>'

    return {
      averageActivityTime: isEndEvent ? 0 : nextActivityTime,
      averageWaitingTime: nextWaitingTime,
      realCycleTime: isEndEvent ? nextWaitingTime : nextWaitingTime + nextActivityTime,
      estimatedCycleTime: flow.cycle_time
    }
  }, [])

  const getSelectedActivityExecutionTime = useCallback((
    activityName: string | undefined,
    metric: 'average' | 'median'
  ) => {
    if (!activityName) return undefined

    const normalizedActivityName = normalizePerformanceMetricKey(activityName)
    if (normalizedActivityName === '<<end>>') return 0

    const activePerformanceMetrics = selectedPerformanceMetricsRef.current
    const selectedActivityMetrics = timeConformanceView === 'deviations'
      ? activePerformanceMetrics.activities.all
      : activePerformanceMetrics.activities.model
    const activityMetric = selectedActivityMetrics[normalizedActivityName] as typeof selectedActivityMetrics[string] & {
      selected_sojourn?: number
    } | undefined
    const selectedTime = Number.isFinite(activityMetric?.selected_sojourn)
      ? activityMetric?.selected_sojourn
      : metric === 'median'
        ? activityMetric?.median_sojourn
        : activityMetric?.avg_sojourn

    return Number.isFinite(selectedTime) ? selectedTime : undefined
  }, [timeConformanceView])

  const buildSelectedMetricModelFlows = useCallback((metric: 'average' | 'median') => {
    return performance_metrics.flows.model.map((flow) => ({
      ...flow,
      selected_sojourn: getSelectedFlowTime(metric, flow)
    }))
  }, [performance_metrics.flows.model])

  const buildSelectedMetricTimeConformance = useCallback((
    metric: 'average' | 'median'
  ): TimeConformanceFlowMetrics => {
    return time_conformance.map((flow) => {
      const selectedValues = getSelectedTimeConformanceValues(
        flow,
        metric,
        getSelectedActivityExecutionTime(flow.to, metric)
      )

      return {
        ...flow,
        avg_waiting_time: selectedValues.averageWaitingTime,
        avg_target_time: selectedValues.averageActivityTime
      }
    })
  }, [getSelectedActivityExecutionTime, getSelectedTimeConformanceValues, time_conformance])

  const buildSelectedMetricLabelData = useCallback((metric: 'average' | 'median') => {
    if (!viewerRef.current) return null

    const elementRegistry = viewerRef.current.get('elementRegistry') as any
    if (!elementRegistry) return null

    const activityPaths = buildModelActivityPathsFromFlows(
      xml,
      performance_metrics.flows.model,
      model_next_activities
    )

    return buildModelPerformanceLabelData({
      activityPaths,
      modelFlows: buildSelectedMetricModelFlows(metric),
      modelActivities: performance_metrics.activities.model,
      timeConformance: buildSelectedMetricTimeConformance(metric),
      elementRegistry
    })
  }, [
    xml,
    model_next_activities,
    performance_metrics.activities.model,
    performance_metrics.flows.model,
    buildSelectedMetricModelFlows,
    buildSelectedMetricTimeConformance
  ])

  const updateRenderedTimeConformanceActivityMetricLabels = useCallback((metric: 'average' | 'median') => {
    if (!viewerRef.current) return

    const elementRegistry = viewerRef.current.get('elementRegistry') as any
    const activityElements = elementRegistry.getAll?.().filter((element: any) => {
      const bo = element.businessObject
      return bo?.name && bo?.$type && (
        bo.$type.includes('Task') ||
        bo.$type === 'bpmn:Activity' ||
        bo.$type === 'bpmn:SubProcess'
      )
    }) || []

    activityElements.forEach((activity: any) => {
      const currentName = activity.businessObject?.name
      if (!currentName) return

      const baseName = stripFrequencySuffix(currentName)
      const normalizedName = normalizeActivityName(baseName)
      const activePerformanceMetrics = selectedPerformanceMetricsRef.current
      const selectedActivityMetrics = timeConformanceView === 'deviations'
        ? activePerformanceMetrics.activities.all
        : activePerformanceMetrics.activities.model
      const selectedActivityMetric = selectedActivityMetrics[normalizedName] as typeof selectedActivityMetrics[string] & {
        selected_sojourn?: number
      } | undefined
      const selectedMetricTime = selectedActivityMetric?.selected_sojourn
      const activityMetricTime = modelActivityMetricTimeRef.current.get(normalizedName)
      const selectedTime = Number.isFinite(selectedMetricTime)
        ? selectedMetricTime
        : metric === 'median'
          ? activityMetricTime?.median
          : activityMetricTime?.average

      if (!Number.isFinite(selectedTime)) return

      const labelText = `(${!selectedTime ? 'N/A' : formatSecondsFull(selectedTime, false)})`
      activity.businessObject.name = `${baseName}\n${labelText}`

      const gfx = elementRegistry.getGraphics(activity)
      const text = gfx?.querySelector('text') as SVGTextElement | null
      const tspans = text?.querySelectorAll('tspan')

      if (!text || !tspans?.length) return

      const visual = gfx.querySelector('.djs-visual') || gfx
      const activityShape = Array.from(visual.querySelectorAll('rect, path, circle, ellipse, polygon')).find((node) => {
        return (node as SVGElement).getAttribute(BPMN_AUGMENTATION_ATTRS.type) !== 'time-conformance-background'
      }) as SVGGraphicsElement | undefined
      const activityShapeBox = activityShape?.getBBox()
      const centerX = activityShapeBox
        ? String(activityShapeBox.x + activityShapeBox.width / 2)
        : Number.isFinite(activity.x) && Number.isFinite(activity.width)
          ? String(activity.x + activity.width / 2)
          : (
            text.getAttribute('x') ||
            (tspans[0] as SVGTSpanElement).getAttribute('x') ||
            '0'
          )

      text.setAttribute('text-anchor', 'middle')
      tspans.forEach((tspan) => {
        tspan.setAttribute('x', centerX)
        tspan.setAttribute('text-anchor', 'middle')
      })

      const metricLine = tspans[tspans.length - 1] as SVGTSpanElement
      metricLine.textContent = labelText
    })
  }, [timeConformanceView])

  const updateRenderedTimeConformanceFlowMetricLabelsAndColors = useCallback((
    modelPerformanceLabelData: ModelPerformanceLabelData
  ) => {
    const svg = containerRef.current?.querySelector('svg')
    const elementRegistry = viewerRef.current?.get('elementRegistry') as any
    if (!svg || !elementRegistry) return

    clearTimeConformanceStyles(containerRef.current, 'inline')

    const updateFlowLabelGroup = (group: Element, value: number | undefined) => {
      const text = group.querySelector('text') as SVGTextElement | null
      const rect = group.querySelector('rect') as SVGRectElement | null
      if (!text || !rect) return

      const label = Number.isFinite(value)
        ? formatSecondsHuman(value as number)
        : 'N/A'

      text.textContent = label

      const textX = Number.parseFloat(text.getAttribute('x') || '0')
      const rectHeight = Number.parseFloat(rect.getAttribute('height') || '16')
      const paddingX = 4
      let bgWidth = label.length * 7

      try {
        bgWidth = text.getBBox().width + paddingX * 2
      } catch {
        bgWidth = label.length * 7
      }

      rect.setAttribute('x', String(textX - bgWidth / 2))
      rect.setAttribute('width', String(bgWidth))
      rect.setAttribute('height', String(rectHeight))
    }

    svg.querySelectorAll(bpmnAugmentationSelector('flow-label', { labelMode: 'direct' })).forEach((group) => {
      const flowId = group.getAttribute(BPMN_AUGMENTATION_ATTRS.elementId)
      if (!flowId) return

      const topPathData = modelPerformanceLabelData.elementSojourns[flowId]?.paths
        ? Object.values(modelPerformanceLabelData.elementSojourns[flowId].paths)
            .sort((pathA, pathB) => pathB.selected_sojourn - pathA.selected_sojourn)[0]
        : undefined
      const inlineValue = modelPerformanceLabelData.inlineLabelAverages[flowId]
      const conformance = modelPerformanceLabelData.inlineLabelConformance[flowId] ?? topPathData?.conformance
      const flowElement = elementRegistry.get(flowId)
      const targetElementId = topPathData?.targetElementId ?? flowElement?.businessObject?.targetRef?.id

      updateFlowLabelGroup(group, inlineValue ?? topPathData?.selected_sojourn)
      applyTimeConformanceStyle({
        elementRegistry,
        container: containerRef.current,
        labelFlowId: flowId,
        targetElementId,
        labelGroup: group,
        conformance,
        scope: 'inline'
      })
    })

    svg.querySelectorAll(bpmnAugmentationSelector('flow-label', { labelMode: 'path' })).forEach((group) => {
      const flowId = group.getAttribute(BPMN_AUGMENTATION_ATTRS.elementId)
      const pathKey = group.getAttribute(BPMN_AUGMENTATION_ATTRS.pathKey)
      if (!flowId || !pathKey) return

      const pathData = modelPerformanceLabelData.elementSojourns[flowId]?.paths[pathKey]

      updateFlowLabelGroup(group, pathData?.selected_sojourn)
      applyTimeConformanceStyle({
        elementRegistry,
        container: containerRef.current,
        labelFlowId: pathData?.labelFlowId ?? flowId,
        pathElementIds: pathData?.elements,
        sourceElementId: pathData?.sourceElementId,
        targetElementId: pathData?.targetElementId,
        labelGroup: group,
        conformance: pathData?.conformance,
        scope: 'inline'
      })
    })
  }, [])

  const updateRenderedDeviationActivityMetricLabels = useCallback((metric: 'average' | 'median') => {
    if (!viewerRef.current || timeConformanceView !== 'deviations') return

    const elementRegistry = viewerRef.current.get('elementRegistry') as any
    const deviationActivityNames = new Set([...activitiesToStyle, ...secondaryActivitiesToStyle])
    const activityElements = elementRegistry.getAll?.().filter((element: any) => {
      const bo = element.businessObject
      return bo?.name && bo?.$type && (
        bo.$type.includes('Task') ||
        bo.$type === 'bpmn:Activity' ||
        bo.$type === 'bpmn:SubProcess'
      )
    }) || []

    activityElements.forEach((activity: any) => {
      const currentName = activity.businessObject?.name
      if (!currentName) return

      const baseName = stripFrequencySuffix(currentName)
      const normalizedName = normalizeActivityName(baseName)
      const lookupName = normalizedName === 'no-label' && deviationActivityNames.has('') ? '' : normalizedName
      if (!deviationActivityNames.has(lookupName)) return

      const metricData = performance_metrics.activities.deviations[lookupName]
      if (!metricData) return

      const selectedTime = metric === 'median'
        ? metricData.median_sojourn
        : metricData.avg_sojourn
      if (!Number.isFinite(selectedTime)) return

      const labelText = `(${formatSecondsFull(selectedTime, false)})`
      activity.businessObject.name = `${baseName}\n${labelText}`

      const gfx = elementRegistry.getGraphics(activity)
      const text = gfx?.querySelector('text') as SVGTextElement | null
      const tspans = text?.querySelectorAll('tspan')
      if (!text || !tspans?.length) return

      const metricLine = tspans[tspans.length - 1] as SVGTSpanElement
      metricLine.textContent = labelText
      metricLine.style.fontWeight = '700'
      metricLine.style.fontSize = '13px'
    })
  }, [
    timeConformanceView,
    activitiesToStyle,
    secondaryActivitiesToStyle,
    performance_metrics.activities.deviations
  ])

  const updateRenderedDeviationArrowMetricLabels = useCallback((metric: 'average' | 'median') => {
    if (timeConformanceView !== 'deviations') return

    const flowTimeByPair = new Map<string, number>()
    performance_metrics.flows.deviations.forEach((flow) => {
      const selectedTime = metric === 'median'
        ? flow.median_sojourn
        : flow.avg_sojourn
      flowTimeByPair.set(`${flow.from}::${flow.to}`, selectedTime)
    })

    containerRef.current?.querySelectorAll(bpmnAugmentationSelector('deviation-arrow')).forEach((group) => {
      const from = group.getAttribute(BPMN_AUGMENTATION_ATTRS.from)
      const rawTo = group.getAttribute(BPMN_AUGMENTATION_ATTRS.to)
      if (from === null || rawTo === null) return

      const to = rawTo.startsWith('<<end>>:')
        ? '<<end>>'
        : rawTo
      const value = flowTimeByPair.get(`${from}::${to}`)
      const label = Number.isFinite(value)
        ? formatSecondsFull(value as number, false)
        : 'N/A'
      const text = group.querySelector('text') as SVGTextElement | null
      const rect = group.querySelector('rect') as SVGRectElement | null
      if (!text || !rect) return

      text.textContent = label

      const textX = Number.parseFloat(text.getAttribute('x') || '0')
      const paddingX = 8
      let bgWidth = label.length * 7 + paddingX * 2
      try {
        bgWidth = text.getBBox().width + paddingX * 2
      } catch {
        bgWidth = label.length * 7 + paddingX * 2
      }

      rect.setAttribute('x', String(textX - bgWidth / 2))
      rect.setAttribute('width', String(bgWidth))
    })
  }, [timeConformanceView, performance_metrics.flows.deviations])

  const refreshTimeConformanceMetricVisuals = useCallback((metric: 'average' | 'median', installActivityInteractions = true) => {
    if (!isLoaded || viewMode !== 'performance' || !viewerRef.current) return

    const modelPerformanceLabelData = buildSelectedMetricLabelData(metric)
    if (!modelPerformanceLabelData) return

    modelPerformanceLabelDataRef.current = modelPerformanceLabelData
    updateRenderedTimeConformanceFlowMetricLabelsAndColors(modelPerformanceLabelData)
    updateRenderedTimeConformanceActivityMetricLabels(metric)
    updateRenderedDeviationActivityMetricLabels(metric)
    updateRenderedDeviationArrowMetricLabels(metric)
    setClickedElement((currentClickedElement) => resolveClickedElementMetricData(currentClickedElement))
    if (installActivityInteractions) {
      installTimeConformanceActivityInteractions()
    }
  }, [
    isLoaded,
    viewMode,
    buildSelectedMetricLabelData,
    installTimeConformanceActivityInteractions,
    updateRenderedTimeConformanceActivityMetricLabels,
    updateRenderedTimeConformanceFlowMetricLabelsAndColors,
    updateRenderedDeviationActivityMetricLabels,
    updateRenderedDeviationArrowMetricLabels
  ])

  const restoreTimeConformanceInlineVisuals = useCallback(() => {
    if (!isLoaded || viewMode !== 'performance' || !viewerRef.current) return

    const modelPerformanceLabelData = buildSelectedMetricLabelData(performanceMetric)
    if (!modelPerformanceLabelData) return

    modelPerformanceLabelDataRef.current = modelPerformanceLabelData
    updateRenderedTimeConformanceFlowMetricLabelsAndColors(modelPerformanceLabelData)
    updateRenderedTimeConformanceActivityMetricLabels(performanceMetric)
    updateRenderedDeviationActivityMetricLabels(performanceMetric)
    updateRenderedDeviationArrowMetricLabels(performanceMetric)
  }, [
    isLoaded,
    viewMode,
    performanceMetric,
    buildSelectedMetricLabelData,
    updateRenderedTimeConformanceFlowMetricLabelsAndColors,
    updateRenderedTimeConformanceActivityMetricLabels,
    updateRenderedDeviationActivityMetricLabels,
    updateRenderedDeviationArrowMetricLabels
  ])

  const applyTimeConformanceDeviationAugmentations = useCallback(() => {
    if (!viewerRef.current || timeConformanceView !== 'deviations') return

    containerRef.current
      ?.querySelectorAll(bpmnAugmentationSelector('deviation-arrow'))
      .forEach((node) => node.remove())

    activitiesToStyle.forEach((activity) => {
      styleDeviationActivityElement({
        viewer: viewerRef.current,
        activityName: activity,
        isSecondary: false,
        getActivityColor: () => '#ffffff'
      })
    })

    secondaryActivitiesToStyle.forEach((activity) => {
      styleDeviationActivityElement({
        viewer: viewerRef.current,
        activityName: activity,
        isSecondary: true,
        getActivityColor: () => '#ffffff'
      })
    })

    styleDeviationLaneElements({
      viewer: viewerRef.current,
      deviationLanes
    })

    styleDeviationEndEventElements({
      viewer: viewerRef.current,
      endEventIds
    })

    let nextConnectionPointsUsage = new Map(connectionPointsUsage)
    arrowsToCreate.forEach((arrow) => {
      createSmartDeviationArrowElement({
        container: containerRef.current,
        activitiesCoordinates,
        connectionPointsUsage: nextConnectionPointsUsage,
        onConnectionPointsUsageChange: (updatedUsage) => {
          nextConnectionPointsUsage = updatedUsage
        },
        from: arrow.from,
        to: arrow.to,
        label: arrow.label,
        isSecondary: Boolean(arrow.isSecondary),
        primaryStroke: '#111827',
        secondaryStroke: '#9CA3AF'
      })
    })
    setConnectionPointsUsage(nextConnectionPointsUsage)
  }, [
    timeConformanceView,
    activitiesToStyle,
    secondaryActivitiesToStyle,
    deviationLanes,
    endEventIds,
    arrowsToCreate,
    activitiesCoordinates
  ])

  useEffect(() => {
    if (!isLoaded || viewMode !== 'performance' || !viewerRef.current) {
      cleanupTimeConformanceAugmentations()
      setTimeActivityTooltip(null)
      return
    }

    const cleanupActivityTooltips = installTimeConformanceActivityTooltips()
    const animationFrameIds: number[] = []
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    const scheduleFrame = (callback: FrameRequestCallback) => {
      const frameId = requestAnimationFrame(callback)
      animationFrameIds.push(frameId)
    }

    scheduleFrame(() => {
      refreshTimeConformanceMetricVisuals(performanceMetricRef.current, false)

      if (timeConformanceView !== 'deviations') {
        installTimeConformanceActivityInteractions()
        setShowViewer(true)
        return
      }

      timeoutId = setTimeout(() => {
        applyTimeConformanceDeviationAugmentations()
        scheduleFrame(() => {
          installTimeConformanceActivityInteractions()
          setShowViewer(true)
        })
      }, 200)
    })

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      animationFrameIds.forEach((frameId) => cancelAnimationFrame(frameId))
      cleanupTimeConformanceAugmentations()
      cleanupActivityTooltips()
    }
  }, [
    isLoaded,
    viewMode,
    timeConformanceView,
    cleanupTimeConformanceAugmentations,
    installTimeConformanceActivityInteractions,
    installTimeConformanceActivityTooltips,
    refreshTimeConformanceMetricVisuals,
    applyTimeConformanceDeviationAugmentations
  ])

  useEffect(() => {
    if (!isLoaded || viewMode !== 'performance' || !viewerRef.current || !clickedElement) {
      clearTimeConformanceStyles(containerRef.current, 'selected')
      containerRef.current?.querySelectorAll(bpmnAugmentationSelector('flow-label', { labelMode: 'path' })).forEach((node) => node.remove())
      restoreTimeConformanceInlineVisuals()

      if (viewerRef.current) {
        applyModelPerformanceFocusOpacity({
          viewer: viewerRef.current,
          container: containerRef.current,
          clickedElement: null
        })
      }

      return
    }

    let animationFrameId = 0

    drawSelectedModelPerformancePathLabel({
      viewer: viewerRef.current,
      container: containerRef.current,
      clickedElement,
      paintSelectedSourceActivity: timeConformanceView === 'deviations'
    })

    applyModelPerformanceFocusOpacity({
      viewer: viewerRef.current,
      container: containerRef.current,
      clickedElement
    })

    const elementRegistry = viewerRef.current.get('elementRegistry') as any
    const canvas = viewerRef.current.get('canvas') as any

    if (elementRegistry && canvas) {

      const elementIdsToInspect = new Set<string>()
      elementIdsToInspect.add(clickedElement.elementId)

      if (clickedElement.paths) {
        Object.entries(clickedElement.paths).forEach(([pathKey, pathData]) => {
          const isPathChecked = clickedElement.checkedPaths?.[pathKey] ?? true
          if (!isPathChecked) return

          pathData.elements.forEach(elementId => {
            elementIdsToInspect.add(elementId)
          })
        })
      }

      const elementIdsForBounds = new Set<string>()
      const deviationArrowBounds: DiagramBounds[] = []
      elementIdsToInspect.forEach((elementId) => {
        const element = elementRegistry.get(elementId)
        if (!element) {
          const arrowGroup = containerRef.current?.querySelector(
            bpmnAugmentationSelector('deviation-arrow', { id: elementId })
          ) as SVGGraphicsElement | null
          if (!arrowGroup) return

          try {
            const bbox = arrowGroup.getBBox()
            deviationArrowBounds.push({
              minX: bbox.x,
              minY: bbox.y,
              maxX: bbox.x + bbox.width,
              maxY: bbox.y + bbox.height
            })
          } catch {
            // Ignore SVG nodes that cannot provide bounds yet.
          }
          return
        }

        elementIdsForBounds.add(elementId)

        const bo = element.businessObject
        if (bo?.$type === 'bpmn:SequenceFlow') {
          const sourceRefId = bo.sourceRef?.id
          const targetRefId = bo.targetRef?.id
          if (sourceRefId) elementIdsForBounds.add(sourceRefId)
          if (targetRefId) elementIdsForBounds.add(targetRefId)
        }
      })

      const collectBounds = (element: any): DiagramBounds | null => {
        if (!element) return null

        if (element.waypoints && element.waypoints.length > 0) {
          const xs = element.waypoints.map((wp: any) => wp.x)
          const ys = element.waypoints.map((wp: any) => wp.y)
          return {
            minX: Math.min(...xs),
            minY: Math.min(...ys),
            maxX: Math.max(...xs),
            maxY: Math.max(...ys)
          }
        }

        if (
          Number.isFinite(element.x) &&
          Number.isFinite(element.y) &&
          Number.isFinite(element.width) &&
          Number.isFinite(element.height)
        ) {
          return {
            minX: element.x,
            minY: element.y,
            maxX: element.x + element.width,
            maxY: element.y + element.height
          }
        }

        return null
      }

      let targetBounds: DiagramBounds | null = null

      elementIdsForBounds.forEach((elementId) => {
        const element = elementRegistry.get(elementId)
        const bounds = collectBounds(element)
        if (!bounds) return

        if (!targetBounds) {
          targetBounds = bounds
          return
        }

        targetBounds.minX = Math.min(targetBounds.minX, bounds.minX)
        targetBounds.minY = Math.min(targetBounds.minY, bounds.minY)
        targetBounds.maxX = Math.max(targetBounds.maxX, bounds.maxX)
        targetBounds.maxY = Math.max(targetBounds.maxY, bounds.maxY)
      })

      deviationArrowBounds.forEach((bounds) => {
        if (!targetBounds) {
          targetBounds = { ...bounds }
          return
        }

        targetBounds.minX = Math.min(targetBounds.minX, bounds.minX)
        targetBounds.minY = Math.min(targetBounds.minY, bounds.minY)
        targetBounds.maxX = Math.max(targetBounds.maxX, bounds.maxX)
        targetBounds.maxY = Math.max(targetBounds.maxY, bounds.maxY)
      })

      if (targetBounds && containerRef.current) {
        const resolvedBounds = targetBounds as DiagramBounds

        const PADDING = 80
        const focusedMinX = resolvedBounds.minX - PADDING
        const focusedMinY = resolvedBounds.minY - PADDING
        const focusedMaxX = resolvedBounds.maxX + PADDING
        const focusedMaxY = resolvedBounds.maxY + PADDING
        const targetWidth = Math.max(1, focusedMaxX - focusedMinX)
        const targetHeight = Math.max(1, focusedMaxY - focusedMinY)
        const targetCenterX = focusedMinX + targetWidth / 2
        const targetCenterY = focusedMinY + targetHeight / 2
        const viewportWidth = Math.max(1, containerRef.current.clientWidth)
        const viewportHeight = Math.max(1, containerRef.current.clientHeight)
        const viewportAspect = viewportWidth / viewportHeight
        const targetAspect = targetWidth / targetHeight

        let nextViewboxWidth = targetWidth
        let nextViewboxHeight = targetHeight

        if (targetAspect > viewportAspect) {
          nextViewboxHeight = targetWidth / viewportAspect
        } else {
          nextViewboxWidth = targetHeight * viewportAspect
        }

        const nextViewbox = {
          x: targetCenterX - nextViewboxWidth / 2 + 50,
          y: targetCenterY - nextViewboxHeight / 2,
          width: nextViewboxWidth,
          height: nextViewboxHeight
        }

        const currentViewbox = canvas.viewbox()
        if (!currentViewbox) {
          canvas.viewbox(nextViewbox)
        } else {
          const prefersReducedMotion = typeof window !== 'undefined' &&
            window.matchMedia &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches

          const isAlreadyAtTarget =
            Math.abs(currentViewbox.x - nextViewbox.x) < 1 &&
            Math.abs(currentViewbox.y - nextViewbox.y) < 1 &&
            Math.abs(currentViewbox.width - nextViewbox.width) < 1 &&
            Math.abs(currentViewbox.height - nextViewbox.height) < 1

          if (prefersReducedMotion || isAlreadyAtTarget) {
            canvas.viewbox(nextViewbox)
          } else {
            const DURATION_MS = 320
            const animationStart = performance.now()
            const easeInOutCubic = (t: number) =>
              t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

            const animate = (timestamp: number) => {
              const elapsed = timestamp - animationStart
              const progress = Math.min(1, elapsed / DURATION_MS)
              const eased = easeInOutCubic(progress)

              canvas.viewbox({
                x: currentViewbox.x + (nextViewbox.x - currentViewbox.x) * eased,
                y: currentViewbox.y + (nextViewbox.y - currentViewbox.y) * eased,
                width: currentViewbox.width + (nextViewbox.width - currentViewbox.width) * eased,
                height: currentViewbox.height + (nextViewbox.height - currentViewbox.height) * eased
              })

              if (progress < 1) {
                animationFrameId = requestAnimationFrame(animate)
              }
            }

            animationFrameId = requestAnimationFrame(animate)
          }
        }
      }
    }

    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId)
      }

      clearTimeConformanceStyles(containerRef.current, 'selected')
      containerRef.current?.querySelectorAll(bpmnAugmentationSelector('flow-label', { labelMode: 'path' })).forEach((node) => node.remove())
      restoreTimeConformanceInlineVisuals()

      if (viewerRef.current) {
        applyModelPerformanceFocusOpacity({
          viewer: viewerRef.current,
          container: containerRef.current,
          clickedElement: null
        })
      }
    }
  }, [clickedElement, isLoaded, viewMode, restoreTimeConformanceInlineVisuals])

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    isDraggingRef.current = true
    setIsDragging(true)
    e.currentTarget.style.cursor = 'grabbing'
    e.preventDefault()
  }

  const handleMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    isDraggingRef.current = false
    setIsDragging(false)
    e.currentTarget.style.cursor = 'grab'
  }

  const handleMouseLeave = (e: React.MouseEvent<HTMLDivElement>) => {
    isDraggingRef.current = false
    setIsDragging(false)
    e.currentTarget.style.cursor = 'grab'
  }

  const showConformanceHeatmap = (
    (viewMode === 'alignments' && subViewMode === 'conformance') ||
    viewMode === 'performance'
  )

  const clickedElementDisplayName = useMemo(() => {
    if (!clickedElement || !viewerRef.current) return clickedElement?.elementId || ''

    const elementRegistry = viewerRef.current.get('elementRegistry') as any
    const element = elementRegistry?.get(clickedElement.elementId)
    const rawName = element?.businessObject?.name
    if (!rawName) return clickedElement.elementId

    return stripFrequencySuffix(rawName).replace(/\s*\n\s*/g, ' ').trim() || clickedElement.elementId
  }, [clickedElement])

  return (
    <div className={`w-full h-full relative ${className}`}>
      <BpmnZoomControls
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onFitViewport={handleFitViewport}
        onReset={handleReset}
        isLoaded={isLoaded}
        topPosition={`${showConformanceHeatmap ? 'top-32' : 'top-2'}`}
        onImageDown={async () => {
          await ToastPromise(
            handleSvgDownload('alignments', subViewMode, containerRef),
            t('imageDownload.exporting'),
            t('imageDownload.success'),
            t('imageDownload.failure')
          )
        }}
      />

      <div
        className={`absolute top-0 left-0 z-30 h-full ${
          !(viewMode === 'performance' && clickedElement) ? '' : 'hidden'
        }`}
      >
        <BpmnAlignmentsLegend
          activitiesWithAvgTime={timeConformanceLegendActivities}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          subViewMode={subViewMode}
          onSubViewModeChange={setSubViewMode}
          timeConformanceView={timeConformanceView}
          onTimeConformanceViewChange={setTimeConformanceView}
          performanceMetric={performanceMetric}
          onPerformanceMetricChange={handlePerformanceMetricChange}
          hasTimeConformanceData={hasTimeConformanceData}
          selectedMoveTypes={selectedMoveTypes}
          onMoveTypeToggle={handleMoveTypeToggle}
        />
      </div>

      <BpmnConformanceHeatmap
        isVisible={showConformanceHeatmap}
        titleConformanceKey={viewMode === 'performance' ? 'legend.timeConformanceHeatmap' : 'legend.conformanceHeatmap'}
        lessConformanceKey={viewMode === 'performance' ? 'legend.lessTimeConformance' : 'legend.lessConformance'}
        higherConformanceKey={viewMode === 'performance' ? 'legend.higherTimeConformance' : 'legend.higherConformance'}
        gradient={viewMode === 'performance'
          ? 'linear-gradient(to right, rgb(0, 255, 0), rgb(255, 0, 0))'
          : 'linear-gradient(to right, rgb(255, 0, 0), rgb(0, 255, 0))'}
      />

      {!showViewer && (
        <div className="absolute inset-0 flex items-center justify-center bg-white z-20">
          <div
            className="w-12 h-12 border-4 border-[#e0e0e0] border-t-[#808080] rounded-full animate-spin"
            style={{ borderTopColor: '#808080' }}
          />
        </div>
      )}
      
      <div 
        ref={containerRef} 
        className="w-full h-full bg-white select-none relative"
        style={{ 
          minHeight: '70vh', 
          cursor: isDragging ? 'grabbing' : 'grab',
          WebkitUserSelect: 'none',
          MozUserSelect: 'none',
          msUserSelect: 'none',
          userSelect: 'none',
          opacity: showViewer ? 1 : 0,
          transition: 'opacity 0.2s ease-in-out'
        }}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onDragStart={(e) => e.preventDefault()}
      />
      
      {viewMode === 'alignments' && tooltip && (
        <BpmnAlignmentsConformanceTooltip
          activityName={tooltip.activityName}
          type={subViewMode}
          moveData={tooltip.moveData}
          position={tooltip.position}
        />
      )}

      {viewMode === 'performance' && timeActivityTooltip && (() => {
        const incomingFlows = time_conformance
          .filter((flow) => normalizeActivityName(flow.to) === timeActivityTooltip.normalizedActivityName)
        const requiresPathSelectionForActivity = timeConformancePathSelectionActivities.has(timeActivityTooltip.normalizedActivityName)
        const incomingFlow = incomingFlows.length === 1 ? incomingFlows[0] : undefined
        const selectedPathConformance = clickedElement?.paths
          ? Object.entries(clickedElement.paths).find(([pathKey]) => {
            return clickedElement.checkedPaths?.[pathKey] ?? true
          })?.[1].conformance
          : undefined
        const selectedPathFlow = selectedPathConformance?.to === timeActivityTooltip.normalizedActivityName
          ? selectedPathConformance
          : undefined
        const shouldRequestPathSelection = requiresPathSelectionForActivity && !selectedPathFlow
        const selectedMetricFlow = selectedPathFlow
          ? time_conformance.find((flow) => (
            normalizePerformanceMetricKey(flow.from) === selectedPathFlow.from &&
            normalizePerformanceMetricKey(flow.to) === selectedPathFlow.to
          ))
          : incomingFlow
        const selectedMetricTimes = selectedMetricFlow
          ? getSelectedTimeConformanceValues(
            selectedMetricFlow,
            performanceMetric,
            getSelectedActivityExecutionTime(selectedMetricFlow.to, performanceMetric)
          )
          : undefined

        return (
          <BpmnTimeConformanceActivityTooltip
            activityName={timeActivityTooltip.activityName}
            x={timeActivityTooltip.position.x}
            y={timeActivityTooltip.position.y}
            executionTime={selectedMetricTimes?.averageActivityTime ?? selectedPathFlow?.averageActivityTime ?? Number.NaN}
            waitingTime={selectedMetricTimes?.averageWaitingTime ?? selectedPathFlow?.averageWaitingTime ?? Number.NaN}
            realCycleTime={selectedMetricTimes?.realCycleTime ?? selectedPathFlow?.observedTime ?? Number.NaN}
            estimatedCycleTime={selectedMetricTimes?.estimatedCycleTime ?? selectedPathFlow?.cycleTime ?? Number.NaN}
            requiresPathSelection={shouldRequestPathSelection}
          />
        )
      })()}

      {viewMode === 'performance' && clickedElement && (
        <BpmnPerformancePathTooltip
          elementId={clickedElementDisplayName}
          x="left-4"
          y="top-39.5"
          selected_sojourn={clickedElement.avg_sojourn ?? Number.NaN}
          paths={clickedElement.paths}
          checkedByPath={clickedElement.checkedPaths}
          onPathSelected={(pathKey) => {
            setClickedElement((prev) => {
              if (!prev || !prev.paths) return prev

              return {
                ...prev,
                checkedPaths: Object.keys(prev.paths).reduce<Record<string, boolean>>((acc, key) => {
                  acc[key] = key === pathKey
                  return acc
                }, {})
              }
            })
          }}
        />
      )}
    </div>
  )
}
