import { useEffect, useMemo, useRef, useState } from 'react'
import type { ActivityCoordinatesCollection, DeviationActivitySizeProfile, ElementCoordinates, LaneElements } from '@/types/analysis-frontend'
import type { FrequencyMetrics, HelperVariables, FrequencyFlowMetric } from '@/types/analysis-backend'
import { normalizeActivityName } from '../utils/functions'
import {
  bpmnAugmentationSelector,
  setBpmnAugmentationAttributes,
  stripFrequencySuffix as utilsStripFrequencySuffix
} from '../utils/bpmn-utils'
import { BpmnFrequencyLegend } from './bpmn-frequency-legend'
import { BpmnFrequencyFlowTooltip } from './bpmn-frequency-flow-tooltip'
import { BpmnFrequencyActivityRoles } from './bpmn-frequency-activity-roles'
import { BpmnFrequencyHeatmap } from './bpmn-frequency-heatmap'
import { BpmnZoomControls } from './ui/bpmn-zoom-controls'
import { useBpmnViewer, useBpmnViewMode, useBpmnZoom, useBpmnDrag, useBpmnImport } from '@/hooks'
import { ToastPromise } from './ui/toast-promise'
import { BpmnFrequencyActivityTooltip } from './bpmn-frequency-activity-tooltip'
import { useTranslation } from 'react-i18next'
import { buildModelFrequencyLabelData } from '@/utils/bpmn-viewer-frequency'
import {
  buildGenericDeviationActivitiesAndLanes,
  buildGenericDeviationArrows,
  createActivityXML as createActivityXML,
  createDeviationLane as createDeviationLane,
  createEndEventXML as createEndEventXML,
  type GenericDeviationArrow,
  type GenericDeviationFlowMetric,
  createSmartDeviationArrowElement as createDeviationArrow,
  findLaneForActivity as findLaneForActivity,
  findPredecessorCoordinates as findPredecessorCoordinates,
  findSafePosition as findSafePosition,
  getBpmnCoordinates as getCoordinates,
  orderDeviationActivitiesByModelPredecessors as orderDeviationActivitiesByModelPredecessors,
  styleDeviationActivityElement as styleDeviationActivity,
  styleDeviationEndEventElements as styleEndEvents,
  styleDeviationLaneElements as styleDeviationLanes
} from '@/utils/bpmn-viewer-deviations'

const stripFrequencySuffix = (name?: string) => {
  if (!name) return ''
  return utilsStripFrequencySuffix(name).trim()
}

interface BpmnFrequencyViewerProps {
  xml: string
  frequency_metrics: FrequencyMetrics
  helper_variables: HelperVariables
  deviationSizeProfile?: DeviationActivitySizeProfile
}

export function BpmnFrequencyViewer({ xml, frequency_metrics, helper_variables, deviationSizeProfile }: BpmnFrequencyViewerProps) {

  const { t } = useTranslation();

  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useBpmnViewer(containerRef)
  const deviationsViewBuilt = useRef(false)
  const [isLoaded, setIsLoaded] = useState(false)
  const [showViewer, setShowViewer] = useState(false)
  const { viewMode, setViewMode, viewModeRef } = useBpmnViewMode('model')
  const { handleZoomIn, handleZoomOut, handleFitViewport, handleReset, handleSvgDownload } = useBpmnZoom(viewerRef)
  const { isDragging, handleMouseDown, handleMouseUp, handleMouseLeave } = useBpmnDrag()
  const { importAndSetupXML } = useBpmnImport(viewerRef)

  const { model_next_activities, roles_lanes, activities_roles, deviation_predecessors } = helper_variables
  
  const [arrowsToCreate, setArrowsToCreate] = useState<Array<GenericDeviationArrow & { frequency: number }>>([])
  const [activitiesToStyle, setActivitiesToStyle] = useState<string[]>([])
  const [secondaryActivitiesToStyle, setSecondaryActivitiesToStyle] = useState<string[]>([])
  const [activitiesCoordinates, setActivitiesCoordinates] = useState<ActivityCoordinatesCollection>({})
  const [, setLanes] = useState<LaneElements>({})
  const [deviationLanes, setDeviationLanes] = useState<Set<string>>(new Set())
  const [endEventIds, setEndEventIds] = useState<Map<string, boolean>>(new Map())
  const [connectionPointsUsage, setConnectionPointsUsage] = useState<Map<string, {origins: number, destinations: number}>>(new Map())
  const [hoveredActivity, setHoveredActivity] = useState<{name: string, originalName: string, x: number, y: number} | null>(null)
  const activityTooltipHideTimeoutRef = useRef<number | null>(null)
  const [hoveredFlow, setHoveredFlow] = useState<{elementId: string, x: number, y: number, frequency?: number, paths?: Record<string, number>} | null>(null)
  const [clickedActivity, setClickedActivity] = useState<{name: string, originalName: string, roles: {role: string, frequency: number}[], frequency?: number} | null>(null)
  const [deviatedLanes, setDeviatedLanes] = useState<string[]>([])

  const frequencyActivities = useMemo(() => {
    return viewMode === 'model' ? 
    frequency_metrics.activities.model : 
    frequency_metrics.activities.all
  }, [viewMode, frequency_metrics.activities]);

  const activitiesRoles = useMemo(() => {
    return viewMode === 'model' ? 
    activities_roles.model : 
    activities_roles.all
  }, [viewMode, activities_roles]);

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

  const limitsFrequencyActivities = useMemo(() => {
    let activities = viewMode === 'model' ? 
      Object.values(frequency_metrics.activities.model) :
      Object.values(frequency_metrics.activities.all);

    const values = activities.map(m => m.frequency);
    if (values.length === 0) return { min: 0, max: 0 };
    return {
      min: Math.min(...values),
      max: Math.max(...values),
    };

  }, [frequency_metrics.activities, viewMode]);

  const getFrequencyFlowLimits = (flows: FrequencyFlowMetric[]) => {
    const values = flows.map(m => m.frequency);
    if (values.length === 0) return { min: 0, max: 0 };
    return {
      min: Math.min(...values),
      max: Math.max(...values),
    };
  }

  const limitsDeviationFrequencyFlows = useMemo(() => {
    return getFrequencyFlowLimits(frequency_metrics.flows.deviations)
  }, [frequency_metrics.flows.deviations])

  const hasFrequencyDeviationData = useMemo(() => {
    return Object.keys(frequency_metrics.activities.deviations).length > 0 ||
      frequency_metrics.flows.deviations.length > 0
  }, [frequency_metrics.activities.deviations, frequency_metrics.flows.deviations])

  const limitsFrequencyFlows = useMemo(() => {
    const flows = viewMode === 'model' ?
      frequency_metrics.flows.model :
      frequency_metrics.flows.deviations

    return getFrequencyFlowLimits(flows)
  }, [frequency_metrics.flows, viewMode])

  const model_activities = useMemo(() => {
    return Object.entries(frequency_metrics.activities.model).filter(([_, data]) => data.inModel === true).map(([name, _]) => name)
  }, [frequency_metrics.activities])

  const [withDeviationFrequencyFilter, setWithDeviationFrequencyFilter] = useState<[number, number]>(() => 
    [limitsFrequencyFlows.min, limitsFrequencyFlows.max]
  )

  const handleFrequencyViewModeChange = (mode: 'model' | 'deviations') => {
    if (mode === 'deviations' && !hasFrequencyDeviationData) return

    setViewMode(mode)

    if (mode === 'deviations') {
      setWithDeviationFrequencyFilter([
        limitsDeviationFrequencyFlows.min,
        limitsDeviationFrequencyFlows.max
      ])
    }
  }

  viewModeRef.current = viewMode

  const getActivityColor = (activityNormalizedName: string): string => {
    activityNormalizedName = activityNormalizedName == 'no-label' ? "" : activityNormalizedName
    const activityData = frequencyActivities[activityNormalizedName]

    if (!activityData || activityData.frequency === 0) {
      return 'rgba(255, 255, 255, 1)' // Default to minimum color if activity not found
    }

    const frequency = activityData.frequency
    const { min, max } = limitsFrequencyActivities

    if (min === max) {
      return 'rgba(4,90,141,0.6)'
    }

    const normalizedValue = (frequency - min) / (max - min)

    const minOpacity = 0.2
    const maxOpacity = 0.8
    const opacity = minOpacity + normalizedValue * (maxOpacity - minOpacity)

    const color = `rgba(4,90,141,${opacity.toFixed(2)})`
    console.log('[GET ACTIVITY COLOR] Calculated color:', color, 'normalizedValue:', normalizedValue, 'opacity:', opacity)

    return color
  }

  const filterDeviationsByConnectionFrequency = (
    minFrequency: number,
    maxFrequency: number
  ): { activities: Record<string, number>; flows: FrequencyFlowMetric[] } => {
    const filteredFlows = frequency_metrics.flows.deviations.filter(
      flow => flow.frequency >= minFrequency && flow.frequency <= maxFrequency
    )

    const activeActivities = new Set<string>()
    filteredFlows.forEach(flow => {
      activeActivities.add(flow.from)
      // If the flow leads to an end event, save it with the source activity name
      if (flow.to === '<<end>>') {
        activeActivities.add(`<<end>>:${flow.from}`)
      } else {
        activeActivities.add(flow.to)
      }
    })

    const filteredActivities: Record<string, number> = {}
    activeActivities.forEach((activity) => {
      filteredActivities[activity] = frequency_metrics.activities.deviations[activity]?.frequency ?? 
                                    frequency_metrics.activities.all[activity]?.frequency ?? 0
    })

    return {
      activities: filteredActivities,
      flows: filteredFlows
    }
  }

  const getActivityElements = () => {
    if (!viewerRef.current || !isLoaded) return []

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
    setBpmnAugmentationAttributes(backgroundRect, 'activity-background', { view: 'frequency' })
    backgroundRect.style.pointerEvents = 'none'
    
    // Remove any existing background rectangles first
    const existingBg = gfx.querySelector(`rect${bpmnAugmentationSelector('activity-background')}`)
    if (existingBg) {
      existingBg.remove()
    }
    
    // Insert as first child so it renders behind everything
    if (gfx.firstChild) {
      gfx.insertBefore(backgroundRect, gfx.firstChild)
    } else {
      gfx.appendChild(backgroundRect)
    }

    // Style the original activity shapes to be transparent with colored border
    const shapes = gfx.querySelectorAll(`rect:not(${bpmnAugmentationSelector('activity-background')}), path, circle, ellipse, polygon`)
    shapes.forEach((shape: any) => {
      shape.style.fill = 'rgba(0, 0, 0, 0)' // Transparent
      shape.setAttribute('fill', 'rgba(0, 0, 0, 0)')

      if (strokeColor) {
        shape.style.stroke = strokeColor
        shape.style.strokeWidth = '2px'
        shape.setAttribute('stroke', strokeColor)
        shape.setAttribute('stroke-width', '2')
        shape.style.setProperty('stroke', strokeColor, 'important')
        shape.style.setProperty('stroke-width', '2px', 'important')
      }

      if (shape.tagName === 'rect') {
        shape.setAttribute('rx', '10')
        shape.setAttribute('ry', '10')
      }
      
      shape.style.setProperty('fill', 'rgba(0, 0, 0, 0)', 'important')
    })

    const textElements = gfx.querySelectorAll('text')
    textElements.forEach((text: any) => {
      text.style.fill = labelColor
      text.style.fontWeight = '500'
      text.style.fontSize = '12px'
      text.style.fontFamily = 'Arial, sans-serif'
      text.setAttribute('fill', labelColor)
      text.style.pointerEvents = 'none'

      // If the label is split into lines (name + frequency), emphasize the frequency line.
      const tspans = text.querySelectorAll('tspan')
      if (tspans.length > 1) {
        tspans.forEach((tspan: any, index: number) => {
          const content = (tspan.textContent || '').trim()
          const isFrequencyLine = index === tspans.length - 1 && /^\(\d+\)$/.test(content)

          if (isFrequencyLine) {
            tspan.style.fontWeight = '700'
            tspan.style.fontSize = '14px'
          } else {
            tspan.style.fontWeight = '500'
            tspan.style.fontSize = '12px'
          }
        })
      }
    })

    gfx.style.display = 'none'
    gfx.offsetHeight // Trigger reflow
    gfx.style.display = ''
  }

  const styleModelActivity = (activityName: string) => {
    if (!viewerRef.current || !isLoaded) return
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
        const elementRegistry = viewerRef.current.get('elementRegistry') as any
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

  const addFrequenciesToModelActivities = (
    xmlString: string,
    activitiesWithFrequency = frequency_metrics.activities.model
  ): string => {
    try {
      const taskRegex = /<bpmn:(task|userTask|serviceTask|manualTask|scriptTask|sendTask|receiveTask|businessRuleTask)([^>]*name=")([^"]+)"([^>]*)/g

      return xmlString.replace(taskRegex, (match, taskType, beforeName, activityName, afterName) => {
        const strippedName = stripFrequencySuffix(activityName)
        const normalizedName = normalizeActivityName(strippedName)
        const frequency = activitiesWithFrequency[normalizedName]?.frequency

        if (!Number.isFinite(frequency)) {
          return match
        }

        return `<bpmn:${taskType}${beforeName}${strippedName}\n(${frequency})"${afterName}`
      })
    } catch (error) {
      console.error('[ADD FREQUENCIES] Error adding frequencies:', error)
      return xmlString
    }
  }

  const setupActivityHoverListeners = () => {
    if (!viewerRef.current || !isLoaded) return

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

  const addVisualFrequencyLabelsToFlows = (
    elementFrequencies: Record<string, { frequency: number; paths: Record<string, number> }>
  ) => {
    if (!viewerRef.current || !containerRef.current) return

    const elementRegistry = viewerRef.current.get('elementRegistry') as any
    const svg = containerRef.current.querySelector('svg')
    const viewport = svg?.querySelector('g.viewport') || svg?.querySelector('g')
    if (!svg || !viewport) return

    containerRef.current.querySelectorAll(`${bpmnAugmentationSelector('flow-label')}, ${bpmnAugmentationSelector('flow-hover-target')}`)
      .forEach((node) => node.remove())

    Object.entries(elementFrequencies).forEach(([elementId, flowData]) => {
      const element = elementRegistry.get(elementId)
      if (!element) return

      const gfx = elementRegistry.getGraphics(element)
      if (!gfx) return

      const waypoints = element?.waypoints
      if (!waypoints || waypoints.length < 2) return

      let longestSegmentStart = waypoints[0]
      let longestSegmentEnd = waypoints[1]
      let maxLength = 0

      for (let i = 0; i < waypoints.length - 1; i++) {
        const start = waypoints[i]
        const end = waypoints[i + 1]
        const length = Math.hypot(end.x - start.x, end.y - start.y)

        if (length > maxLength) {
          maxLength = length
          longestSegmentStart = start
          longestSegmentEnd = end
        }
      }

      const labelX = (longestSegmentStart.x + longestSegmentEnd.x) / 2
      const labelY = (longestSegmentStart.y + longestSegmentEnd.y) / 2
      const label = String(flowData.frequency)

      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
      setBpmnAugmentationAttributes(group, 'flow-label', {
        view: 'frequency',
        labelMode: 'direct',
        elementId
      })
      group.style.pointerEvents = 'none'

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      text.setAttribute('x', String(labelX))
      text.setAttribute('y', String(labelY))
      text.setAttribute('text-anchor', 'middle')
      text.setAttribute('dominant-baseline', 'middle')
      text.setAttribute('fill', 'black')
      text.setAttribute('font-size', '12')
      text.setAttribute('font-weight', 'bold')
      text.setAttribute('font-family', 'Arial, sans-serif')
      text.textContent = label
      text.style.pointerEvents = 'none'

      const labelWidth = label.length * 7 + 8
      const labelHeight = 16

      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
      rect.setAttribute('x', String(labelX - labelWidth / 2))
      rect.setAttribute('y', String(labelY - labelHeight / 2))
      rect.setAttribute('width', String(labelWidth))
      rect.setAttribute('height', String(labelHeight))
      rect.setAttribute('rx', '2')
      rect.setAttribute('ry', '2')
      rect.setAttribute('fill', 'white')
      rect.setAttribute('stroke', 'black')
      rect.setAttribute('stroke-width', '1.5')
      rect.style.pointerEvents = 'none'

      group.appendChild(rect)
      group.appendChild(text)
      viewport.appendChild(group)

      const hoverTarget = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
      setBpmnAugmentationAttributes(hoverTarget, 'flow-hover-target', {
        view: 'frequency',
        elementId
      })
      hoverTarget.setAttribute('x', String(Math.min(longestSegmentStart.x, longestSegmentEnd.x) - 8))
      hoverTarget.setAttribute('y', String(Math.min(longestSegmentStart.y, longestSegmentEnd.y) - 8))
      hoverTarget.setAttribute('width', String(Math.max(Math.abs(longestSegmentEnd.x - longestSegmentStart.x) + 16, labelWidth + 16)))
      hoverTarget.setAttribute('height', String(Math.max(Math.abs(longestSegmentEnd.y - longestSegmentStart.y) + 16, 24)))
      hoverTarget.setAttribute('fill', 'transparent')
      hoverTarget.style.pointerEvents = 'all'
      hoverTarget.style.cursor = 'pointer'
      hoverTarget.addEventListener('mouseenter', (event) => {
        const mouseEvent = event as MouseEvent
        setHoveredFlow({
          elementId,
          x: mouseEvent.clientX,
          y: mouseEvent.clientY,
          frequency: flowData.frequency,
          paths: flowData.paths
        })
      })
      hoverTarget.addEventListener('mousemove', (event) => {
        const mouseEvent = event as MouseEvent
        setHoveredFlow((current) => current
          ? { ...current, x: mouseEvent.clientX, y: mouseEvent.clientY }
          : current
        )
      })
      hoverTarget.addEventListener('mouseleave', () => {
        setHoveredFlow(null)
      })
      viewport.appendChild(hoverTarget)
    })
  }

  const resetFrequencyViewRenderState = () => {
    setIsLoaded(false)
    setShowViewer(false)

    const existingArrows = containerRef.current?.querySelectorAll(bpmnAugmentationSelector('deviation-arrow'))
    existingArrows?.forEach(arrow => arrow.remove())

    const existingLabels = containerRef.current?.querySelectorAll(bpmnAugmentationSelector('flow-label'))
    existingLabels?.forEach(label => label.remove())

    const existingHoverTargets = containerRef.current?.querySelectorAll(bpmnAugmentationSelector('flow-hover-target'))
    existingHoverTargets?.forEach(target => target.remove())

    setConnectionPointsUsage(new Map())
    setActivitiesToStyle([])
    setSecondaryActivitiesToStyle([])
    setArrowsToCreate([])
    setDeviationLanes(new Set())
    setEndEventIds(new Map())
  }

  const getFrequencyDeviationFilterContext = () => {
    const filterMin = withDeviationFrequencyFilter[0]
    const filterMax = withDeviationFrequencyFilter[1]

    // Primary deviations are the activities and flows whose frequency is inside the active range.
    const filteredStats = filterDeviationsByConnectionFrequency(
      filterMin,
      filterMax
    )

    const { activities: deviationActivitiesFreq, flows: deviationFlows } = filteredStats
    const deviationActivitiesNames = new Set(Object.keys(frequency_metrics.activities.deviations))
    const primaryDeviationActivities = new Set(Object.keys(deviationActivitiesFreq))

    // The full range means "show all"; narrower ranges need secondary context nodes.
    const isDeviationFilterActive =
      filterMin !== limitsFrequencyFlows.min || filterMax !== limitsFrequencyFlows.max

    return {
      filterMin,
      filterMax,
      deviationFlows,
      deviationActivitiesFreq,
      deviationActivitiesNames,
      primaryDeviationActivities,
      isDeviationFilterActive
    }
  }

  const getSecondaryFrequencyDeviationActivities = ({
    isDeviationFilterActive,
    primaryDeviationActivities,
    deviationActivitiesNames
  }: {
    isDeviationFilterActive: boolean
    primaryDeviationActivities: Set<string>
    deviationActivitiesNames: Set<string>
  }) => {
    const secondaryDeviationActivities = new Set<string>()

    if (!isDeviationFilterActive) {
      return secondaryDeviationActivities
    }

    // Keep deviation activities adjacent to filtered flows visible so rendered arrows keep context.
    const adjacentActivities = new Set<string>()

    frequency_metrics.flows.deviations.forEach(flow => {
      const toActivity = flow.to == '<<end>>' ? `<<end>>:${flow.from}` : flow.to
      if (primaryDeviationActivities.has(flow.from) || primaryDeviationActivities.has(toActivity)) {
        adjacentActivities.add(flow.from)
        adjacentActivities.add(toActivity)
      }
    })

    adjacentActivities.forEach(activity => {
      if (deviationActivitiesNames.has(activity) && !primaryDeviationActivities.has(activity)) {
        secondaryDeviationActivities.add(activity)
      }
    })

    return secondaryDeviationActivities
  }

  const buildFrequencyDeviationActivitiesAndLanes = ({
    xmlString,
    coordinates,
    allElements,
    lanes,
    activitiesLanes,
    primaryDeviationActivities,
    secondaryDeviationActivities
  }: {
    xmlString: string
    coordinates: ActivityCoordinatesCollection
    allElements: ElementCoordinates[]
    lanes: LaneElements
    activitiesLanes: Record<string, string>
    primaryDeviationActivities: Set<string>
    secondaryDeviationActivities: Set<string>
  }) => {
    const orderedDeviationActivities = orderDeviationActivitiesByModelPredecessors({
      deviationActivities: frequency_metrics.activities.deviations as any,
      deviationPredecessors: deviation_predecessors,
      modelActivities: frequency_metrics.activities.model as any
    })

    const genericDeviationActivities = Object.fromEntries(
      Object.entries(frequency_metrics.activities.deviations).map(([activityName, activity]) => [
        activityName,
        {
          originalActivity: activity.originalActivity,
          label: `${activity.originalActivity === '' ? 'No label' : activity.originalActivity} 
          (${activity.frequency})`
        }
      ])
    )

    // Delegate lane selection, collision checks and XML insertion to the shared deviation builder.
    return buildGenericDeviationActivitiesAndLanes({
      xmlString,
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
  }

  const buildFrequencyDeviationArrows = ({
    xmlString,
    coordinates,
    allElements,
    lanes,
    activitiesLanes,
    deviationFlows,
    primaryDeviationActivities,
    isDeviationFilterActive,
    filterMin,
    filterMax
  }: {
    xmlString: string
    coordinates: ActivityCoordinatesCollection
    allElements: ElementCoordinates[]
    lanes: LaneElements
    activitiesLanes: Record<string, string>
    deviationFlows: FrequencyFlowMetric[]
    primaryDeviationActivities: Set<string>
    isDeviationFilterActive: boolean
    filterMin: number
    filterMax: number
  }) => {
    const toGenericDeviationFlow = (flow: FrequencyFlowMetric): GenericDeviationFlowMetric => ({
      from: flow.from,
      to: flow.to,
      value: flow.frequency,
      label: String(flow.frequency)
    })

    // Use the same synthetic end-event and deviation-arrow builder as the other views.
    return buildGenericDeviationArrows({
      xmlString,
      coordinates,
      allElements,
      lanes,
      activitiesLanes,
      deviationFlows: deviationFlows.map(toGenericDeviationFlow),
      allDeviationFlows: frequency_metrics.flows.deviations.map(toGenericDeviationFlow),
      primaryDeviationActivities,
      isDeviationFilterActive,
      filterMin,
      filterMax,
      findSafePosition,
      createEndEventXML,
      deviationSizeProfile
    })
  }

  useEffect(() => {
    if (!viewerRef.current || !xml) return

    if (viewMode === 'model') {
      deviationsViewBuilt.current = false
    }

    if (viewMode === 'deviations') {
      deviationsViewBuilt.current = true
    }

    const processDeviationsWithCoordinates = async () => {
      resetFrequencyViewRenderState()
      
      try {
        const activityFrequenciesForView = viewMode === 'model'
          ? frequency_metrics.activities.model
          : frequency_metrics.activities.all
        const xmlWithFrequencies = addFrequenciesToModelActivities(xml, activityFrequenciesForView)
        await importAndSetupXML(xmlWithFrequencies)

        const coordResult = await getCoordinates({ viewer: viewerRef.current })

         if (!coordResult) {
          console.warn('Failed to get activity coordinates')
          return
        }

        let { coordinates, allElements, lanes, activitiesLanes } = coordResult
        setActivitiesCoordinates(coordinates)

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
            deviationActivitiesFreq,
            deviationActivitiesNames,
            primaryDeviationActivities,
            isDeviationFilterActive
          } = getFrequencyDeviationFilterContext()

          console.log('[DEVIATIONS VIEW] Using frequency filter values:', filterMin, '-', filterMax)
          console.log("[FILTERING] Flows that passed the filter:", { activities: deviationActivitiesFreq, flows: deviationFlows })

          const secondaryDeviationActivities = getSecondaryFrequencyDeviationActivities({
            isDeviationFilterActive,
            primaryDeviationActivities,
            deviationActivitiesNames
          })
          
          let modifiedXML = xmlWithFrequencies

          const deviationActivityBuildResult = buildFrequencyDeviationActivitiesAndLanes({
            xmlString: modifiedXML,
            coordinates,
            allElements,
            lanes,
            activitiesLanes,
            primaryDeviationActivities,
            secondaryDeviationActivities
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

          const deviationArrowBuildResult = buildFrequencyDeviationArrows({
            xmlString: modifiedXML,
            coordinates,
            allElements,
            lanes,
            activitiesLanes,
            deviationFlows,
            primaryDeviationActivities,
            isDeviationFilterActive,
            filterMin,
            filterMax
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
            frequency: arrow.value
          })))
          setDeviationLanes(newDeviationLanesSet)
          setEndEventIds(endEventIdsToStyle)

          if (deviatedLanes.length === 0 && deviatedLanesNames.length > 0) {
            setDeviatedLanes(deviatedLanesNames)
          }

          await importAndSetupXML(modifiedXML)
          setIsLoaded(true)
        }
        
        const activityPaths = buildModelActivityPaths(xmlWithFrequencies)

        const elementFrequencies = buildModelFrequencyLabelData({
          activityPaths,
          modelFlows: frequency_metrics.flows.model,
          modelActivities: frequency_metrics.activities.model
        })

        console.log('[MODEL VIEW] Calculated element frequencies for flows:', elementFrequencies)
        
        addVisualFrequencyLabelsToFlows(elementFrequencies)
        
      } catch (error) {
        console.error('Error processing deviations:', error)
       }
    }

    processDeviationsWithCoordinates()
    
  }, [xml, frequency_metrics.flows, frequency_metrics.activities, withDeviationFrequencyFilter, viewMode, deviationSizeProfile, deviation_predecessors])

  useEffect(() => {
    if (!isLoaded) return

    const timeoutId = setTimeout(() => {
      console.log("Styling model activities:", model_activities);

      if (model_activities.length > 0) {
        model_activities.forEach(activityName => {
          styleModelActivity(activityName)
        })
      }

      if (viewMode === 'deviations' && (activitiesToStyle.length > 0 || arrowsToCreate.length > 0 || deviationLanes.size > 0)) {
        if (viewModeRef.current === 'model') {
          console.log("View mode changed to model during timeout, skipping deviation styling");
          return
        }
        
        console.log("Activities To Style:", activitiesToStyle);
        console.log("Arrows To Create:", arrowsToCreate);
        console.log("Secondary Arrows:", arrowsToCreate.filter(arrow => arrow.isSecondary));
        console.log("Deviation Lanes To Style:", Array.from(deviationLanes));

        const existingArrows = containerRef.current?.querySelectorAll(bpmnAugmentationSelector('deviation-arrow'))
        existingArrows?.forEach(arrow => arrow.remove())

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
          createDeviationArrow({
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
      }
      setShowViewer(true)
      setupActivityHoverListeners();
    }, 200)  // Small delay to ensure DOM is ready

    return () => clearTimeout(timeoutId)
  }, [isLoaded, model_activities, activitiesToStyle, secondaryActivitiesToStyle, arrowsToCreate, deviationLanes, endEventIds, viewMode])

  return (
    <div className="w-full h-full relative">
      <div className="absolute top-0 left-0 z-30 h-full">
         <BpmnFrequencyLegend 
            activitiesWithFrequency={
              viewMode === 'model' ? 
                frequency_metrics.activities.model : 
                frequency_metrics.activities.deviations
            }
            deviatedLanes={deviatedLanes}    
            frequencyFilter={withDeviationFrequencyFilter}
            onFrequencyFilterChange={setWithDeviationFrequencyFilter}
            viewMode={viewMode}
            onViewModeChange={handleFrequencyViewModeChange}
            limitsFrequencyFlows={limitsFrequencyFlows}
            hasDeviationData={hasFrequencyDeviationData}
            isLoading={!isLoaded}
          />
      </div>

      <div className="absolute top-0 right-0 z-30 h-full">
        <BpmnFrequencyHeatmap 
          limitsFrequencyActivities={limitsFrequencyActivities}
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
              handleSvgDownload('frequency', viewMode, containerRef),
              t('imageDownload.exporting'),
              t('imageDownload.success'),
              t('imageDownload.failure')
            )
          }}
        />)
      }

      {hoveredActivity && (() => {

        if (!frequencyActivities[hoveredActivity.name]) {
          return null
        }
        const hoveredActivityMetrics = frequencyActivities[hoveredActivity.name]
        const flagRoles = !!activitiesRoles[hoveredActivity.name]
        const orderedRoles = flagRoles ? 
          activitiesRoles[hoveredActivity.name].sort((a, b) => b.frequency - a.frequency) : []
        
        return (
          <BpmnFrequencyActivityTooltip
            activityName={hoveredActivity.originalName}
            x={hoveredActivity.x}
            y={hoveredActivity.y}
            frequency={hoveredActivityMetrics.frequency}
            {...(hoveredActivityMetrics.frequency > 0 ? { roles: orderedRoles } : {})}
            {...(hoveredActivityMetrics.mismatch_incoming != undefined ? { mismatch_incoming: hoveredActivityMetrics.mismatch_incoming } : {})}
            {...(hoveredActivityMetrics.mismatch_outgoing != undefined ? { mismatch_outgoing: hoveredActivityMetrics.mismatch_outgoing } : {})}
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
                  frequency: hoveredActivityMetrics.frequency
                })
              }
            } : {})}
          />
        )
      })()}

      {hoveredFlow && (() => {

        if (hoveredFlow ==null){
          return null
        }

        return (
          <BpmnFrequencyFlowTooltip
            elementId={hoveredFlow.elementId}
            x={hoveredFlow.x}
            y={hoveredFlow.y}
            frequency={hoveredFlow.frequency}
            paths={hoveredFlow.paths}
          />
        )

      })()}

      {clickedActivity && (
        <BpmnFrequencyActivityRoles
          activityName={clickedActivity.originalName.replace(/\s*\(\d+\)$/, '')}
          roles={clickedActivity.roles}
          frequency={clickedActivity.frequency}
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
