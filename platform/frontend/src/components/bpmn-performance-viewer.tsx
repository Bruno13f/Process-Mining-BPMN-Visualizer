import { useEffect, useMemo, useRef, useState } from 'react'
import type { ActivityCoordinatesCollection, DeviationActivitySizeProfile, LaneElements } from '@/types/analysis-frontend'
import type { PerformanceMetrics, HelperVariables, PerformanceFlowMetric, PerformanceActivityMetric } from '@/types/analysis-backend'
import { formatSecondsFull, formatSecondsHuman, normalizeActivityName } from '../utils/functions'
import {
  BPMN_AUGMENTATION_ATTRS,
  bpmnAugmentationSelector,
  setBpmnAugmentationAttributes,
  stripFrequencySuffix as utilsStripFrequencySuffix
} from '../utils/bpmn-utils'
import { BpmnZoomControls } from './ui/bpmn-zoom-controls'
import { useBpmnViewer, useBpmnViewMode, useBpmnZoom, useBpmnDrag, useBpmnImport } from '@/hooks'
import { BpmnPerformanceHeatmap } from './bpmn-performance-heatmap'
import { BpmnPerformanceLegend } from './bpmn-performance-legend'
import { BpmnPerformanceTooltip } from './bpmn-performance-tooltip'
import { BpmnPerformanceActivityRoles } from './bpmn-performance-activity-roles'
import { BpmnPerformancePathTooltip } from './bpmn-performance-path-tooltip'
import { ToastPromise } from './ui/toast-promise'
import { useTranslation } from 'react-i18next'
import {
  applyModelPerformanceFocusOpacity,
  buildWithDeviationsActivityPathsFromFlows,
  drawSelectedModelPerformancePathLabel,
  installActivityPerformanceInteractions,
  type ModelPerformanceClickedElement,
  type ModelPerformanceLabelData
} from '@/utils/bpmn-viewer-performance'
import {
  buildGenericDeviationActivitiesAndLanes,
  buildGenericDeviationArrows,
  type GenericDeviationArrow,
  type GenericDeviationFlowMetric,
  applyDeviationActivityColorStyles,
  createActivityXML as createSharedActivityXML,
  createDeviationLane as createSharedDeviationLane,
  createEndEventXML as createSharedEndEventXML,
  getBpmnCoordinates as getCoordinates,
  findLaneForActivity as findSharedLaneForActivity,
  findPredecessorCoordinates as findSharedPredecessorCoordinates,
  findSafePosition as findSharedSafePosition,
  getSecondaryDeviationActivities,
  orderDeviationActivitiesByModelPredecessors as orderSharedDeviationActivitiesByModelPredecessors,
  createSmartDeviationArrowElement,
  styleDeviationActivityElement as styleDeviationActivity,
  styleDeviationEndEventElements as styleEndEvents,
  styleDeviationLaneElements as styleDeviationLanes
} from '@/utils/bpmn-viewer-deviations'

const stripFrequencySuffix = (name?: string) => {
  if (!name) return ''
  return utilsStripFrequencySuffix(name).trim()
}

interface BpmnPerformanceViewerProps {
  xml: string
  performance_metrics: PerformanceMetrics,
  helper_variables: HelperVariables
  deviationSizeProfile?: DeviationActivitySizeProfile
}

type DiagramBounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export function BpmnPerformanceViewer({ xml, performance_metrics, helper_variables, deviationSizeProfile }: BpmnPerformanceViewerProps) {
  
  const { t } = useTranslation();
  
  const containerRef = useRef<HTMLDivElement>(null)
  const legendContainerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useBpmnViewer(containerRef)
  const [isLoaded, setIsLoaded] = useState(false)
  const [showViewer, setShowViewer] = useState(false)
  const { viewMode, setViewMode, viewModeRef } = useBpmnViewMode('model')
  const { handleZoomIn, handleZoomOut, handleFitViewport, handleReset, handleSvgDownload } = useBpmnZoom(viewerRef)
  const { isDragging, handleMouseDown, handleMouseUp, handleMouseLeave } = useBpmnDrag()
  const { importAndSetupXML } = useBpmnImport(viewerRef)
  const { activities_roles, roles_lanes, model_next_activities, deviation_predecessors } = helper_variables
  
  const [arrowsToCreate, setArrowsToCreate] = useState<Array<GenericDeviationArrow & { selected_sojourn: number }>>([])
  const [activitiesToStyle, setActivitiesToStyle] = useState<string[]>([])
  const [secondaryActivitiesToStyle, setSecondaryActivitiesToStyle] = useState<string[]>([])
  const [modelFlowPaths, setModelFlowPaths] = useState<{from: string, to: string, waypoints: {x: number, y: number}[], avg_sojourn: number}[]>([])
  const [activitiesCoordinates, setActivitiesCoordinates] = useState<ActivityCoordinatesCollection>({})
  const [, setLanes] = useState<LaneElements>({})
  const [deviationLanes, setDeviationLanes] = useState<Set<string>>(new Set())
  const [endEventIds, setEndEventIds] = useState<Map<string, boolean>>(new Map())
  const [connectionPointsUsage, setConnectionPointsUsage] = useState<Map<string, {origins: number, destinations: number}>>(new Map())
  const [hoveredActivity, setHoveredActivity] = useState<{name: string, originalName: string, x: number, y: number} | null>(null)
  const activityTooltipHideTimeoutRef = useRef<number | null>(null)
  const [clickedElement, setClickedElement] = useState<{
    elementId: string,
    selected_sojourn: number,
    paths?: Record<string, {
      elements: string[]
      selected_sojourn: number
      sourceElementId?: string
      targetElementId?: string
      labelFlowId?: string
    }>,
    checkedPaths?: Record<string, boolean>
  } | null>(null)
  const [clickedActivity, setClickedActivity] = useState<{name: string, originalName: string, roles: {role: string, frequency: number}[], average_time: number, median_time: number, min_time: number, max_time: number} | null>(null)
  const [deviatedLanes, setDeviatedLanes] = useState<string[]>([])
  const [performanceMetric, setPerformanceMetric] = useState<'average' | 'median'>('average')
  const outsideClickPointerDown = useRef<{ x: number; y: number } | null>(null)
  const outsideClickMoved = useRef(false)
  const isDraggingRef = useRef(isDragging)

  const previousMetricRef = useRef(performanceMetric)
  const previousViewModeRef = useRef(viewMode)
  const shouldRebuildAfterDeviationFilterResetRef = useRef(false)

  const normalizeClickedElementForSharedFocus = (
    element: typeof clickedElement
  ): ModelPerformanceClickedElement => {
    if (!element) return null

    return {
      elementId: element.elementId,
      avg_sojourn: element.selected_sojourn,
      checkedPaths: element.checkedPaths,
      paths: element.paths
        ? Object.fromEntries(
          Object.entries(element.paths).map(([pathKey, pathData]) => [
            pathKey,
            {
              ...pathData,
              average: pathData.selected_sojourn
            }
          ])
        )
        : undefined
    }
  }

  const selectedPerformanceMetrics = useMemo(() => {
    const selectValue = (metrics: { avg_sojourn: number; median_sojourn: number }): number => {
      const median = metrics.median_sojourn

      return performanceMetric === 'median'
        ? Number.isFinite(median) ? median : metrics.avg_sojourn
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

  const performanceActivities = useMemo(() => {
    return viewMode === 'model' ? 
    selectedPerformanceMetrics.activities.model : 
    selectedPerformanceMetrics.activities.all
  }, [viewMode, selectedPerformanceMetrics.activities]);

  const activitiesRoles = useMemo(() => {
    return viewMode === 'model' ? 
    activities_roles.model : 
    activities_roles.all
  }, [viewMode, activities_roles]);

  const limitsSelectedSojournTimeActivities = useMemo(() => {
    let activities = viewMode == 'model' ? 
      Object.values(selectedPerformanceMetrics.activities.model) :
      Object.values(selectedPerformanceMetrics.activities.all);

    const values = activities.map(m => m.selected_sojourn);
    if (values.length === 0) return { min: 0, max: 0 };
    return {
      min: Math.min(...values),
      max: Math.max(...values),
    };
  }, [selectedPerformanceMetrics, viewMode]);

  const model_activities = useMemo(() => {
    return Object.entries(performanceActivities)
      .map(([normalizedName, data]) => ({
        normalizedName,
        originalName: data.originalActivity
      }))
  }, [performanceActivities])

  const limitsSelectedSojournTime = useMemo(() => {
    const flows = viewMode === 'deviations'
      ? selectedPerformanceMetrics.flows.deviations
      : selectedPerformanceMetrics.flows.all
    const values = flows
      .map(m => m.selected_sojourn)
      .filter(Number.isFinite)

    if (values.length === 0) return { min: 0, max: 0 };
    return {
      min: Math.min(...values),
      max: Math.max(...values),
    };
  }, [selectedPerformanceMetrics.flows, viewMode])

  const [withDeviationAvgTimeFilter, setWithDeviationAvgTimeFilter] = useState<[number, number] | null>(null)

  const activeDeviationAvgTimeFilter = useMemo<[number, number]>(() => {
    return withDeviationAvgTimeFilter ?? [
      limitsSelectedSojournTime.min,
      limitsSelectedSojournTime.max
    ]
  }, [withDeviationAvgTimeFilter, limitsSelectedSojournTime.min, limitsSelectedSojournTime.max])

  const hasPerformanceDeviationData = useMemo(() => {
    return Object.keys(selectedPerformanceMetrics.activities.deviations).length > 0 ||
      selectedPerformanceMetrics.flows.deviations.length > 0
  }, [selectedPerformanceMetrics.activities.deviations, selectedPerformanceMetrics.flows.deviations])

  const handlePerformanceMetricChange = (metric: 'average' | 'median') => {
    const isDeviationFilterCustomized =
      withDeviationAvgTimeFilter !== null &&
      (
        withDeviationAvgTimeFilter[0] !== limitsSelectedSojournTime.min ||
        withDeviationAvgTimeFilter[1] !== limitsSelectedSojournTime.max
      )

    setPerformanceMetric(metric)

    if (viewMode === 'deviations') {
      shouldRebuildAfterDeviationFilterResetRef.current = isDeviationFilterCustomized
      setWithDeviationAvgTimeFilter(null)
    }
  }

  const handlePerformanceViewModeChange = (mode: 'model' | 'deviations') => {
    if (mode === 'deviations' && !hasPerformanceDeviationData) return

    setViewMode(mode)

    if (mode === 'deviations') {
      setWithDeviationAvgTimeFilter(null)
    }
  }

  viewModeRef.current = viewMode
  isDraggingRef.current = isDragging

  useEffect(() => {
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
      if (!clickedElement) return
      if (outsideClickMoved.current || isDraggingRef.current) return

      const target = event.target as HTMLElement | null
      if (!target) return

      if (target.closest('[data-flow-tooltip="true"]') || target.closest('[data-activity-tooltip="true"]')) {
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

    const cleanupDocumentListeners = () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('click', handleDocumentClick)
    }

    const cleanupFocusViewbox = (() => {
    if (!clickedElement || !viewerRef.current || !isLoaded) return

    const elementRegistry = viewerRef.current.get('elementRegistry') as any
    const canvas = viewerRef.current.get('canvas') as any
    if (!elementRegistry || !canvas) return

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

    // Expand focus to include source/target activities of each sequence flow
    // and custom deviation-arrow endpoints.
    const elementIdsForBounds = new Set<string>()
    const deviationArrowBounds: DiagramBounds[] = []

    const getActivityElementIdByKey = (activityKey: string | null | undefined) => {
      if (activityKey === undefined || activityKey === null || activityKey === '<<end>>') return undefined

      const normalizedActivityKey = activityKey === ''
        ? 'no-label'
        : normalizeActivityName(activityKey)

      const activityElements = elementRegistry.filter((element: any) => {
        const elementType = element?.businessObject?.$type || element?.type || ''
        return elementType.includes('Task') ||
          elementType === 'bpmn:Task' ||
          elementType === 'bpmn:UserTask' ||
          elementType === 'bpmn:ServiceTask' ||
          elementType === 'bpmn:ManualTask' ||
          elementType === 'bpmn:ScriptTask' ||
          elementType === 'bpmn:SendTask' ||
          elementType === 'bpmn:ReceiveTask' ||
          elementType === 'bpmn:BusinessRuleTask'
      })

      const activityElement = activityElements.find((element: any) => {
        const rawName = element?.businessObject?.name || ''
        if (!rawName) return false

        return normalizeActivityName(stripFrequencySuffix(rawName)) === normalizedActivityKey
      })

      return activityElement?.id
    }

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

        const sourceElementId = getActivityElementIdByKey(arrowGroup.getAttribute(BPMN_AUGMENTATION_ATTRS.from))
        const targetElementId = getActivityElementIdByKey(arrowGroup.getAttribute(BPMN_AUGMENTATION_ATTRS.to))
        if (sourceElementId) elementIdsForBounds.add(sourceElementId)
        if (targetElementId) elementIdsForBounds.add(targetElementId)
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

    if (clickedElement.paths) {
      Object.entries(clickedElement.paths).forEach(([pathKey, pathData]) => {
        const isPathChecked = clickedElement.checkedPaths?.[pathKey] ?? true
        if (!isPathChecked) return

        if (pathData.sourceElementId) elementIdsForBounds.add(pathData.sourceElementId)
        if (pathData.targetElementId) elementIdsForBounds.add(pathData.targetElementId)
        if (pathData.labelFlowId) elementIdsToInspect.add(pathData.labelFlowId)
      })
    }

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

    if (!targetBounds || !containerRef.current) return
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
      return
    }

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
      return
    }

    const DURATION_MS = 320
    let animationFrameId = 0
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

    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId)
      }
    }
    })()

    const cleanupOpacityState = (() => {
      if (!viewerRef.current || !isLoaded) return

      applyModelPerformanceFocusOpacity({
        viewer: viewerRef.current,
        container: containerRef.current,
        clickedElement: normalizeClickedElementForSharedFocus(clickedElement)
      })

      return () => {
        applyModelPerformanceFocusOpacity({
          viewer: viewerRef.current,
          container: containerRef.current,
          clickedElement: null
        })
      }
    })()

    return () => {
      cleanupDocumentListeners()
      if (cleanupFocusViewbox) cleanupFocusViewbox()
      if (cleanupOpacityState) cleanupOpacityState()
    }
  }, [clickedElement, isLoaded])

  const getActivityColor = (activityNormalizedName: string): string => {
    activityNormalizedName = activityNormalizedName == 'no-label' ? "" : activityNormalizedName
    const activityMetric = performanceActivities[activityNormalizedName]
    const selectedSojourn = performanceMetric === 'median' && Number.isFinite(activityMetric?.median_sojourn)
      ? activityMetric.median_sojourn
      : activityMetric?.avg_sojourn
    if (!selectedSojourn) {
      return 'rgba(255, 255, 255, 1)' // Default to minimum color if activity not found
    }

    const avgTime = selectedSojourn
    const { min, max } = limitsSelectedSojournTimeActivities

    if (min === max) {
      return 'rgba(255, 0, 0, 0.6)'
    }

    const normalizedValue = (avgTime - min) / (max - min)

    const minOpacity = 0.2
    const maxOpacity = 0.8
    const opacity = minOpacity + normalizedValue * (maxOpacity - minOpacity)

    const color = `rgba(255, 0, 0, ${opacity.toFixed(2)})`
    console.log('[GET ACTIVITY COLOR] Calculated color:', color, 'normalizedValue:', normalizedValue, 'opacity:', opacity)

    return color
  }

  const filterDeviationsFlowsByConnectionAverageTime = (
    minAvgTime: number,
    maxAvgTime: number
  ): { activities: Record<string, number>; flows: Array<PerformanceFlowMetric & { selected_sojourn: number }> } => {
    const filteredFlows = selectedPerformanceMetrics.flows.deviations.filter(
      flow => flow.selected_sojourn >= minAvgTime && flow.selected_sojourn <= maxAvgTime
    )

    const activeActivities = new Set<string>()
    filteredFlows.forEach(flow => {
      activeActivities.add(flow.from)
      if (flow.to === '<<end>>') {
        activeActivities.add(`<<end>>:${flow.from}`)
      } else {
        activeActivities.add(flow.to)
      }
    })

    const filteredActivities: Record<string, number> = {}
    activeActivities.forEach((activity) => {
      filteredActivities[activity] = selectedPerformanceMetrics.activities.deviations[activity]?.avg_sojourn ?? 
                                    selectedPerformanceMetrics.activities.all[activity]?.avg_sojourn ?? 0
    })

    return {
      activities: filteredActivities,
      flows: filteredFlows
    }
  }

  const getActivityElements = () => {
    if (!viewerRef.current) return []

    const elementRegistry = viewerRef.current.get('elementRegistry') as any
    const elements = elementRegistry.getAll()

    return elements.filter((el: any) => {
      const bo = el.businessObject
      if (!bo) return false
      
      const isActivity = bo.$type && (
        bo.$type.includes('Task') || 
        bo.$type === 'bpmn:Activity' ||
        bo.$type === 'bpmn:SubProcess'
      )
      
      return isActivity && bo.name
    })
  }


  const applyActivityColorStyles = (
    gfx: any,
    backgroundColor: string,
    labelColor: string,
    strokeColor?: string,
  ) => {
    applyDeviationActivityColorStyles({ gfx, backgroundColor, labelColor, strokeColor })
  }

  const styleModelActivity = (activityName: string) => {
    if (!viewerRef.current) return
    activityName = activityName || "no-label"

    try {
      const activityElements = getActivityElements()

      const activity = activityElements.find((el: any) => {
        if (el.businessObject && el.businessObject.name) {
          const normalizedName = normalizeActivityName(
            stripFrequencySuffix(el.businessObject.name)
          )
          const targetNormalized = activityName
          return normalizedName === targetNormalized
        }
        return false
      })

      if (activity) {
        const elementRegistry = viewerRef.current!.get('elementRegistry') as any
        const gfx = elementRegistry.getGraphics(activity)
        if (gfx) {
          const activityFill = getActivityColor(activityName)
          const labelColor = '#000000'

          applyActivityColorStyles(gfx, activityFill, labelColor)

          console.log('✅ Model activity styled with frequency-based color:', activityName)
        }
      }
    } catch (error) {
      console.error('Error styling model activity:', error)
    }
  }

  const setupActivityHoverListeners = () => {
    if (!viewerRef.current) return

    try {
      const activityElements = getActivityElements()
      const elementRegistry = viewerRef.current.get('elementRegistry') as any

      activityElements.forEach((activity: any) => {
        const gfx = elementRegistry.getGraphics(activity)
        if (gfx) {
          const originalName = activity.businessObject?.name
          const displayName = stripFrequencySuffix(originalName)
          const activityName = normalizeActivityName(
            stripFrequencySuffix(originalName || '')
          )
          
          gfx.style.cursor = 'pointer'
          gfx.style.pointerEvents = 'auto'
          
          const handleMouseEnter = (e: MouseEvent) => {
            e.stopPropagation()
            clearActivityTooltipHideTimeout()
            
            // For tooltip lookup, use "" if activity is "no-label" and "" is in the list
            const lookupName = (activityName === 'no-label' && (activitiesToStyle.includes('') || secondaryActivitiesToStyle.includes(''))) ? '' : activityName
            
            const rect = gfx.getBoundingClientRect()
            setHoveredActivity({
              name: lookupName,
              originalName: displayName,
              x: rect.left + rect.width / 2,
              y: rect.top
            })
          }
          
          const handleMouseLeave = (e: MouseEvent) => {
            e.stopPropagation()
            const lookupName = (activityName === 'no-label' && (activitiesToStyle.includes('') || secondaryActivitiesToStyle.includes(''))) ? '' : activityName
            const roles = activitiesRoles[lookupName]

            if (roles && roles.length > 3) {
              scheduleActivityTooltipHide()
              return
            }

            clearActivityTooltipHideTimeout()
            setHoveredActivity(null)
          }
          
          gfx.addEventListener('mouseenter', handleMouseEnter)
          gfx.addEventListener('mouseleave', handleMouseLeave)
        }
      })

      console.log('✅ Hover listeners attached to all activities')
    } catch (error) {
      console.error('Error setting up hover listeners:', error)
    }
  }

  const createModelConnectionArrow = (
    flowPath: {from: string, to: string, waypoints: {x: number, y: number}[], avg_sojourn: number},
    minAvgSojourn: number,
    maxAvgSojourn: number
  ) => {
    if (!viewerRef.current || !isLoaded) return

    try {
      const { from, to, waypoints, avg_sojourn } = flowPath

      if (!waypoints || waypoints.length < 2) {
        console.warn(`❌ Not enough waypoints for flow ${from} -> ${to}`)
        return
      }

      console.log(`Creating model connection arrow: ${from} -> ${to} with ${waypoints.length} waypoints`)

      const arrowId = `model-arrow-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
      setBpmnAugmentationAttributes(group, 'model-arrow', {
        view: 'performance',
        from,
        to,
        id: arrowId
      })

      const minStrokeWidth = 2
      const maxStrokeWidth = 8
      let strokeWidth = maxStrokeWidth
      
      if (maxAvgSojourn > minAvgSojourn) {
        const normalizedValue = (avg_sojourn - minAvgSojourn) / (maxAvgSojourn - minAvgSojourn)
        strokeWidth = minStrokeWidth + normalizedValue * (maxStrokeWidth - minStrokeWidth)
      }

      const arrowheadSize = strokeWidth * 2.5

      const lastPoint = waypoints[waypoints.length - 1]
      const secondLastPoint = waypoints[waypoints.length - 2]
      const deltaX = lastPoint.x - secondLastPoint.x
      const deltaY = lastPoint.y - secondLastPoint.y
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY)
      const endAngle = Math.atan2(deltaY, deltaX)

      const shortenAmount = arrowheadSize * 0.5
      const shortenedLastPoint = {
        x: lastPoint.x - (deltaX / distance) * shortenAmount,
        y: lastPoint.y - (deltaY / distance) * shortenAmount
      }

      const adjustedWaypoints = waypoints.map((point, index) => 
        index === waypoints.length - 1 ? shortenedLastPoint : point
      )
      const pathData = adjustedWaypoints.map((point, index) => 
        index === 0 ? `M ${point.x} ${point.y}` : `L ${point.x} ${point.y}`
      ).join(' ')

      const minGray = 100
      const maxGray = 3
      let grayValue = maxGray
      
      if (maxAvgSojourn > minAvgSojourn) {
        const normalizedValue = (avg_sojourn - minAvgSojourn) / (maxAvgSojourn - minAvgSojourn)
        grayValue = minGray - normalizedValue * (minGray - maxGray)
      }

      const strokeColor = `rgb(${grayValue}, ${grayValue}, ${grayValue})`

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      path.setAttribute('d', pathData)
      path.setAttribute('stroke', strokeColor)
      path.setAttribute('stroke-width', strokeWidth.toString())
      path.setAttribute('fill', 'none')
      path.setAttribute('opacity', '0.9')
      path.setAttribute('stroke-linejoin', 'round')
      path.setAttribute('stroke-linecap', 'round')

      const arrowhead = document.createElementNS('http://www.w3.org/2000/svg', 'polygon')
      
      const arrowX1 = lastPoint.x
      const arrowY1 = lastPoint.y
      const arrowX2 = lastPoint.x - arrowheadSize * Math.cos(endAngle - 0.4)
      const arrowY2 = lastPoint.y - arrowheadSize * Math.sin(endAngle - 0.4)
      const arrowX3 = lastPoint.x - arrowheadSize * Math.cos(endAngle + 0.4)
      const arrowY3 = lastPoint.y - arrowheadSize * Math.sin(endAngle + 0.4)
      
      const arrowPoints = [
        `${arrowX1},${arrowY1}`,
        `${arrowX2},${arrowY2}`,
        `${arrowX3},${arrowY3}`
      ].join(' ')
      arrowhead.setAttribute('points', arrowPoints)
      arrowhead.setAttribute('fill', strokeColor)
      arrowhead.setAttribute('stroke', strokeColor)
      arrowhead.setAttribute('stroke-width', (strokeWidth * 0.3).toString())
      arrowhead.setAttribute('stroke-linejoin', 'round')
      arrowhead.setAttribute('stroke-linecap', 'round')
      arrowhead.setAttribute('opacity', '0.9')

      group.appendChild(path)
      group.appendChild(arrowhead)
      group.style.pointerEvents = 'none'

      const svg = containerRef.current?.querySelector('svg')
      if (svg) {
        const viewport = svg.querySelector('g.viewport') || svg.querySelector('g')
        if (viewport) {
          viewport.appendChild(group)
          console.log(`✅ Model connection arrow created: ${from} -> ${to}`)
        }
      }
    } catch (error) {
      console.error('Error creating model connection arrow:', error)
    }
  }

  const updateRenderedModelActivitiesLabels = (
    xmlString: string,
    activityMetrics: PerformanceActivityMetric,
    reflectChanges = false
  ): string => {

    try {
      let modifiedXML = xmlString
      let tasksFound = 0
      let tasksUpdated = 0
      const selectedMetricLabelsByActivity = new Map<string, { baseName: string; labelText: string }>()
      
      const taskRegex = /<bpmn:(task|userTask|serviceTask|manualTask|scriptTask|sendTask|receiveTask|businessRuleTask)([^>]*name=")([^"]+)"([^>]*)/g
      
      modifiedXML = modifiedXML.replace(taskRegex, (match, taskType, beforeName, activityName, afterName) => {
        tasksFound++
        const strippedName = stripFrequencySuffix(activityName)
        const normalizedName = normalizeActivityName(strippedName)
        
        const activityMetric = activityMetrics[normalizedName]
        if (!activityMetric) return match

        const averageTime = performanceMetric === 'median' ?
          activityMetric.median_sojourn
          : activityMetric.avg_sojourn
        
        if (Number.isFinite(averageTime)) {
          const newName = `${strippedName}\n(${!averageTime ? "N/A" : formatSecondsFull(averageTime, false)})`
          selectedMetricLabelsByActivity.set(normalizedName, {
            baseName: strippedName,
            labelText: `(${!averageTime ? 'N/A' : formatSecondsFull(averageTime, false)})`
          })
          tasksUpdated++
          return `<bpmn:${taskType}${beforeName}${newName}"${afterName}`
        }
        return match
      })

      if (reflectChanges) {
        const elementRegistry = viewerRef.current?.get('elementRegistry') as any
        const activityElements = elementRegistry ? getActivityElements() : []

        activityElements.forEach((activity: any) => {
          const currentName = activity.businessObject?.name
          if (!currentName) return

          const baseName = stripFrequencySuffix(currentName)
          const normalizedName = normalizeActivityName(baseName)
          const metricLabel = selectedMetricLabelsByActivity.get(normalizedName)
          if (!metricLabel) return

          activity.businessObject.name = `${metricLabel.baseName}\n${metricLabel.labelText}`

          const gfx = elementRegistry.getGraphics(activity)
          const text = gfx?.querySelector('text') as SVGTextElement | null
          const tspans = text?.querySelectorAll('tspan')

          if (!text || !tspans?.length) return

          const activityShape = (
            gfx.querySelector(`rect${bpmnAugmentationSelector('activity-background')}`) ||
            gfx.querySelector(`rect:not(${bpmnAugmentationSelector('activity-background')})`)
          ) as SVGGraphicsElement | null
          const activityShapeBox = activityShape?.getBBox()
          const centerX = activityShapeBox
            ? String(activityShapeBox.x + activityShapeBox.width / 2)
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
          metricLine.textContent = metricLabel.labelText
        })
      }
      
      console.log(`[ADD FREQUENCIES] Summary: Found ${tasksFound} tasks, updated ${tasksUpdated}`)
      return modifiedXML
    } catch (error) {
      console.error('[ADD FREQUENCIES] Error adding frequencies:', error)
      return xmlString
    }
  }

  const updateRenderedDeviatiedActivitiesMetricLabels = (
    xmlString: string,
    activityMetrics: PerformanceActivityMetric,
    primaryActivities: string[],
    secondaryActivities: string[],
    reflectChanges = false
  ): string => {
    try {
      let modifiedXML = xmlString
      let tasksFound = 0
      let tasksUpdated = 0
      const visibleDeviationActivities = new Map<string, boolean>()
      const selectedMetricLabelsByActivity = new Map<string, { baseName: string; labelText: string; isSecondary: boolean }>()

      primaryActivities.forEach((activityName) => {
        visibleDeviationActivities.set(activityName, false)
      })

      secondaryActivities.forEach((activityName) => {
        visibleDeviationActivities.set(activityName, true)
      })

      visibleDeviationActivities.forEach((isSecondary, activityName) => {
        const activityMetric = activityMetrics[activityName]
        if (!activityMetric) return

        const selectedTime = performanceMetric === 'median' && Number.isFinite(activityMetric.median_sojourn)
          ? activityMetric.median_sojourn
          : activityMetric.avg_sojourn

        if (!Number.isFinite(selectedTime)) return

        selectedMetricLabelsByActivity.set(activityName, {
          baseName: activityMetric.originalActivity === '' ? 'No label' : activityMetric.originalActivity,
          labelText: `(${!selectedTime ? 'N/A' : formatSecondsFull(selectedTime, false)})`,
          isSecondary
        })
      })

      const getMetricLabel = (normalizedName: string) => {
        if (normalizedName === 'no-label' && selectedMetricLabelsByActivity.has('')) {
          return selectedMetricLabelsByActivity.get('')
        }

        return selectedMetricLabelsByActivity.get(normalizedName)
      }

      const taskRegex = /<bpmn:(task|userTask|serviceTask|manualTask|scriptTask|sendTask|receiveTask|businessRuleTask)([^>]*name=")([^"]+)"([^>]*)/g

      modifiedXML = modifiedXML.replace(taskRegex, (match, taskType, beforeName, activityName, afterName) => {
        tasksFound++
        const strippedName = stripFrequencySuffix(activityName)
        const normalizedName = normalizeActivityName(strippedName)
        const metricLabel = getMetricLabel(normalizedName)

        if (!metricLabel) return match

        tasksUpdated++
        return `<bpmn:${taskType}${beforeName}${metricLabel.baseName}\n${metricLabel.labelText}"${afterName}`
      })

      if (reflectChanges) {
        const elementRegistry = viewerRef.current?.get('elementRegistry') as any
        const activityElements = elementRegistry ? getActivityElements() : []

        activityElements.forEach((activity: any) => {
          const currentName = activity.businessObject?.name
          if (!currentName) return

          const baseName = stripFrequencySuffix(currentName)
          const normalizedName = normalizeActivityName(baseName)
          const metricLabel = getMetricLabel(normalizedName)
          if (!metricLabel) return

          activity.businessObject.name = `${metricLabel.baseName}\n${metricLabel.labelText}`

          const gfx = elementRegistry.getGraphics(activity)
          const text = gfx?.querySelector('text') as SVGTextElement | null
          const tspans = text?.querySelectorAll('tspan')

          if (!text || !tspans?.length) return

          const activityShape = (
            gfx.querySelector(`rect${bpmnAugmentationSelector('activity-background')}`) ||
            gfx.querySelector(`rect:not(${bpmnAugmentationSelector('activity-background')})`)
          ) as SVGGraphicsElement | null
          const activityShapeBox = activityShape?.getBBox()
          const centerX = activityShapeBox
            ? String(activityShapeBox.x + activityShapeBox.width / 2)
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
          metricLine.textContent = metricLabel.labelText
        })
      }

      console.log(`[UPDATE DEVIATION LABELS] Summary: Found ${tasksFound} tasks, updated ${tasksUpdated}`)
      return modifiedXML
    } catch (error) {
      console.error('[UPDATE DEVIATION LABELS] Error updating deviation activity labels:', error)
      return xmlString
    }
  }

  const updateRenderedModelFlowMetricLabels = ({
    elementSojourns,
    inlineLabelAverages
  }: ModelPerformanceLabelData) => {
    const svg = containerRef.current?.querySelector('svg')
    if (!svg) return

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

      const inlineValue = inlineLabelAverages[flowId]
      const topPathValue = elementSojourns[flowId]?.paths
        ? Object.values(elementSojourns[flowId].paths)
            .sort((pathA, pathB) => pathB.selected_sojourn - pathA.selected_sojourn)[0]?.selected_sojourn
        : undefined

      updateFlowLabelGroup(group, inlineValue ?? topPathValue)
    })

    svg.querySelectorAll(bpmnAugmentationSelector('flow-label', { labelMode: 'path' })).forEach((group) => {
      const flowId = group.getAttribute(BPMN_AUGMENTATION_ATTRS.elementId)
      const pathKey = group.getAttribute(BPMN_AUGMENTATION_ATTRS.pathKey)
      if (!flowId || !pathKey) return

      const pathValue = elementSojourns[flowId]?.paths[pathKey]?.selected_sojourn
      updateFlowLabelGroup(group, pathValue)
    })
  }

  const updateRenderedDeviationArrowMetricLabels = (
    deviationFlows: Array<PerformanceFlowMetric & { selected_sojourn?: number }>
  ) => {
    const svg = containerRef.current?.querySelector('svg')
    if (!svg) return

    const flowSojournByPair = new Map<string, number>()

    deviationFlows.forEach((flow) => {
      const selectedSojourn = Number.isFinite(flow.selected_sojourn)
        ? flow.selected_sojourn as number
        : performanceMetric === 'median'
          ? flow.median_sojourn
          : flow.avg_sojourn

      flowSojournByPair.set(`${flow.from}::${flow.to}`, selectedSojourn)
    })

    const updateArrowLabelGroup = (group: Element, value: number | undefined) => {
      const text = group.querySelector('text') as SVGTextElement | null
      const rect = group.querySelector('rect') as SVGRectElement | null
      if (!text || !rect) return

      const label = Number.isFinite(value)
        ? formatSecondsFull(value as number, false)
        : 'N/A'

      text.textContent = label

      const textX = Number.parseFloat(text.getAttribute('x') || '0')
      const paddingX = 8
      let bgWidth = label.length * 7

      try {
        bgWidth = text.getBBox().width + paddingX * 2
      } catch {
        bgWidth = label.length * 7
      }

      rect.setAttribute('x', String(textX - bgWidth / 2))
      rect.setAttribute('width', String(bgWidth))
    }

    svg.querySelectorAll(bpmnAugmentationSelector('deviation-arrow')).forEach((group) => {
      const from = group.getAttribute(BPMN_AUGMENTATION_ATTRS.from)
      const rawTo = group.getAttribute(BPMN_AUGMENTATION_ATTRS.to)
      if (!from || !rawTo) return

      const to = rawTo.startsWith('<<end>>:')
        ? '<<end>>'
        : rawTo

      const selectedSojourn = flowSojournByPair.get(`${from}::${to}`)
      updateArrowLabelGroup(group, selectedSojourn)
    })
  }

  const updateClickedElementMetricData = ({
    elementSojourns
  }: ModelPerformanceLabelData) => {
    setClickedElement((previousClickedElement) => {
      if (!previousClickedElement) return previousClickedElement

      const updatedElementData = elementSojourns[previousClickedElement.elementId]
      if (!updatedElementData?.paths) return previousClickedElement

      const sortedPathKeys = Object.entries(updatedElementData.paths)
        .sort(([, pathA], [, pathB]) => pathB.selected_sojourn - pathA.selected_sojourn)
        .map(([pathKey]) => pathKey)
      const previousSelectedPathKey = Object.entries(previousClickedElement.checkedPaths || {})
        .find(([, isChecked]) => isChecked)?.[0]
      const selectedPathKey = previousSelectedPathKey && updatedElementData.paths[previousSelectedPathKey]
        ? previousSelectedPathKey
        : sortedPathKeys[0]

      return {
        ...previousClickedElement,
        selected_sojourn: Object.values(updatedElementData.paths)
          .reduce((sum, pathData) => sum + pathData.selected_sojourn, 0),
        paths: updatedElementData.paths,
        checkedPaths: selectedPathKey
          ? Object.keys(updatedElementData.paths).reduce<Record<string, boolean>>((acc, pathKey) => {
              acc[pathKey] = pathKey === selectedPathKey
              return acc
            }, {})
          : undefined
      }
    })
  }

  const getDeviationFilterContext = () => {
    const filterMin = activeDeviationAvgTimeFilter[0]
    const filterMax = activeDeviationAvgTimeFilter[1]

    // Primary deviations are the activities and flows whose selected duration is inside the active range.
    const filteredStats = filterDeviationsFlowsByConnectionAverageTime(
      filterMin,
      filterMax
    )

    const { activities: deviationActivitiesAvgTime, flows: deviationFlows } = filteredStats
    const deviationActivitiesNames = new Set(Object.keys(selectedPerformanceMetrics.activities.deviations))
    const primaryDeviationActivities = new Set(Object.keys(deviationActivitiesAvgTime))

    // The full range means "show all"; narrower ranges need secondary context nodes.
    const isDeviationFilterActive =
      filterMin !== limitsSelectedSojournTime.min || filterMax !== limitsSelectedSojournTime.max

    return {
      filterMin,
      filterMax,
      deviationFlows,
      deviationActivitiesAvgTime,
      deviationActivitiesNames,
      primaryDeviationActivities,
      isDeviationFilterActive
    }
  }
  
  const buildModelActivityPaths = (xmlString: string): Record<string, Record<string, string[]>> => {
    try {
      const parser = new DOMParser()
      const xmlDoc = parser.parseFromString(xmlString, 'text/xml')

      console.log('[BUILD MODEL PATHS] Parsing XML directly')

      const elementById: Record<string, Element> = {}
      const activityByName: Record<string, Element> = {}
      const sequenceFlowById: Record<string, { sourceRef: string; targetRef: string }> = {}
      
      const allElements = xmlDoc.querySelectorAll('[id]')
      allElements.forEach((el) => {
        const id = el.getAttribute('id')
        if (id) {
          elementById[id] = el
          
          const tagName = el.tagName
          if (tagName.includes('task') || tagName.includes('Task')) {
            const name = el.getAttribute('name')
            if (name) {
              const normalizedName = normalizeActivityName(stripFrequencySuffix(name))
              activityByName[normalizedName] = el
              console.log('[BUILD MODEL PATHS] Mapped activity:', normalizedName)
            }
          }
          
          if (tagName.includes('startEvent') || tagName.includes('StartEvent')) {
            activityByName["<<start>>"] = el
            console.log('[BUILD MODEL PATHS] Mapped start event')
          }
        }
      })

      const sequenceFlows = xmlDoc.querySelectorAll('[sourceRef][targetRef]')
      sequenceFlows.forEach((flow) => {
        const id = flow.getAttribute('id')
        const sourceRef = flow.getAttribute('sourceRef')
        const targetRef = flow.getAttribute('targetRef')
        if (id && sourceRef && targetRef) {
          sequenceFlowById[id] = { sourceRef, targetRef }
        }
      })

      console.log('[BUILD MODEL PATHS] Found activities:', Object.keys(activityByName))
      console.log('[BUILD MODEL PATHS] Found sequence flows:', Object.keys(sequenceFlowById).length)

      const activityPaths: Record<string, Record<string, string[]>> = {}

      const getOutgoingFlows = (elementId: string): Array<{ flowId: string; targetId: string }> => {
        const outgoing: Array<{ flowId: string; targetId: string }> = []
        
        Object.entries(sequenceFlowById).forEach(([flowId, { sourceRef, targetRef }]) => {
          if (sourceRef === elementId) {
            outgoing.push({ flowId, targetId: targetRef })
          }
        })
        
        return outgoing
      }

      const findPath = (sourceId: string, targetId: string): string[] => {
        const queue: Array<{ elementId: string; path: string[] }> = [{ elementId: sourceId, path: [] }]
        const visited = new Set<string>([sourceId])

        while (queue.length > 0) {
          const { elementId, path } = queue.shift()!

          if (elementId === targetId) {
            return path
          }

          const outgoing = getOutgoingFlows(elementId)

          for (const { flowId, targetId: nextTargetId } of outgoing) {
            if (visited.has(flowId)) continue

            visited.add(flowId)
            const newPath = [...path, flowId]

            if (visited.has(nextTargetId)) continue
            visited.add(nextTargetId)

            const targetElement = elementById[nextTargetId]
            if (!targetElement) continue

            if (nextTargetId === targetId) {
              queue.push({ elementId: nextTargetId, path: newPath })
              continue
            }

            // If target is a gateway, add it to path and continue searching
            const targetTagName = targetElement.tagName
            if (targetTagName.includes('Gateway') || targetTagName.includes('gateway')) {
              const pathWithGateway = [...newPath, nextTargetId]
              queue.push({ elementId: nextTargetId, path: pathWithGateway })
            } else {
              queue.push({ elementId: nextTargetId, path: newPath })
            }
          }
        }

        return []
      }

      const findEndEventPath = (sourceId: string): string[] | null => {
        const queue: Array<{ elementId: string; path: string[] }> = [{ elementId: sourceId, path: [] }]
        const visited = new Set<string>([sourceId])

        while (queue.length > 0) {
          const { elementId, path } = queue.shift()!

          const outgoing = getOutgoingFlows(elementId)

          for (const { flowId, targetId } of outgoing) {
            if (visited.has(flowId)) continue

            visited.add(flowId)
            const newPath = [...path, flowId]

            if (visited.has(targetId)) continue
            visited.add(targetId)

            const targetElement = elementById[targetId]
            if (!targetElement) continue

            const targetTagName = targetElement.tagName
            if (targetTagName.includes('endEvent') || targetTagName.includes('EndEvent')) {
              return newPath
            }

            // If target is a gateway, add it to path and continue
            if (targetTagName.includes('Gateway') || targetTagName.includes('gateway')) {
              const pathWithGateway = [...newPath, targetId]
              queue.push({ elementId: targetId, path: pathWithGateway })
            } else {
              queue.push({ elementId: targetId, path: newPath })
            }
          }
        }

        return null
      }

      Object.keys(model_next_activities).forEach(sourceActivityName => {
        const targetActivities = model_next_activities[sourceActivityName] || []
        
        if (targetActivities.length === 0) return

        const sourceElement = activityByName[sourceActivityName]
        if (!sourceElement) {
          console.warn(`[BUILD MODEL PATHS] Source activity not found: ${sourceActivityName}`)
          return
        }

        const sourceId = sourceElement.getAttribute('id')
        if (!sourceId) return

        activityPaths[sourceActivityName] = {}

        targetActivities.forEach(targetActivityName => {
          if (targetActivityName === "<<end>>") {
            const endPath = findEndEventPath(sourceId)
            if (endPath) {
              activityPaths[sourceActivityName]["<<end>>"] = endPath
              console.log(`[BUILD MODEL PATHS] Path from "${sourceActivityName}" to end event:`, endPath)
            } else {
              console.warn(`[BUILD MODEL PATHS] No path to end event from "${sourceActivityName}"`)
            }
            return
          }

          const targetElement = activityByName[targetActivityName]
          if (!targetElement) {
            console.warn(`[BUILD MODEL PATHS] Target activity not found: ${targetActivityName}`)
            return
          }

          const targetId = targetElement.getAttribute('id')
          if (!targetId) return

          const path = findPath(sourceId, targetId)
          
          if (path && path.length > 0) {
            activityPaths[sourceActivityName][targetActivityName] = path
            console.log(`[BUILD MODEL PATHS] Path from "${sourceActivityName}" to "${targetActivityName}":`, path)
          } else {
            console.warn(`[BUILD MODEL PATHS] No path found from "${sourceActivityName}" to "${targetActivityName}"`)
          }
        })
      })

      console.log('[BUILD MODEL PATHS] Complete activity paths:', activityPaths)
      return activityPaths

    } catch (error) {
      console.error('[BUILD MODEL PATHS] Error building activity paths:', error)
      return {}
    }
  }

  const clearActivityTooltipHideTimeout = () => {
    if (activityTooltipHideTimeoutRef.current === null) return

    window.clearTimeout(activityTooltipHideTimeoutRef.current)
    activityTooltipHideTimeoutRef.current = null
  }

  const scheduleActivityTooltipHide = () => {
    clearActivityTooltipHideTimeout()
    activityTooltipHideTimeoutRef.current = window.setTimeout(() => {
      setHoveredActivity(null)
      activityTooltipHideTimeoutRef.current = null
    }, 180)
  }

  const installPerformanceActivityInteractions = (
    xmlString: string,
    metrics: typeof selectedPerformanceMetrics = selectedPerformanceMetrics
  ): ModelPerformanceLabelData | undefined => {
    if (!viewerRef.current) return undefined

    const activityPaths = viewMode === 'deviations'
      ? buildWithDeviationsActivityPathsFromFlows({
        xmlString,
        modelFlows: metrics.flows.model,
        allFlows: metrics.flows.all,
        deviationActivities: metrics.activities.deviations,
        container: containerRef.current
      })
      : buildModelActivityPaths(xmlString)

    const flows = viewMode === 'deviations'
      ? metrics.flows.all
      : metrics.flows.model
    const activities = viewMode === 'deviations'
      ? metrics.activities.all
      : metrics.activities.model

    return installActivityPerformanceInteractions({
      viewer: viewerRef.current,
      container: containerRef.current,
      activityPaths,
      flows,
      activities,
      timeConformance: [],
      isDragging: () => isDraggingRef.current,
      onClickedElement: (element) => {
        if (!element) {
          setClickedElement(null)
          return
        }

        setClickedElement({
          elementId: element.elementId,
          selected_sojourn: element.avg_sojourn ?? Number.NaN,
          paths: element.paths
            ? Object.fromEntries(
              Object.entries(element.paths).map(([pathKey, pathData]) => [
                pathKey,
                {
                  ...pathData,
                  selected_sojourn: pathData.selected_sojourn
                }
              ])
            )
            : undefined,
          checkedPaths: element.checkedPaths
        })
      }
    })
  }

  useEffect(() => {
    const sharedClickedElement = normalizeClickedElementForSharedFocus(clickedElement)
    const svg = containerRef.current?.querySelector('svg')

    svg?.querySelectorAll(bpmnAugmentationSelector('flow-label', { labelMode: 'path' })).forEach((node) => node.remove())

    if (!viewerRef.current || !isLoaded || !sharedClickedElement?.paths) {
      return
    }

    drawSelectedModelPerformancePathLabel({
      viewer: viewerRef.current,
      container: containerRef.current,
      clickedElement: sharedClickedElement,
      selectedActivityMode: 'raise-existing'
    })

    return () => {
      svg?.querySelectorAll(bpmnAugmentationSelector('flow-label', { labelMode: 'path' })).forEach((node) => node.remove())
    }
  }, [clickedElement, isLoaded])

  const styleModelActivities = (
    activities: { normalizedName: string; originalName: string }[]
  ) => {
    if (activities.length === 0) return

    activities.forEach(activity => {
      styleModelActivity(activity.normalizedName)
    })

    setupActivityHoverListeners()
  }

  const resetPerformanceViewRenderState = () => {
    setIsLoaded(false)
    setShowViewer(false)

    const existingDeviationArrows = containerRef.current?.querySelectorAll(bpmnAugmentationSelector('deviation-arrow'))
    existingDeviationArrows?.forEach(arrow => arrow.remove())
    const existingModelArrows = containerRef.current?.querySelectorAll(bpmnAugmentationSelector('model-arrow'))
    existingModelArrows?.forEach(arrow => arrow.remove())

    setConnectionPointsUsage(new Map())
    setActivitiesToStyle([])
    setSecondaryActivitiesToStyle([])
    setArrowsToCreate([])
    setModelFlowPaths([])
    setDeviationLanes(new Set())
    setEndEventIds(new Map())
    setClickedElement(null)
  }

  useEffect(() => {
    if (!viewerRef.current || !xml) return

    const isMetricChange = previousMetricRef.current !== performanceMetric
    const stayedInSameView = previousViewModeRef.current === viewMode
    const shouldRebuildAfterDeviationFilterReset =
      viewMode === 'deviations' &&
      isMetricChange &&
      shouldRebuildAfterDeviationFilterResetRef.current

    const shouldOnlyRefreshMetric =
      stayedInSameView &&
      isMetricChange &&
      !shouldRebuildAfterDeviationFilterReset

    const xmlWithAvgTimes = updateRenderedModelActivitiesLabels(
      xml,
      performanceActivities,
      shouldOnlyRefreshMetric && isLoaded
    )

    if (shouldOnlyRefreshMetric && isLoaded) {

      let updatedXml = xmlWithAvgTimes

      if (viewMode === 'deviations') {
        
        updatedXml = updateRenderedDeviatiedActivitiesMetricLabels(
          xmlWithAvgTimes,
          selectedPerformanceMetrics.activities.deviations,
          activitiesToStyle,
          secondaryActivitiesToStyle,
          true
        )

        updateRenderedDeviationArrowMetricLabels(selectedPerformanceMetrics.flows.deviations)
      }

      const activityInteractionData = installPerformanceActivityInteractions(updatedXml)

      if (activityInteractionData) {
        updateRenderedModelFlowMetricLabels(activityInteractionData)
        updateClickedElementMetricData(activityInteractionData)
      }
      
      styleModelActivities(model_activities)
      previousMetricRef.current = performanceMetric
      previousViewModeRef.current = viewMode
      return;
    }

    previousMetricRef.current = performanceMetric
    previousViewModeRef.current = viewMode
    shouldRebuildAfterDeviationFilterResetRef.current = false

    const buildPerformanceViewStructure = async () => {

      resetPerformanceViewRenderState()
      
      try {
        
        await importAndSetupXML(xmlWithAvgTimes)

        setTimeout(() => {
          styleModelActivities(model_activities)
        }, 200)

        const coordResult = await getCoordinates({ viewer: viewerRef.current })
        
        if (!coordResult) {
          console.warn('Failed to get activity coordinates')
          return
        }

        let { coordinates, allElements, lanes, activitiesLanes } = coordResult
        setActivitiesCoordinates(coordinates)
        setLanes(lanes)

        if (viewMode === 'model') {
          setIsLoaded(true)
          setShowViewer(true)
        }else{
          console.log('=== VIEW MODE DEVIATIONS ===')

          console.log('[DEBUG ROLES LANES] Roles lanes mapping: ', roles_lanes)

          const {
            filterMin,
            filterMax,
            deviationFlows,
            deviationActivitiesAvgTime,
            deviationActivitiesNames,
            primaryDeviationActivities,
            isDeviationFilterActive
          } = getDeviationFilterContext()

          console.log('[DEVIATIONS] Using selected sojourn filter values:', filterMin, '-', filterMax)
          console.log("[FILTERING] Flows that passed the filter:", { activities: deviationActivitiesAvgTime, flows: deviationFlows })

          const secondaryDeviationActivities = getSecondaryDeviationActivities({
            isDeviationFilterActive,
            primaryDeviationActivities,
            deviationActivitiesNames,
            deviationFlows: selectedPerformanceMetrics.flows.deviations as Array<PerformanceFlowMetric & { selected_sojourn: number }>
          })

          let modifiedXML = xmlWithAvgTimes
          const genericDeviationActivities = Object.fromEntries(
            Object.entries(selectedPerformanceMetrics.activities.deviations).map(([activityName, activity]) => {
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
          const orderedDeviationActivities = orderSharedDeviationActivitiesByModelPredecessors({
            deviationActivities: selectedPerformanceMetrics.activities.deviations,
            deviationPredecessors: deviation_predecessors,
            modelActivities: selectedPerformanceMetrics.activities.model
          })

          // Delegate lane selection, collision checks and XML insertion to the shared deviation builder.
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
            findPredecessorCoordinates: (activityName, currentCoordinates) => findSharedPredecessorCoordinates(
              activityName,
              currentCoordinates,
              deviation_predecessors
            ),
            findLaneForActivity: (activityName, predecessorActivity, currentActivitiesLanes, currentLanes) => findSharedLaneForActivity({
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
            createDeviationLane: createSharedDeviationLane,
            findSafePosition: findSharedSafePosition,
            createActivityXML: createSharedActivityXML,
            deviationSizeProfile,
            onCoordinatesChange: setActivitiesCoordinates,
            onLanesChange: setLanes
          })

          modifiedXML = deviationActivityBuildResult.modifiedXML
          coordinates = deviationActivityBuildResult.coordinates
          allElements = deviationActivityBuildResult.allElements
          lanes = deviationActivityBuildResult.lanes
          activitiesLanes = deviationActivityBuildResult.activitiesLanes

          const {
            newActivitiesToStyleSet,
            newDeviationLanesSet,
            deviatedLanesNames,
            newSecondaryActivitiesSet
          } = deviationActivityBuildResult

          const toGenericDeviationFlow = (
            flow: PerformanceFlowMetric & { selected_sojourn: number }
          ): GenericDeviationFlowMetric => ({
            from: flow.from,
            to: flow.to,
            value: flow.selected_sojourn,
            label: formatSecondsFull(flow.selected_sojourn, false)
          })
          const genericDeviationFlows = deviationFlows.map(toGenericDeviationFlow)
          const allGenericDeviationFlows = (selectedPerformanceMetrics.flows.deviations as Array<PerformanceFlowMetric & { selected_sojourn: number }>)
            .map(toGenericDeviationFlow)

          // Use the same synthetic end-event and deviation-arrow builder as the other views.
          const deviationArrowBuildResult = buildGenericDeviationArrows({
            xmlString: modifiedXML,
            coordinates,
            allElements,
            lanes,
            activitiesLanes,
            deviationFlows: genericDeviationFlows,
            allDeviationFlows: allGenericDeviationFlows,
            primaryDeviationActivities,
            isDeviationFilterActive,
            filterMin,
            filterMax,
            findSafePosition: findSharedSafePosition,
            createEndEventXML: createSharedEndEventXML,
            deviationSizeProfile
          })

          modifiedXML = deviationArrowBuildResult.modifiedXML
          coordinates = deviationArrowBuildResult.coordinates
          allElements = deviationArrowBuildResult.allElements

          const {
            arrowsToCreate,
            endEventIdsToStyle
          } = deviationArrowBuildResult

          setActivitiesToStyle(Array.from(newActivitiesToStyleSet))
          setSecondaryActivitiesToStyle(Array.from(newSecondaryActivitiesSet))
          setArrowsToCreate(arrowsToCreate.map((arrow) => ({
            ...arrow,
            selected_sojourn: arrow.value
          })))
          setDeviationLanes(newDeviationLanesSet)
          setEndEventIds(endEventIdsToStyle)

          if (deviatedLanes.length === 0 && deviatedLanesNames.length > 0) {
            setDeviatedLanes(deviatedLanesNames)
          }

          await importAndSetupXML(modifiedXML)

          setIsLoaded(true)
          setModelFlowPaths([])
        }

        if (viewMode === 'model') {
          installPerformanceActivityInteractions(xmlWithAvgTimes)
        }

      } catch (error) {
        console.error('Error processing deviations:', error)
      }
    }

    buildPerformanceViewStructure()
    
  }, [xml, selectedPerformanceMetrics.flows, selectedPerformanceMetrics.activities, activeDeviationAvgTimeFilter, viewMode, deviationSizeProfile, deviation_predecessors])

  useEffect(() => {
    if (isLoaded && (activitiesToStyle.length > 0 || arrowsToCreate.length > 0 || deviationLanes.size > 0)) {
      const timeoutId = setTimeout(() => {
        
        console.log("Activities To Style:", activitiesToStyle);
        console.log("Arrows To Create:", arrowsToCreate);
        console.log("Deviation Lanes To Style:", Array.from(deviationLanes));

        const existingArrows = containerRef.current?.querySelectorAll(bpmnAugmentationSelector('deviation-arrow'))
        existingArrows?.forEach(arrow => arrow.remove())
        
        if (modelFlowPaths.length > 0) {
          console.log(`[${viewMode.toUpperCase()} VIEW] Creating custom arrows for`, modelFlowPaths.length, 'model connections')
          
          const avgSojournValues = modelFlowPaths.map(fp => fp.avg_sojourn)
          const minAvgSojourn = Math.min(...avgSojournValues)
          const maxAvgSojourn = Math.max(...avgSojournValues)
          
          console.log(`[${viewMode.toUpperCase()} VIEW] Avg sojourn range: ${minAvgSojourn} - ${maxAvgSojourn}`)
          
          modelFlowPaths.forEach(flowPath => {
            createModelConnectionArrow(flowPath, minAvgSojourn, maxAvgSojourn)
          })
        }

        activitiesToStyle.forEach(activity => {
          styleDeviationActivity({
            viewer: viewerRef.current,
            activityName: activity,
            isSecondary: false,
            getActivityColor
          })
        })
        secondaryActivitiesToStyle.forEach(activity => {
          styleDeviationActivity({
            viewer: viewerRef.current,
            activityName: activity,
            isSecondary: true,
            getActivityColor
          })
        })
        let nextConnectionPointsUsage = new Map(connectionPointsUsage)
        arrowsToCreate.forEach(arrow => {
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
            isSecondary: !!arrow.isSecondary,
            primaryStroke: '#111827',
            secondaryStroke: '#9CA3AF'
          })
        });
        setConnectionPointsUsage(nextConnectionPointsUsage)
        styleDeviationLanes({
          viewer: viewerRef.current,
          deviationLanes
        });
        styleEndEvents({
          viewer: viewerRef.current,
          endEventIds
        });
        installPerformanceActivityInteractions(xml)
        setupActivityHoverListeners();
        setShowViewer(true)
      }, 200)
      
      return () => clearTimeout(timeoutId)
    }
    
  }, [isLoaded, activitiesToStyle, secondaryActivitiesToStyle, arrowsToCreate, deviationLanes, endEventIds, modelFlowPaths, viewMode])

  const clickedElementDisplayName = useMemo(() => {
    if (!clickedElement || !viewerRef.current) return clickedElement?.elementId || ''

    const elementRegistry = viewerRef.current.get('elementRegistry') as any
    const element = elementRegistry?.get(clickedElement.elementId)
    const rawName = element?.businessObject?.name
    if (!rawName) return clickedElement.elementId

    return utilsStripFrequencySuffix(rawName).replace(/\s*\n\s*/g, ' ').trim() || clickedElement.elementId
  }, [clickedElement])

  return (
    <div className="w-full h-full relative">
      {!clickedElement && (
        <div ref={legendContainerRef} className="absolute top-0 left-0 z-30 h-full">
          <BpmnPerformanceLegend 
            activitiesWithAvgTime={
              viewMode === 'model' ? 
                selectedPerformanceMetrics.activities.model : 
                selectedPerformanceMetrics.activities.deviations
            }
            deviatedLanes={deviatedLanes}    
            frequencyFilter={activeDeviationAvgTimeFilter}
            onFrequencyFilterChange={setWithDeviationAvgTimeFilter}
            viewMode={viewMode}
            onViewModeChange={handlePerformanceViewModeChange}
            limitsAvgTimeFlows={limitsSelectedSojournTime}
            metric={performanceMetric}
            onMetricChange={handlePerformanceMetricChange}
            hasDeviationData={hasPerformanceDeviationData}
          />
        </div>
      )}

      <div className="absolute top-0 right-0 z-30 h-full">
        <BpmnPerformanceHeatmap 
          limitsSelectedSojournTimeActivities={limitsSelectedSojournTimeActivities}
          activeMetric={performanceMetric}
        />
      </div>

      {!showViewer && (
        <div className="absolute inset-0 flex items-center justify-center bg-white z-20">
          <div 
            className="w-12 h-12 border-4 border-[#e0e0e0] border-t-[#808080] rounded-full animate-spin"
            style={{ borderTopColor: '#808080' }}
          />
        </div>
      )}
      
      {containerRef != null && (
        <BpmnZoomControls
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onFitViewport={handleFitViewport}
          onReset={handleReset}
          isLoaded={isLoaded}
          topPosition='top-32'
          onImageDown={async () => {
            await ToastPromise(
              handleSvgDownload('performance', viewMode, containerRef),
              t('imageDownload.exporting'),
              t('imageDownload.success'),
              t('imageDownload.failure')
            )
          }}
        />
      )}

      {hoveredActivity && (() => {

        if (!performanceActivities[hoveredActivity.name]) {
          return null
        }
        const hoveredActivityMetrics = performanceActivities[hoveredActivity.name]
        console.log("[HOVER] Hovered activity:", hoveredActivity.name, "Metrics:", hoveredActivityMetrics)
        const flagRoles = !!activitiesRoles[hoveredActivity.name]
        const orderedRoles = flagRoles ? 
          activitiesRoles[hoveredActivity.name].sort((a, b) => b.frequency - a.frequency) : []
        
        return (
          <BpmnPerformanceTooltip
            activityName={hoveredActivity.originalName}
            x={hoveredActivity.x}
            y={hoveredActivity.y}
            average_time={hoveredActivityMetrics.avg_sojourn}
            median_time={hoveredActivityMetrics.median_sojourn}
            min_time={hoveredActivityMetrics.min_sojourn || 0}
            max_time={hoveredActivityMetrics.max_sojourn || 0}
            event_count={hoveredActivityMetrics.event_count || 0}
            {...(flagRoles ? { roles: orderedRoles } : {})}
            onMouseEnter={clearActivityTooltipHideTimeout}
            onMouseLeave={scheduleActivityTooltipHide}
            {...(orderedRoles.length > 3 ? {
              onClickDetails: () => {
                clearActivityTooltipHideTimeout()
                setHoveredActivity(null)
                setClickedActivity({
                  name: hoveredActivity.name,
                  originalName: hoveredActivity.originalName,
                  roles: orderedRoles,
                  average_time: hoveredActivityMetrics.avg_sojourn,
                  median_time: hoveredActivityMetrics.median_sojourn,
                  min_time: hoveredActivityMetrics.min_sojourn || 0,
                  max_time: hoveredActivityMetrics.max_sojourn || 0
                })
              }
            } : {})}
          />
        )
      })()}

      {clickedElement && (
        <BpmnPerformancePathTooltip
          elementId={clickedElementDisplayName}
          x='left-4'
          y='top-39.5'
          selected_sojourn={clickedElement.selected_sojourn}
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

      {clickedActivity && (
        <BpmnPerformanceActivityRoles
          activityName={stripFrequencySuffix(clickedActivity.originalName)}
          roles={clickedActivity.roles}
          average_time={clickedActivity.average_time}
          median_time={clickedActivity.median_time}
          min_time={clickedActivity.min_time}
          max_time={clickedActivity.max_time}
          onClose={() => setClickedActivity(null)}
        />
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
    </div>
  )
}
