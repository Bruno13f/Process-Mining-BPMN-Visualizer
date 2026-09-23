import type { PerformanceActivityMetric, PerformanceFlowMetric, TimeConformanceFlowMetrics } from '@/types/analysis-backend'
import { formatSecondsFull, formatSecondsHuman, normalizeActivityName } from './functions'
import {
  BPMN_AUGMENTATION_ATTRS,
  bpmnAugmentationSelector,
  setBpmnAugmentationAttributes,
  stripFrequencySuffix as stripBpmnSuffix
} from './bpmn-utils'

type TimeConformanceStatus =
  'muchFasterThanExpected' |
  'fasterThanExpected' |
  'slightlyFasterThanExpected' |
  'asExpected' |
  'slightlySlowerThanExpected' |
  'slowerThanExpected' |
  'muchSlowerThanExpected'

export type TimeConformanceData = {
  from: string
  to: string
  averageActivityTime: number
  averageWaitingTime: number
  observedTime: number
  cycleTime: number
  absoluteDeviationPercentage: number
  status: TimeConformanceStatus
  color: string
}

export type PathPerformanceData = {
  elements: string[]
  average: number
  selected_sojourn: number
  labelFlowId?: string
  sourceElementId?: string
  targetElementId?: string
  targetType?: string
  conformance?: TimeConformanceData
}

export type ModelPerformanceClickedElement = {
  elementId: string
  avg_sojourn?: number
  paths?: Record<string, PathPerformanceData>
  checkedPaths?: Record<string, boolean>
} | null

export type ElementAverageData = {
  paths: Record<string, PathPerformanceData>
}

export type ModelPerformanceLabelData = {
  elementSojourns: Record<string, ElementAverageData>
  inlineLabelAverages: Record<string, number>
  inlineLabelConformance: Record<string, TimeConformanceData | undefined>
  naFallbackFlowIds: Set<string>
}

const TIME_CONFORMANCE_TOLERANCE = 0.1
const TIME_CONFORMANCE_FULL_RED = 0.5
const TIME_CONFORMANCE_SCOPE_ATTR = BPMN_AUGMENTATION_ATTRS.scope
const TIME_CONFORMANCE_MARKER_ATTR = 'data-time-conformance-marker-end'

const normalizePerformanceKey = (activityName: string) => {
  if (activityName === '<<start>>' || activityName === '<<end>>') {
    return activityName
  }

  return normalizeActivityName(activityName)
}

export const addAverageTimeToModelActivities = (
  xmlString: string,
  modelActivities: PerformanceActivityMetric
) => {
  const taskRegex = /<bpmn:(task|userTask|serviceTask|manualTask|scriptTask|sendTask|receiveTask|businessRuleTask)([^>]*name=")([^"]+)"([^>]*)/g

  return xmlString.replace(taskRegex, (match, taskType, beforeName, activityName, afterName) => {
    const strippedName = stripBpmnSuffix(activityName)
    const normalizedName = normalizeActivityName(strippedName)
    const activityMetrics = modelActivities[normalizedName] as PerformanceActivityMetric[string] & {
      selected_sojourn?: number
    } | undefined
    const averageTime = Number.isFinite(activityMetrics?.selected_sojourn)
      ? activityMetrics?.selected_sojourn
      : activityMetrics?.avg_sojourn

    if (!Number.isFinite(averageTime)) {
      return match
    }

    const newName = `${strippedName}\n(${!averageTime ? 'N/A' : formatSecondsFull(averageTime, false)})`
    return `<bpmn:${taskType}${beforeName}${newName}"${afterName}`
  })
}

export const buildModelActivityPathsFromFlows = (
  xmlString: string,
  modelFlows: PerformanceFlowMetric[],
  modelNextActivities?: Record<string, string[]>
) => {
  const parser = new DOMParser()
  const xmlDoc = parser.parseFromString(xmlString, 'text/xml')
  const elementById: Record<string, Element> = {}
  const activityByName: Record<string, Element> = {}
  const sequenceFlowById: Record<string, { sourceRef: string; targetRef: string }> = {}
  const activityPaths: Record<string, Record<string, string[]>> = {}

  xmlDoc.querySelectorAll('[id]').forEach((el) => {
    const id = el.getAttribute('id')
    if (!id) return

    elementById[id] = el

    if (el.tagName.includes('task') || el.tagName.includes('Task')) {
      const name = el.getAttribute('name')
      if (name) {
        activityByName[normalizeActivityName(stripBpmnSuffix(name))] = el
      }
    }

    if (el.tagName.includes('startEvent') || el.tagName.includes('StartEvent')) {
      activityByName['<<start>>'] = el
    }
  })

  xmlDoc.querySelectorAll('[sourceRef][targetRef]').forEach((flow) => {
    const id = flow.getAttribute('id')
    const sourceRef = flow.getAttribute('sourceRef')
    const targetRef = flow.getAttribute('targetRef')
    if (id && sourceRef && targetRef) {
      sequenceFlowById[id] = { sourceRef, targetRef }
    }
  })

  const getOutgoingFlows = (elementId: string) => {
    return Object.entries(sequenceFlowById)
      .filter(([, flow]) => flow.sourceRef === elementId)
      .map(([flowId, flow]) => ({ flowId, targetId: flow.targetRef }))
  }

  const findPath = (sourceId: string, targetId: string) => {
    const queue: Array<{ elementId: string; path: string[] }> = [{ elementId: sourceId, path: [] }]
    const visited = new Set<string>([sourceId])

    while (queue.length > 0) {
      const { elementId, path } = queue.shift()!
      if (elementId === targetId) return path

      for (const { flowId, targetId: nextTargetId } of getOutgoingFlows(elementId)) {
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

        const targetTagName = targetElement.tagName
        queue.push({
          elementId: nextTargetId,
          path: targetTagName.includes('Gateway') || targetTagName.includes('gateway')
            ? [...newPath, nextTargetId]
            : newPath
        })
      }
    }

    return []
  }

  const findEndEventPath = (sourceId: string) => {
    const queue: Array<{ elementId: string; path: string[] }> = [{ elementId: sourceId, path: [] }]
    const visited = new Set<string>([sourceId])

    while (queue.length > 0) {
      const { elementId, path } = queue.shift()!

      for (const { flowId, targetId } of getOutgoingFlows(elementId)) {
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

        queue.push({
          elementId: targetId,
          path: targetTagName.includes('Gateway') || targetTagName.includes('gateway')
            ? [...newPath, targetId]
            : newPath
        })
      }
    }

    return null
  }

  const addActivityPath = (fromActivity: string, toActivity: string) => {
    const sourceElement = activityByName[fromActivity]
    if (!sourceElement) return

    const sourceId = sourceElement.getAttribute('id')
    if (!sourceId) return

    if (!activityPaths[fromActivity]) {
      activityPaths[fromActivity] = {}
    }

    if (toActivity === '<<end>>') {
      const path = findEndEventPath(sourceId)
      if (path) activityPaths[fromActivity][toActivity] = path
      return
    }

    const targetElement = activityByName[toActivity]
    const targetId = targetElement?.getAttribute('id')
    if (!targetId) return

    const path = findPath(sourceId, targetId)
    if (path.length > 0) {
      activityPaths[fromActivity][toActivity] = path
    }
  }

  if (modelNextActivities) {
    Object.entries(modelNextActivities).forEach(([fromActivity, targetActivities]) => {
      targetActivities.forEach((toActivity) => {
        addActivityPath(fromActivity, toActivity)
      })
    })
  } else {
    modelFlows.forEach((flow) => {
      addActivityPath(flow.from, flow.to)
    })
  }

  return activityPaths
}

export const buildWithDeviationsActivityPathsFromFlows = ({
  xmlString,
  modelFlows,
  allFlows,
  deviationActivities,
  modelNextActivities,
  container
}: {
  xmlString: string
  modelFlows: PerformanceFlowMetric[]
  allFlows: PerformanceFlowMetric[]
  deviationActivities?: PerformanceActivityMetric
  modelNextActivities?: Record<string, string[]>
  container: HTMLElement | null
}) => {
  const activityPaths = buildModelActivityPathsFromFlows(
    xmlString,
    modelFlows,
    modelNextActivities
  )

  Object.keys(deviationActivities || {}).forEach((activityKey) => {
    if (!activityPaths[activityKey]) {
      activityPaths[activityKey] = {}
    }
  })

  if (!container) return activityPaths

  const normalizeEndKey = (activityKey: string) => {
    return activityKey.startsWith('<<end>>:') ? '<<end>>' : activityKey
  }
  const getFlowPairKey = (from: string, to: string) => (
    `${from}::${normalizeEndKey(to)}`
  )
  const modelFlowPairs = new Set(modelFlows.map((flow) => getFlowPairKey(flow.from, flow.to)))
  const allFlowByPair = new Map(allFlows.map((flow) => [getFlowPairKey(flow.from, flow.to), flow]))
  const deviationArrowByPair = new Map<string, { from: string; to: string; ids: string[] }>()

  container.querySelectorAll(bpmnAugmentationSelector('deviation-arrow')).forEach((arrow) => {
    const from = arrow.getAttribute(BPMN_AUGMENTATION_ATTRS.from)
    const to = arrow.getAttribute(BPMN_AUGMENTATION_ATTRS.to)
    const id = arrow.getAttribute(BPMN_AUGMENTATION_ATTRS.id) || arrow.id
    if (from === null || to === null || !id) return

    const pairKey = getFlowPairKey(from, to)
    if (!deviationArrowByPair.has(pairKey)) {
      deviationArrowByPair.set(pairKey, { from, to: normalizeEndKey(to), ids: [] })
    }

    deviationArrowByPair.get(pairKey)?.ids.push(id)
  })

  deviationArrowByPair.forEach(({ from, to, ids }) => {
    const pairKey = getFlowPairKey(from, to)
    const flow = allFlowByPair.get(pairKey)
    if (!flow || modelFlowPairs.has(pairKey)) return

    if (!ids.length) return

    if (!activityPaths[flow.from]) {
      activityPaths[flow.from] = {}
    }

    activityPaths[flow.from][flow.to] = ids
  })

  return activityPaths
}

const getElementType = (elementOrRef: any, elementRegistry: any) => {
  const directType = elementOrRef?.$type || elementOrRef?.type || elementOrRef?.businessObject?.$type
  if (directType) return directType as string

  const refId = elementOrRef?.id || elementOrRef?.businessObject?.id
  if (!refId) return undefined

  const registryElement = elementRegistry.get(refId)
  return registryElement?.businessObject?.$type || registryElement?.type || undefined
}

const isActivityType = (type?: string) => !!type && (
  type.includes('Task') ||
  type === 'bpmn:Activity' ||
  type === 'bpmn:SubProcess'
)

const isGatewayType = (type?: string) => !!type && type.includes('Gateway')
const isStartEventType = (type?: string) => type === 'bpmn:StartEvent'
const isEndEventType = (type?: string) => type === 'bpmn:EndEvent'

const getTimeConformanceStatus = (relativeDeviation: number): TimeConformanceStatus => {
  if (relativeDeviation <= -0.5) return 'muchFasterThanExpected'
  if (relativeDeviation <= -0.25) return 'fasterThanExpected'
  if (relativeDeviation < -TIME_CONFORMANCE_TOLERANCE) return 'slightlyFasterThanExpected'
  if (relativeDeviation <= TIME_CONFORMANCE_TOLERANCE) return 'asExpected'
  if (relativeDeviation < 0.25) return 'slightlySlowerThanExpected'
  if (relativeDeviation < TIME_CONFORMANCE_FULL_RED) return 'slowerThanExpected'
  return 'muchSlowerThanExpected'
}

const getTimeConformanceColor = (relativeDeviation: number) => {
  const ratio = Math.max(
    0,
    Math.min(
      1,
      (relativeDeviation + TIME_CONFORMANCE_FULL_RED) / (TIME_CONFORMANCE_FULL_RED * 2)
    )
  )
  const red = Math.round(255 * ratio)
  const green = Math.round(255 * (1 - ratio))

  return `rgb(${red}, ${green}, 0)`
}

const buildTimeConformanceByPair = (timeConformance: TimeConformanceFlowMetrics) => {
  const conformanceByPair = new Map<string, TimeConformanceData>()

  timeConformance.forEach((metric) => {
    const from = normalizePerformanceKey(metric.from)
    const to = normalizePerformanceKey(metric.to)
    const cycleTime = metric.cycle_time
    const isEndEvent = to === '<<end>>'
    const hasObservedTime = isEndEvent
      ? Number.isFinite(metric.avg_waiting_time)
      : Number.isFinite(metric.avg_waiting_time) &&
        Number.isFinite(metric.avg_target_time)
    const observedTime = isEndEvent
      ? metric.avg_waiting_time
      : metric.avg_waiting_time + metric.avg_target_time

    if (!Number.isFinite(cycleTime) || cycleTime <= 0 || !hasObservedTime) {
      return
    }

    const deviation = observedTime - cycleTime
    const relativeDeviation = deviation / cycleTime
    const absoluteDeviation = Math.abs(relativeDeviation)

    conformanceByPair.set(`${from}::${to}`, {
      from,
      to,
      averageActivityTime: isEndEvent ? 0 : metric.avg_target_time,
      averageWaitingTime: metric.avg_waiting_time,
      observedTime,
      cycleTime,
      absoluteDeviationPercentage: absoluteDeviation * 100,
      status: getTimeConformanceStatus(relativeDeviation),
      color: getTimeConformanceColor(relativeDeviation)
    })
  })

  return conformanceByPair
}

const getFlowEndpoints = (flowId: string, elementRegistry: any) => {
  const flowElement = elementRegistry.get(flowId)
  return {
    sourceType: getElementType(flowElement?.businessObject?.sourceRef, elementRegistry),
    targetType: getElementType(flowElement?.businessObject?.targetRef, elementRegistry)
  }
}

const getFlowTarget = (flowId: string, elementRegistry: any) => {
  const flowElement = elementRegistry.get(flowId)
  const targetRef = flowElement?.businessObject?.targetRef
  const targetId = targetRef?.id
  if (!targetId) return null

  const targetElement = elementRegistry.get(targetId)
  return {
    id: targetId,
    type: targetElement?.businessObject?.$type || targetElement?.type || targetRef?.$type
  }
}

const getLastFlowIntoTarget = (path: string[], elementRegistry: any) => {
  for (let index = path.length - 1; index >= 0; index--) {
    const elementId = path[index]
    const element = elementRegistry.get(elementId)
    if (element?.businessObject?.$type !== 'bpmn:SequenceFlow') continue

    const targetType = element.businessObject?.targetRef?.$type
    if (isActivityType(targetType) || isEndEventType(targetType)) {
      return elementId
    }
  }

  return path[path.length - 1]
}

const storeSvgStyle = (node: SVGElement) => {
  if (node.dataset.timeConformanceOriginalStored) return

  node.dataset.timeConformanceOriginalStored = 'true'
  node.dataset.timeConformanceOriginalStroke = node.getAttribute('stroke') || ''
  node.dataset.timeConformanceOriginalStrokeStyle = node.style.stroke || ''
  node.dataset.timeConformanceOriginalStrokeWidth = node.getAttribute('stroke-width') || ''
  node.dataset.timeConformanceOriginalStrokeWidthStyle = node.style.strokeWidth || ''
  node.dataset.timeConformanceOriginalFill = node.getAttribute('fill') || ''
  node.dataset.timeConformanceOriginalFillStyle = node.style.fill || ''
  node.dataset.timeConformanceOriginalMarkerEnd = node.getAttribute('marker-end') || ''
  node.dataset.timeConformanceOriginalMarkerEndStyle = node.style.markerEnd || ''
  node.dataset.timeConformanceOriginalTextHtml = node.tagName.toLowerCase() === 'text'
    ? node.innerHTML
    : ''
}

const restoreSvgStyle = (node: SVGElement) => {
  if (!node.dataset.timeConformanceOriginalStored) return

  const restoreAttribute = (attribute: string, value?: string) => {
    if (value) {
      node.setAttribute(attribute, value)
    } else {
      node.removeAttribute(attribute)
    }
  }

  restoreAttribute('stroke', node.dataset.timeConformanceOriginalStroke)
  restoreAttribute('stroke-width', node.dataset.timeConformanceOriginalStrokeWidth)
  restoreAttribute('fill', node.dataset.timeConformanceOriginalFill)
  restoreAttribute('marker-end', node.dataset.timeConformanceOriginalMarkerEnd)

  if (node.dataset.timeConformanceOriginalStrokeStyle) {
    node.style.stroke = node.dataset.timeConformanceOriginalStrokeStyle
  } else {
    node.style.removeProperty('stroke')
  }

  if (node.dataset.timeConformanceOriginalStrokeWidthStyle) {
    node.style.strokeWidth = node.dataset.timeConformanceOriginalStrokeWidthStyle
  } else {
    node.style.removeProperty('stroke-width')
  }

  if (node.dataset.timeConformanceOriginalFillStyle) {
    node.style.fill = node.dataset.timeConformanceOriginalFillStyle
  } else {
    node.style.removeProperty('fill')
  }

  if (node.dataset.timeConformanceOriginalMarkerEndStyle) {
    node.style.markerEnd = node.dataset.timeConformanceOriginalMarkerEndStyle
  } else {
    node.style.removeProperty('marker-end')
  }

  if (node.dataset.timeConformanceOriginalTextHtml) {
    node.innerHTML = node.dataset.timeConformanceOriginalTextHtml
  }

  delete node.dataset.timeConformanceOriginalStored
  delete node.dataset.timeConformanceOriginalStroke
  delete node.dataset.timeConformanceOriginalStrokeStyle
  delete node.dataset.timeConformanceOriginalStrokeWidth
  delete node.dataset.timeConformanceOriginalStrokeWidthStyle
  delete node.dataset.timeConformanceOriginalFill
  delete node.dataset.timeConformanceOriginalFillStyle
  delete node.dataset.timeConformanceOriginalMarkerEnd
  delete node.dataset.timeConformanceOriginalMarkerEndStyle
  delete node.dataset.timeConformanceOriginalTextHtml
  node.removeAttribute(TIME_CONFORMANCE_MARKER_ATTR)
}

export const clearTimeConformanceStyles = (
  container: HTMLDivElement | null,
  scope?: 'inline' | 'selected'
) => {
  const selector = scope
    ? `[${TIME_CONFORMANCE_SCOPE_ATTR}="${scope}"]`
    : `[${TIME_CONFORMANCE_SCOPE_ATTR}]`

  container?.querySelectorAll(selector).forEach((node) => {
    if ((node as SVGElement).getAttribute(BPMN_AUGMENTATION_ATTRS.type) === 'time-conformance-background') {
      node.remove()
      return
    }

    restoreSvgStyle(node as SVGElement)
    ;(node as SVGElement).removeAttribute(TIME_CONFORMANCE_SCOPE_ATTR)
  })
}

const styleFlowStroke = (
  elementRegistry: any,
  flowId: string | undefined,
  color: string,
  scope: 'inline' | 'selected'
) => {
  if (!flowId) return

  const element = elementRegistry.get(flowId)
  const gfx = element ? elementRegistry.getGraphics(element) : null
  if (!gfx) return

  const strokeNodes = Array.from(gfx.querySelectorAll('path, polyline, line')) as SVGElement[]

  const getMarkerId = (markerEnd?: string) => {
    return markerEnd?.match(/url\(["']?#([^"')]+)["']?\)/)?.[1]
  }

  const colorMarkerEnd = (node: SVGElement) => {
    const markerEnd = node.dataset.timeConformanceOriginalMarkerEnd ||
      node.dataset.timeConformanceOriginalMarkerEndStyle ||
      node.getAttribute('marker-end') ||
      node.style.markerEnd
    const markerId = getMarkerId(markerEnd)
    const svg = node.ownerSVGElement
    if (!markerId || !svg) return

    const sourceMarker = svg.querySelector(`defs marker[id="${markerId}"]`) as SVGMarkerElement | null
    const defs = svg.querySelector('defs')
    if (!sourceMarker || !defs) return

    const markerColorId = `time-conformance-${scope}-${flowId}-${color}-${Math.random().toString(36).slice(2)}`
      .replace(/[^a-zA-Z0-9_-]/g, '-')
    const marker = sourceMarker.cloneNode(true) as SVGMarkerElement
    marker.setAttribute('id', markerColorId)
    marker.setAttribute('fill', color)
    marker.setAttribute('stroke', color)
    marker.style.fill = color
    marker.style.stroke = color
    marker.querySelectorAll('path, polyline, line, polygon, rect, circle, ellipse').forEach((markerNode) => {
      const svgNode = markerNode as SVGElement
      svgNode.setAttribute('fill', color)
      svgNode.setAttribute('stroke', color)
      svgNode.style.fill = color
      svgNode.style.stroke = color
      svgNode.style.setProperty('fill', color, 'important')
      svgNode.style.setProperty('stroke', color, 'important')
    })
    defs.appendChild(marker)

    const markerUrl = `url(#${markerColorId})`
    node.setAttribute('marker-end', markerUrl)
    node.setAttribute(TIME_CONFORMANCE_MARKER_ATTR, markerUrl)
    node.style.markerEnd = markerUrl
    node.style.setProperty('marker-end', markerUrl, 'important')
  }

  strokeNodes.forEach((node) => {
    storeSvgStyle(node)
    node.setAttribute(TIME_CONFORMANCE_SCOPE_ATTR, scope)
    node.setAttribute('stroke', color)
    node.style.stroke = color
    node.style.strokeWidth = '2.5px'
    colorMarkerEnd(node)
  })
}

const styleLabelOutline = (
  labelGroup: Element | null,
  color: string,
  scope: 'inline' | 'selected'
) => {
  if (!labelGroup) return

  const rect = labelGroup.querySelector('rect') as SVGElement | null
  if (!rect) return

  storeSvgStyle(rect)
  rect.setAttribute(TIME_CONFORMANCE_SCOPE_ATTR, scope)
  rect.setAttribute('stroke', color)
  rect.setAttribute('stroke-width', '2.5')
  rect.style.stroke = color
  rect.style.strokeWidth = '2.5px'
}

const styleDeviationArrowElement = (
  container: HTMLDivElement | null,
  arrowId: string,
  color: string,
  scope: 'inline' | 'selected'
) => {
  const arrowGroup = container?.querySelector(
    bpmnAugmentationSelector('deviation-arrow', { id: arrowId })
  ) as SVGElement | null
  if (!arrowGroup) return

  arrowGroup.parentNode?.appendChild(arrowGroup)
  arrowGroup.style.opacity = '1'
  arrowGroup.setAttribute('data-is-highlighted', 'true')

  const strokeNodes = Array.from(
    arrowGroup.querySelectorAll('path, polyline, line')
  ) as SVGElement[]
  strokeNodes.forEach((node) => {
    storeSvgStyle(node)
    node.setAttribute(TIME_CONFORMANCE_SCOPE_ATTR, scope)
    node.setAttribute('stroke', color)
    node.style.stroke = color
    node.style.strokeWidth = '3px'
  })

  const arrowHeadNodes = Array.from(arrowGroup.querySelectorAll('polygon')) as SVGElement[]
  arrowHeadNodes.forEach((node) => {
    storeSvgStyle(node)
    node.setAttribute(TIME_CONFORMANCE_SCOPE_ATTR, scope)
    node.setAttribute('fill', color)
    node.setAttribute('stroke', color)
    node.style.fill = color
    node.style.stroke = color
    node.style.strokeWidth = '1.5px'
  })

  const labelRects = Array.from(arrowGroup.querySelectorAll('rect')) as SVGElement[]
  labelRects.forEach((node) => {
    storeSvgStyle(node)
    node.setAttribute(TIME_CONFORMANCE_SCOPE_ATTR, scope)
    node.setAttribute('stroke', color)
    node.setAttribute('stroke-width', '2.5')
    node.style.stroke = color
    node.style.strokeWidth = '2.5px'
  })
}

const styleGatewayOutline = (
  elementRegistry: any,
  gatewayElementId: string,
  color: string,
  scope: 'inline' | 'selected'
) => {
  const element = elementRegistry.get(gatewayElementId)
  const elementType = element?.businessObject?.$type || element?.type || ''
  if (!isGatewayType(elementType)) return

  const gfx = elementRegistry.getGraphics(element)
  if (!gfx) return

  const visual = gfx.querySelector('.djs-visual') || gfx
  const directVisualNodes = Array.from(visual.children) as SVGElement[]
  const outlineNode = directVisualNodes.find((node) => {
    return ['polygon', 'rect', 'circle', 'ellipse'].includes(node.tagName.toLowerCase())
  })
  const strokeNodes = outlineNode ? [outlineNode] : []

  strokeNodes.forEach((node) => {
    storeSvgStyle(node)
    node.setAttribute(TIME_CONFORMANCE_SCOPE_ATTR, scope)
    node.setAttribute('stroke', color)
    node.style.stroke = color
    node.style.strokeWidth = '2.5px'
  })
}

const getPrimaryElementBBox = (gfx: SVGGElement, element: any) => {
  const visual = gfx.querySelector('.djs-visual') || gfx
  const shape = Array.from(visual.querySelectorAll('rect, path, circle, ellipse, polygon')).find((node) => {
    return (node as SVGElement).getAttribute(BPMN_AUGMENTATION_ATTRS.type) !== 'time-conformance-background'
  }) as SVGGraphicsElement | undefined

  if (shape) {
    return shape.getBBox()
  }

  if (
    Number.isFinite(element?.x) &&
    Number.isFinite(element?.y) &&
    Number.isFinite(element?.width) &&
    Number.isFinite(element?.height)
  ) {
    return {
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height
    }
  }

  return gfx.getBBox()
}

const getViewportElementBBox = (gfx: SVGGElement, element: any) => {
  if (
    Number.isFinite(element?.x) &&
    Number.isFinite(element?.y) &&
    Number.isFinite(element?.width) &&
    Number.isFinite(element?.height)
  ) {
    return {
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height
    }
  }

  return gfx.getBBox()
}

const isDeviationBorderStroke = (stroke: string | null | undefined) => {
  const normalizedStroke = (stroke || '').replace(/\s+/g, '').toLowerCase()

  return (
    normalizedStroke === '#ff0000' ||
    normalizedStroke === 'red' ||
    normalizedStroke === 'rgb(255,0,0)' ||
    normalizedStroke === 'rgba(255,0,0,1)'
  )
}

const raiseBpmnElementGraphics = (gfx: SVGElement | null | undefined) => {
  if (!gfx) return

  const graphicsGroup = gfx.closest?.('g.djs-group') as SVGElement | null
  const nodeToRaise = graphicsGroup || gfx
  nodeToRaise.parentNode?.appendChild(nodeToRaise)
}

const addSelectedActivityViewportBackground = ({
  container,
  element,
  gfx,
  elementId,
  fill
}: {
  container: HTMLDivElement | null
  element: any
  gfx: SVGElement | null | undefined
  elementId: string
  fill: string
}) => {
  const svg = container?.querySelector('svg')
  if (!svg || !gfx) return

  svg.querySelector(
    bpmnAugmentationSelector('time-conformance-background', {
      scope: 'selected',
      elementId
    })
  )?.remove()

  const viewport = svg.querySelector('g.viewport') || svg.querySelector('g')
  if (!viewport) return

  const bbox = getViewportElementBBox(gfx as SVGGElement, element)
  const overlayInset = 2
  const overlayBox = {
    x: overlayInset,
    y: overlayInset,
    width: Math.max(0, bbox.width - overlayInset * 2),
    height: Math.max(0, bbox.height - overlayInset * 2)
  }

  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  group.setAttribute('transform', `translate(${bbox.x}, ${bbox.y})`)
  group.setAttribute(TIME_CONFORMANCE_SCOPE_ATTR, 'selected')
  setBpmnAugmentationAttributes(group, 'time-conformance-background', {
    view: 'time-conformance',
    scope: 'selected',
    elementId
  })
  group.style.pointerEvents = 'none'

  const backgroundRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  backgroundRect.setAttribute('x', String(overlayBox.x))
  backgroundRect.setAttribute('y', String(overlayBox.y))
  backgroundRect.setAttribute('width', String(overlayBox.width))
  backgroundRect.setAttribute('height', String(overlayBox.height))
  backgroundRect.setAttribute('rx', '7')
  backgroundRect.setAttribute('ry', '7')
  backgroundRect.setAttribute('fill', fill)
  backgroundRect.setAttribute('stroke', 'none')
  backgroundRect.setAttribute('opacity', '1')
  backgroundRect.setAttribute('fill-opacity', '1')
  backgroundRect.style.setProperty('fill', fill, 'important')
  backgroundRect.style.setProperty('fill-opacity', '1', 'important')
  backgroundRect.style.setProperty('opacity', '1', 'important')
  backgroundRect.style.pointerEvents = 'none'
  group.appendChild(backgroundRect)

  const existingText = gfx.querySelector('text') as SVGTextElement | null
  if (existingText) {
    const clonedText = existingText.cloneNode(true) as SVGTextElement
    clonedText.setAttribute('fill', '#000000')
    clonedText.style.fill = '#000000'
    clonedText.style.pointerEvents = 'none'
    clonedText.querySelectorAll('tspan').forEach((tspan) => {
      const tspanElement = tspan as SVGTSpanElement
      tspanElement.setAttribute('fill', '#000000')
      tspanElement.style.fill = '#000000'
    })

    group.appendChild(clonedText)
  }

  viewport.appendChild(group)
}

const styleActivityElement = (
  elementRegistry: any,
  container: HTMLDivElement | null,
  elementId: string | undefined,
  color: string,
  scope: 'inline' | 'selected'
) => {
  if (!elementId) return

  const element = elementRegistry.get(elementId)
  const gfx = element ? elementRegistry.getGraphics(element) : null
  if (!gfx) return

  const elementType = element.businessObject?.$type || element.type || ''
  const isTargetEndEvent = isEndEventType(elementType)

  if (isTargetEndEvent) {
    const strokeNodes = Array.from(gfx.querySelectorAll('path, circle, ellipse, rect, polygon')) as SVGElement[]
    strokeNodes.forEach((node) => {
      storeSvgStyle(node)
      node.setAttribute(TIME_CONFORMANCE_SCOPE_ATTR, scope)
      node.setAttribute('stroke', color)
      node.style.stroke = color
      node.style.strokeWidth = '2.5px'
    })
    return
  }

  if (!isActivityType(elementType)) return

  const bbox = getPrimaryElementBBox(gfx, element)
  const backgroundRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  backgroundRect.setAttribute('x', String(bbox.x))
  backgroundRect.setAttribute('y', String(bbox.y))
  backgroundRect.setAttribute('width', String(bbox.width))
  backgroundRect.setAttribute('height', String(bbox.height))
  backgroundRect.setAttribute('rx', '10')
  backgroundRect.setAttribute('ry', '10')
  backgroundRect.setAttribute('fill', color)
  backgroundRect.setAttribute('stroke', 'none')
  backgroundRect.setAttribute('opacity', '1')
  backgroundRect.setAttribute(TIME_CONFORMANCE_SCOPE_ATTR, scope)
  setBpmnAugmentationAttributes(backgroundRect, 'time-conformance-background', {
    view: 'time-conformance',
    scope
  })
  backgroundRect.style.pointerEvents = 'none'

  if (gfx.firstChild) {
    gfx.insertBefore(backgroundRect, gfx.firstChild)
  } else {
    gfx.appendChild(backgroundRect)
  }

  const shapeNodes = Array.from(gfx.querySelectorAll(`rect:not(${bpmnAugmentationSelector('time-conformance-background')}), path, circle, ellipse, polygon`)) as SVGElement[]
  shapeNodes.forEach((node) => {
    storeSvgStyle(node)
    const existingStroke = node.style.stroke || node.getAttribute('stroke')
    const strokeColor = isDeviationBorderStroke(existingStroke) ? '#ff0000' : '#000000'

    node.setAttribute(TIME_CONFORMANCE_SCOPE_ATTR, scope)
    node.setAttribute('fill', 'rgba(0, 0, 0, 0)')
    node.setAttribute('stroke', strokeColor)
    node.style.fill = 'rgba(0, 0, 0, 0)'
    node.style.setProperty('stroke', strokeColor, strokeColor === '#ff0000' ? 'important' : '')
    node.style.strokeWidth = '1.5px'
  })

  const textNodes = Array.from(gfx.querySelectorAll('text')) as SVGElement[]
  textNodes.forEach((node) => {
    storeSvgStyle(node)
    node.setAttribute(TIME_CONFORMANCE_SCOPE_ATTR, scope)
    node.setAttribute('fill', 'black')
    node.style.fill = 'black'
  })

  if (scope === 'selected') {
    addSelectedActivityViewportBackground({
      container,
      element,
      gfx,
      elementId,
      fill: color
    })
    raiseBpmnElementGraphics(gfx)
  }
}

const raiseExistingActivityElement = (
  elementRegistry: any,
  elementId: string | undefined
) => {
  if (!elementId) return

  const element = elementRegistry.get(elementId)
  const gfx = element ? elementRegistry.getGraphics(element) : null
  const elementType = element?.businessObject?.$type || element?.type || ''

  if (!gfx || !isActivityType(elementType)) return

  const existingBackground = gfx.querySelector(bpmnAugmentationSelector('activity-background'))
  existingBackground?.parentNode?.insertBefore(existingBackground, gfx.firstChild)

  const textNodes = Array.from(gfx.querySelectorAll('text')) as SVGElement[]
  textNodes.forEach((node) => {
    node.parentNode?.appendChild(node)
  })

  raiseBpmnElementGraphics(gfx)
}

const getCurrentLanguage = () => {
  if (typeof window === 'undefined') return 'en'
  return window.localStorage.getItem('lang') || window.navigator.language || 'en'
}

const isPortugueseLanguage = (language: string) => language.toLowerCase().startsWith('pt')

const formatRealCycleTimeAnnotation = (seconds: number, language = getCurrentLanguage()) => {
  if (!Number.isFinite(seconds)) return 'N/A'

  const days = seconds / 86400
  if (days < 1) {
    const totalSeconds = Math.max(0, Math.round(seconds))
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const remainingSeconds = totalSeconds % 60
    const parts = [
      hours > 0 ? `${hours}h` : null,
      minutes > 0 ? `${minutes}m` : null,
      remainingSeconds > 0 ? `${remainingSeconds}s` : null
    ].filter(Boolean)

    return parts.length > 0 ? parts.join(' ') : '0s'
  }

  const isSingularDay = Math.abs(days - 1) < 0.05
  const unit = isPortugueseLanguage(language)
    ? (isSingularDay ? 'dia' : 'dias')
    : (isSingularDay ? 'day' : 'days')

  return `${days.toFixed(1)} ${unit}`
}

const getLinkedCycleTimeAnnotation = (
  elementRegistry: any,
  targetElementId: string | undefined
) => {
  if (!targetElementId) return null

  const allElements = elementRegistry.getAll?.() || []
  const association = allElements.find((element: any) => {
    const bo = element.businessObject
    if (bo?.$type !== 'bpmn:Association') return false

    const sourceId = bo.sourceRef?.id
    const targetId = bo.targetRef?.id
    if (sourceId !== targetElementId && targetId !== targetElementId) return false

    const otherId = sourceId === targetElementId ? targetId : sourceId
    const otherElement = elementRegistry.get(otherId)
    return otherElement?.businessObject?.$type === 'bpmn:TextAnnotation'
  })

  if (!association) return null

  const bo = association.businessObject
  const annotationId = bo.sourceRef?.id === targetElementId
    ? bo.targetRef?.id
    : bo.sourceRef?.id

  if (!annotationId) return null

  const annotationElement = elementRegistry.get(annotationId)
  if (!annotationElement) return null

  return {
    id: annotationId,
    gfx: elementRegistry.getGraphics(annotationElement)
  }
}

const appendRealCycleTimeToCycleTimeAnnotation = (
  elementRegistry: any,
  targetElementId: string | undefined,
  conformance: TimeConformanceData | undefined,
  scope: 'inline' | 'selected'
) => {
  if (!conformance) return

  const annotation = getLinkedCycleTimeAnnotation(elementRegistry, targetElementId)
  const text = annotation?.gfx?.querySelector('text') as SVGTextElement | null
  if (!text) return

  storeSvgStyle(text)
  text.setAttribute(TIME_CONFORMANCE_SCOPE_ATTR, scope)

  const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan')
  tspan.setAttribute('font-weight', '700')
  tspan.style.fontWeight = '700'
  tspan.textContent = ` RCT = ${formatRealCycleTimeAnnotation(conformance.observedTime)}`

  text.appendChild(tspan)
}

export const applyTimeConformanceStyle = ({
  elementRegistry,
  container,
  labelFlowId,
  pathElementIds,
  sourceElementId,
  targetElementId,
  labelGroup,
  conformance,
  selectedActivityMode = 'overlay',
  paintSelectedSourceActivity = false,
  scope
}: {
  elementRegistry: any
  container: HTMLDivElement | null
  labelFlowId?: string
  pathElementIds?: string[]
  sourceElementId?: string
  targetElementId?: string
  labelGroup?: Element | null
  conformance?: TimeConformanceData
  selectedActivityMode?: 'overlay' | 'raise-existing'
  paintSelectedSourceActivity?: boolean
  scope: 'inline' | 'selected'
}) => {
  
  if (scope === 'selected') {
    clearTimeConformanceStyles(container, 'selected')
  }

  if (!conformance) {
    if (scope === 'selected') {
      if (selectedActivityMode === 'raise-existing') {
        if (paintSelectedSourceActivity && sourceElementId !== targetElementId) {
          raiseExistingActivityElement(elementRegistry, sourceElementId)
        }
        raiseExistingActivityElement(elementRegistry, targetElementId)
      } else {
        if (paintSelectedSourceActivity && sourceElementId !== targetElementId) {
          styleActivityElement(elementRegistry, container, sourceElementId, 'rgb(255, 255, 255)', scope)
        }
        styleActivityElement(elementRegistry, container, targetElementId, 'rgb(255, 255, 255)', scope)
      }
    }
    return
  }

  if (pathElementIds?.length) {
    pathElementIds.forEach((elementId) => {
      const element = elementRegistry.get(elementId)
      const elementType = element?.businessObject?.$type || element?.type || ''

      if (elementType === 'bpmn:SequenceFlow') {
        styleFlowStroke(elementRegistry, elementId, conformance.color, scope)
      } else if (isGatewayType(elementType)) {
        styleGatewayOutline(elementRegistry, elementId, conformance.color, scope)
      } else {
        styleDeviationArrowElement(container, elementId, conformance.color, scope)
      }
    })
  } else {
    styleFlowStroke(elementRegistry, labelFlowId, conformance.color, scope)
  }

  if (scope === 'selected' && paintSelectedSourceActivity && sourceElementId !== targetElementId) {
    if (selectedActivityMode === 'raise-existing') {
      raiseExistingActivityElement(elementRegistry, sourceElementId)
    } else {
      styleActivityElement(elementRegistry, container, sourceElementId, 'rgb(255, 255, 255)', scope)
    }
  }

  if (selectedActivityMode === 'raise-existing' && scope === 'selected') {
    raiseExistingActivityElement(elementRegistry, targetElementId)
  } else {
    styleActivityElement(elementRegistry, container, targetElementId, conformance.color, scope)
  }
  styleLabelOutline(labelGroup || null, conformance.color, scope)
  appendRealCycleTimeToCycleTimeAnnotation(elementRegistry, targetElementId, conformance, scope)
}

export const buildModelPerformanceLabelData = ({
  activityPaths,
  modelFlows,
  modelActivities,
  timeConformance,
  elementRegistry
}: {
  activityPaths: Record<string, Record<string, string[]>>
  modelFlows: PerformanceFlowMetric[]
  modelActivities: PerformanceActivityMetric
  timeConformance: TimeConformanceFlowMetrics
  elementRegistry: any
}): ModelPerformanceLabelData => {
  const modelFlowAverageByPair = new Map<string, number>()
  modelFlows.forEach((flow) => {
    modelFlowAverageByPair.set(`${flow.from}::${flow.to}`, (flow as any).selected_sojourn ?? flow.avg_sojourn)
  })

  const timeConformanceByPair = buildTimeConformanceByPair(timeConformance)
  const elementSojourns: Record<string, ElementAverageData> = {}
  const inlineLabelAverages: Record<string, number> = {}
  const inlineLabelConformance: Record<string, TimeConformanceData | undefined> = {}
  const naFallbackFlowIds = new Set<string>()

  const sourcesByFinalFlow = new Map<string, Set<string>>()
  Object.entries(activityPaths).forEach(([fromActivityKey, targets]) => {
    Object.values(targets).forEach((path) => {
      const labelFlowId = getLastFlowIntoTarget(path, elementRegistry)
      if (!labelFlowId) return

      if (!sourcesByFinalFlow.has(labelFlowId)) {
        sourcesByFinalFlow.set(labelFlowId, new Set())
      }

      sourcesByFinalFlow.get(labelFlowId)?.add(fromActivityKey)
    })
  })

  const addPathAverageToElements = (
    path: string[],
    pathKey: string,
    flowAverage: number,
    pathMetadata: Omit<PathPerformanceData, 'elements' | 'average' | 'selected_sojourn'>,
    options: { skipElementId?: string } = {}
  ) => {
    path.forEach(elementId => {
      if (elementId === options.skipElementId) return

      if (!elementSojourns[elementId]) {
        elementSojourns[elementId] = { paths: {} }
      }

      if (!elementSojourns[elementId].paths[pathKey]) {
        elementSojourns[elementId].paths[pathKey] = {
          elements: [...path],
          average: flowAverage,
          selected_sojourn: flowAverage,
          ...pathMetadata
        }
      } else {
        elementSojourns[elementId].paths[pathKey].average += flowAverage
        elementSojourns[elementId].paths[pathKey].selected_sojourn += flowAverage
      }
    })
  }

  Object.entries(activityPaths).forEach(([fromActivityKey, targets]) => {
    Object.entries(targets).forEach(([toActivityKey, path]) => {
      const fromActivityName = fromActivityKey === '<<start>>'
        ? 'Start Event'
        : (modelActivities[fromActivityKey]?.originalActivity || fromActivityKey)
      const toActivityName = toActivityKey === '<<end>>'
        ? 'End Event'
        : (modelActivities[toActivityKey]?.originalActivity || toActivityKey)
      const pathKey = `${fromActivityName} \u279C ${toActivityName}`
      const flowAverage = modelFlowAverageByPair.get(`${fromActivityKey}::${toActivityKey}`)
      const labelFlowId = getLastFlowIntoTarget(path, elementRegistry)
      const finalFlowHasMultipleSources = (sourcesByFinalFlow.get(labelFlowId)?.size || 0) > 1
      const flowTarget = labelFlowId ? getFlowTarget(labelFlowId, elementRegistry) : null
      const conformance = timeConformanceByPair.get(`${fromActivityKey}::${toActivityKey}`)
      const pathMetadata = {
        labelFlowId,
        targetElementId: flowTarget?.id,
        targetType: flowTarget?.type,
        conformance
      }

      if (flowAverage === undefined) return

      if (finalFlowHasMultipleSources) {
        addPathAverageToElements(path, pathKey, flowAverage, pathMetadata)
      } else {
        if (labelFlowId) {
          inlineLabelAverages[labelFlowId] = flowAverage
          inlineLabelConformance[labelFlowId] = conformance
        }
        addPathAverageToElements(path, pathKey, flowAverage, pathMetadata, { skipElementId: labelFlowId })
      }
    })
  })

  const incomingObservedByActivity = new Set<string>()
  const outgoingObservedByActivity = new Set<string>()

  modelFlows.forEach((flow) => {
    incomingObservedByActivity.add(flow.to)
    outgoingObservedByActivity.add(flow.from)
  })

  Object.entries(activityPaths).forEach(([sourceActivity, targets]) => {
    if (!incomingObservedByActivity.has(sourceActivity) || outgoingObservedByActivity.has(sourceActivity)) {
      return
    }

    Object.entries(targets).forEach(([targetActivity, path]) => {
      const firstFlowId = path[0]
      if (!firstFlowId) return

      naFallbackFlowIds.add(firstFlowId)

      if (!elementSojourns[firstFlowId]) {
        elementSojourns[firstFlowId] = { paths: {} }
      }

      const fromActivityName = sourceActivity === '<<start>>'
        ? 'Start Event'
        : (modelActivities[sourceActivity]?.originalActivity || sourceActivity)

      const toActivityName = targetActivity === '<<end>>'
        ? 'End Event'
        : (modelActivities[targetActivity]?.originalActivity || targetActivity)

      const pathKey = `${fromActivityName} \u279C ${toActivityName} (N/A)`

      if (!elementSojourns[firstFlowId].paths[pathKey]) {
        elementSojourns[firstFlowId].paths[pathKey] = {
          elements: [firstFlowId],
          average: Number.NaN,
          selected_sojourn: Number.NaN
        }
      }
    })
  })

  return {
    elementSojourns,
    inlineLabelAverages,
    inlineLabelConformance,
    naFallbackFlowIds
  }
}

export const installModelPerformanceInteractions = ({
  viewer,
  container,
  activityPaths,
  modelFlows,
  modelActivities,
  timeConformance,
  isDragging,
  onClickedElement
}: {
  viewer: any
  container: HTMLDivElement | null
  activityPaths: Record<string, Record<string, string[]>>
  modelFlows: PerformanceFlowMetric[]
  modelActivities: PerformanceActivityMetric
  timeConformance: TimeConformanceFlowMetrics
  isDragging: boolean | (() => boolean)
  onClickedElement: (element: ModelPerformanceClickedElement) => void
}) => {
  const elementRegistry = viewer?.get('elementRegistry') as any
  const svg = container?.querySelector('svg')
  if (!elementRegistry || !svg) return

  clearTimeConformanceStyles(container)
  svg.querySelectorAll(`${bpmnAugmentationSelector('flow-label')}, ${bpmnAugmentationSelector('flow-hover-target')}`).forEach(node => node.remove())

  const modelFlowAverageByPair = new Map<string, number>()
  modelFlows.forEach((flow) => {
    modelFlowAverageByPair.set(`${flow.from}::${flow.to}`, (flow as any).selected_sojourn ?? flow.avg_sojourn)
  })
  const timeConformanceByPair = buildTimeConformanceByPair(timeConformance)

  const elementSojourns: Record<string, ElementAverageData> = {}
  const inlineLabelAverages: Record<string, number> = {}
  const inlineLabelConformance: Record<string, TimeConformanceData | undefined> = {}

  const sourcesByFinalFlow = new Map<string, Set<string>>()
  Object.entries(activityPaths).forEach(([fromActivityKey, targets]) => {
    Object.values(targets).forEach((path) => {
      const labelFlowId = getLastFlowIntoTarget(path, elementRegistry)
      if (!labelFlowId) return

      if (!sourcesByFinalFlow.has(labelFlowId)) {
        sourcesByFinalFlow.set(labelFlowId, new Set())
      }

      sourcesByFinalFlow.get(labelFlowId)?.add(fromActivityKey)
    })
  })

  const addPathAverageToElements = (
    path: string[],
    pathKey: string,
    flowAverage: number,
    pathMetadata: Omit<PathPerformanceData, 'elements' | 'average' | 'selected_sojourn'>,
    options: { skipElementId?: string } = {}
  ) => {
    path.forEach(elementId => {
      if (elementId === options.skipElementId) return

      if (!elementSojourns[elementId]) {
        elementSojourns[elementId] = { paths: {} }
      }

      if (!elementSojourns[elementId].paths[pathKey]) {
        elementSojourns[elementId].paths[pathKey] = {
          elements: [...path],
          average: flowAverage,
          selected_sojourn: flowAverage,
          ...pathMetadata
        }
      } else {
        elementSojourns[elementId].paths[pathKey].average += flowAverage
        elementSojourns[elementId].paths[pathKey].selected_sojourn += flowAverage
      }
    })
  }

  Object.entries(activityPaths).forEach(([fromActivityKey, targets]) => {
    Object.entries(targets).forEach(([toActivityKey, path]) => {
      const fromActivityName = fromActivityKey === '<<start>>'
        ? 'Start Event'
        : (modelActivities[fromActivityKey]?.originalActivity || fromActivityKey)
      const toActivityName = toActivityKey === '<<end>>'
        ? 'End Event'
        : (modelActivities[toActivityKey]?.originalActivity || toActivityKey)
      const pathKey = `${fromActivityName} \u279C ${toActivityName}`
      const flowAverage = modelFlowAverageByPair.get(`${fromActivityKey}::${toActivityKey}`)
      const labelFlowId = getLastFlowIntoTarget(path, elementRegistry)
      const finalFlowHasMultipleSources = (sourcesByFinalFlow.get(labelFlowId)?.size || 0) > 1
      const flowTarget = labelFlowId ? getFlowTarget(labelFlowId, elementRegistry) : null
      const conformance = timeConformanceByPair.get(`${fromActivityKey}::${toActivityKey}`)
      const pathMetadata = {
        labelFlowId,
        targetElementId: flowTarget?.id,
        targetType: flowTarget?.type,
        conformance
      }

      if (flowAverage === undefined) return

      if (finalFlowHasMultipleSources) {
        addPathAverageToElements(path, pathKey, flowAverage, pathMetadata)
      } else {
        if (labelFlowId) {
          inlineLabelAverages[labelFlowId] = flowAverage
          inlineLabelConformance[labelFlowId] = conformance
        }
        addPathAverageToElements(path, pathKey, flowAverage, pathMetadata, { skipElementId: labelFlowId })
      }
    })
  })

  const clickableElements = elementRegistry.filter((element: any) => {
    if (!element?.type) return false
    return element.type === 'bpmn:SequenceFlow' || element.type.toLowerCase().includes('gateway')
  })

  const directFlowElements: Array<{
    element: any
    elementData?: ElementAverageData
    inlineAverage?: number
    inlineConformance?: TimeConformanceData
  }> = []

  const isDirectFlowForInlineLabel = (element: any) => {
    if (element?.type !== 'bpmn:SequenceFlow') return false
    const sourceType = element?.businessObject?.sourceRef?.$type
    const targetType = element?.businessObject?.targetRef?.$type
    return (
      isActivityType(sourceType) && isActivityType(targetType) ||
      isStartEventType(sourceType) && isActivityType(targetType) ||
      isActivityType(sourceType) && isEndEventType(targetType)
    )
  }

  clickableElements.forEach((element: any) => {
    const elementId = element.id
    const elementData = elementSojourns[elementId]
    const inlineAverage = inlineLabelAverages[elementId]
      const inlineConformance = inlineLabelConformance[elementId]
      const hasInlineLabelAverage = inlineAverage !== undefined
      const isDirectFlow = isDirectFlowForInlineLabel(element)
      const hasPathData = !!elementData?.paths && Object.keys(elementData.paths).length > 0
      const gfx = elementRegistry.getGraphics(element)
      if (!gfx) return

    gfx.style.pointerEvents = 'auto'
    gfx.style.cursor = 'auto'
    gfx.onclick = null
    gfx.onmouseenter = null
    gfx.onmouseleave = null
    gfx.onmousedown = null
    gfx.onmousemove = null

    if (hasInlineLabelAverage || isDirectFlow && !hasPathData) {
      directFlowElements.push({ element, elementData, inlineAverage, inlineConformance })
      return
    }

    if (!hasPathData) {
      return
    }

    const elementAverage = Object.values(elementData.paths).reduce((sum, pathData) => {
      const selectedValue = Number.isFinite(pathData.selected_sojourn)
        ? pathData.selected_sojourn
        : pathData.average

      return sum + (Number.isFinite(selectedValue) ? selectedValue : 0)
    }, 0)
    const isSequenceFlow = element.type === 'bpmn:SequenceFlow'
    const FLOW_HOVER_STROKE_MULTIPLIER = 1.8
    const GATEWAY_HOVER_STROKE_MULTIPLIER = 2
    const flowStrokeNodes = Array.from(gfx.querySelectorAll('path, polyline, line')) as SVGElement[]
    const gatewayStrokeNodes = Array.from(gfx.querySelectorAll('polygon, path, rect, circle, ellipse, line, polyline')) as SVGElement[]
    const originalStrokeWidths = new Map<SVGElement, string>()
    const strokeNodes = isSequenceFlow ? flowStrokeNodes : gatewayStrokeNodes

    strokeNodes.forEach((node) => {
      const originalWidth = node.style.strokeWidth || node.getAttribute('stroke-width') || '1px'
      originalStrokeWidths.set(node, originalWidth)
      node.style.transition = 'stroke-width 120ms ease-out'
    })

    const restoreHoverStrokeWidths = () => {
      strokeNodes.forEach((node) => {
        const originalWidth = originalStrokeWidths.get(node) || '1'
        const numericWidth = Number.parseFloat(originalWidth)
        const baseWidth = Number.isFinite(numericWidth) && numericWidth > 0 ? numericWidth : 1
        node.style.strokeWidth = `${baseWidth}px`
      })
    }

    gfx.style.cursor = 'pointer'
    gfx.onmouseenter = () => {
      gfx.style.cursor = 'pointer'

      const isHighlighted = gfx.getAttribute('data-is-highlighted') === 'true'
      if (isSequenceFlow && !isHighlighted) {
        gfx.style.opacity = '1'
      }

      const multiplier = isSequenceFlow ? FLOW_HOVER_STROKE_MULTIPLIER : GATEWAY_HOVER_STROKE_MULTIPLIER
      strokeNodes.forEach((node) => {
        const rawWidth = node.style.strokeWidth || node.getAttribute('stroke-width') || '1'
        const numericWidth = Number.parseFloat(rawWidth)
        const baseWidth = Number.isFinite(numericWidth) && numericWidth > 0 ? numericWidth : 1
        node.style.strokeWidth = `${Math.max(2, baseWidth * multiplier)}px`
      })
    }
    gfx.onmouseleave = () => {
      gfx.style.cursor = 'auto'

      const isHighlighted = gfx.getAttribute('data-is-highlighted') === 'true'
      const hasFlowFocus = svg.getAttribute('data-has-flow-focus') === 'true'

      if (isSequenceFlow) {
        gfx.style.opacity = hasFlowFocus
          ? (isHighlighted ? '1' : '0.5')
          : '1'
      }

      restoreHoverStrokeWidths()
    }
    gfx.onclick = (event: MouseEvent) => {
      const isCurrentlyDragging = typeof isDragging === 'function' ? isDragging() : isDragging
      if (isCurrentlyDragging) return
      event.stopPropagation()
      restoreHoverStrokeWidths()

      const sortedPathKeysByAverage = Object.entries(elementData.paths)
        .sort(([, pathA], [, pathB]) => pathB.selected_sojourn - pathA.selected_sojourn)
        .map(([pathKey]) => pathKey)
      const defaultPathKey = sortedPathKeysByAverage[0]

      onClickedElement({
        elementId,
        avg_sojourn: elementAverage,
        paths: elementData.paths,
        checkedPaths: Object.keys(elementData.paths).reduce<Record<string, boolean>>((acc, pathKey) => {
          acc[pathKey] = pathKey === defaultPathKey
          return acc
        }, {})
      })
    }
  })

  const viewport = svg.querySelector('g.viewport') || svg.querySelector('g')
  if (!viewport) return

  const labelsAtPosition = new Map<string, number>()

  directFlowElements.forEach(({ element, elementData, inlineAverage, inlineConformance }) => {
    const waypoints = element?.waypoints
    if (!waypoints || waypoints.length < 2) return

    const topPathAverage = elementData?.paths
      ? Object.values(elementData.paths).sort((a, b) => b.selected_sojourn - a.selected_sojourn)[0]?.selected_sojourn
      : inlineAverage
    const averageLabel = Number.isFinite(topPathAverage) ? formatSecondsHuman(topPathAverage as number) : 'N/A'

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

    const midX = (longestSegmentStart.x + longestSegmentEnd.x) / 2
    const midY = (longestSegmentStart.y + longestSegmentEnd.y) / 2
    const positionKey = `${Math.round(midX)},${Math.round(midY)}`
    const labelsInPosition = labelsAtPosition.get(positionKey) || 0
    labelsAtPosition.set(positionKey, labelsInPosition + 1)
    const labelY = midY + (labelsInPosition * 18)

    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    setBpmnAugmentationAttributes(group, 'flow-label', {
      view: 'performance',
      labelMode: 'direct',
      elementId: element.id
    })

    const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    const bgWidth = averageLabel.length * 7
    const bgHeight = 16
    bgRect.setAttribute('x', (midX - bgWidth / 2).toString())
    bgRect.setAttribute('y', (labelY - bgHeight / 2).toString())
    bgRect.setAttribute('width', bgWidth.toString())
    bgRect.setAttribute('height', bgHeight.toString())
    bgRect.setAttribute('rx', '2')
    bgRect.setAttribute('ry', '2')
    bgRect.setAttribute('fill', 'white')
    bgRect.setAttribute('stroke', 'black')
    bgRect.setAttribute('stroke-width', '1.5')
    bgRect.style.pointerEvents = 'none'

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    text.setAttribute('x', midX.toString())
    text.setAttribute('y', labelY.toString())
    text.setAttribute('text-anchor', 'middle')
    text.setAttribute('dominant-baseline', 'middle')
    text.setAttribute('fill', 'black')
    text.setAttribute('font-size', '12')
    text.setAttribute('font-weight', 'bold')
    text.setAttribute('font-family', 'Arial, sans-serif')
    text.textContent = averageLabel
    text.style.pointerEvents = 'none'

    group.appendChild(bgRect)
    group.appendChild(text)
    group.style.pointerEvents = 'none'
    viewport.appendChild(group)

    const flowTarget = getFlowTarget(element.id, elementRegistry)
    applyTimeConformanceStyle({
      elementRegistry,
      container,
      labelFlowId: element.id,
      targetElementId: flowTarget?.id,
      labelGroup: group,
      conformance: inlineConformance,
      scope: 'inline'
    })
  })
}

export const installActivityPerformanceInteractions = ({
  viewer,
  container,
  activityPaths,
  flows,
  activities,
  timeConformance,
  isDragging,
  onClickedElement
}: {
  viewer: any
  container: HTMLDivElement | null
  activityPaths: Record<string, Record<string, string[]>>
  flows: PerformanceFlowMetric[]
  activities: PerformanceActivityMetric
  timeConformance: TimeConformanceFlowMetrics
  isDragging: boolean | (() => boolean)
  onClickedElement: (element: ModelPerformanceClickedElement) => void
}) => {
  const elementRegistry = viewer?.get('elementRegistry') as any
  const svg = container?.querySelector('svg')
  if (!elementRegistry || !svg) return

  clearTimeConformanceStyles(container)
  svg.querySelectorAll(`${bpmnAugmentationSelector('flow-label')}, ${bpmnAugmentationSelector('flow-hover-target')}`).forEach(node => node.remove())

  const modelFlowAverageByPair = new Map<string, number>()
  flows.forEach((flow) => {
    modelFlowAverageByPair.set(`${flow.from}::${flow.to}`, (flow as any).selected_sojourn ?? flow.avg_sojourn)
  })

  const timeConformanceByPair = buildTimeConformanceByPair(timeConformance)
  const elementSojourns: Record<string, ElementAverageData> = {}
  const inlineLabelAverages: Record<string, number> = {}
  const inlineLabelConformance: Record<string, TimeConformanceData | undefined> = {}

  const getActivityElementByKey = (activityKey: string) => {
    if (activityKey === '<<end>>') return null

    const normalizedActivityKey = activityKey === ''
      ? 'no-label'
      : normalizePerformanceKey(activityKey)
    const activityElements = elementRegistry.filter((element: any) => {
      const elementType = element?.businessObject?.$type || element?.type || ''
      return isActivityType(elementType)
    })

    return activityElements.find((element: any) => {
      const rawName = element?.businessObject?.name || ''
      if (!rawName) return false

      return normalizeActivityName(stripBpmnSuffix(rawName)) === normalizedActivityKey
    }) || null
  }

  const getPathLabelElementId = (path: string[]) => {
    const registryFlowId = getLastFlowIntoTarget(path, elementRegistry)
    if (registryFlowId && elementRegistry.get(registryFlowId)) return registryFlowId

    return [...path].reverse().find((elementId) => {
      return !!svg.querySelector(bpmnAugmentationSelector('deviation-arrow', { id: elementId }))
    }) || registryFlowId
  }

  const getPathTarget = (labelElementId: string | undefined, toActivityKey: string) => {
    if (labelElementId) {
      const flowTarget = getFlowTarget(labelElementId, elementRegistry)
      if (flowTarget) return flowTarget
    }

    const targetActivity = getActivityElementByKey(toActivityKey)
    if (targetActivity) {
      return {
        id: targetActivity.id,
        type: targetActivity.businessObject?.$type || targetActivity.type
      }
    }

    return null
  }

  const targetSourceCounts = new Map<string, Set<string>>()
  Object.entries(activityPaths).forEach(([fromActivityKey, targets]) => {
    Object.keys(targets).forEach((toActivityKey) => {
      if (!targetSourceCounts.has(toActivityKey)) {
        targetSourceCounts.set(toActivityKey, new Set())
      }

      targetSourceCounts.get(toActivityKey)?.add(fromActivityKey)
    })
  })

  const addPathDataToActivity = (
    targetElementId: string | undefined,
    path: string[],
    pathKey: string,
    flowAverage: number,
    pathMetadata: Omit<PathPerformanceData, 'elements' | 'average' | 'selected_sojourn'>
  ) => {
    if (!targetElementId) return

    if (!elementSojourns[targetElementId]) {
      elementSojourns[targetElementId] = { paths: {} }
    }

    if (!elementSojourns[targetElementId].paths[pathKey]) {
      elementSojourns[targetElementId].paths[pathKey] = {
        elements: [...path],
        average: flowAverage,
        selected_sojourn: flowAverage,
        ...pathMetadata
      }
    } else {
      elementSojourns[targetElementId].paths[pathKey].average += flowAverage
      elementSojourns[targetElementId].paths[pathKey].selected_sojourn += flowAverage
    }
  }

  Object.entries(activityPaths).forEach(([fromActivityKey, targets]) => {
    Object.entries(targets).forEach(([toActivityKey, path]) => {
      const flowAverage = modelFlowAverageByPair.get(`${fromActivityKey}::${toActivityKey}`)
      if (flowAverage === undefined) return

      const getActivityDisplayName = (activityKey: string) => {
        if (activityKey === '<<start>>') return 'Start Event'
        if (activityKey === '<<end>>') return 'End Event'

        const originalActivity = activities[activityKey]?.originalActivity
        if (originalActivity === '') return 'No Label'

        return originalActivity || activityKey || 'No Label'
      }
      const fromActivityName = fromActivityKey === '<<start>>'
        ? 'Start Event'
        : getActivityDisplayName(fromActivityKey)
      const toActivityName = toActivityKey === '<<end>>'
        ? 'End Event'
        : getActivityDisplayName(toActivityKey)
      const pathKey = `${fromActivityName} \u279C ${toActivityName}`
      const labelFlowId = getPathLabelElementId(path)
      const sourceActivity = getActivityElementByKey(fromActivityKey)
      const flowTarget = getPathTarget(labelFlowId, toActivityKey)
      const conformance = timeConformanceByPair.get(`${fromActivityKey}::${toActivityKey}`)

      const targetElementId = flowTarget?.id
      const targetHasMultipleSources = (targetSourceCounts.get(toActivityKey)?.size || 0) > 1
      const pathMetadata = {
        labelFlowId,
        sourceElementId: sourceActivity?.id,
        targetElementId,
        targetType: flowTarget?.type,
        conformance
      }

      if (targetHasMultipleSources) {
        addPathDataToActivity(targetElementId, path, pathKey, flowAverage, pathMetadata)
        return
      }

      if (labelFlowId) {
        inlineLabelAverages[labelFlowId] = flowAverage
        inlineLabelConformance[labelFlowId] = conformance
      }
    })
  })

  const clickableActivities = elementRegistry.filter((element: any) => {
    const elementType = element?.businessObject?.$type || element?.type || ''
    return isActivityType(elementType) && !!elementSojourns[element.id]?.paths
  })

  clickableActivities.forEach((element: any) => {
    const elementData = elementSojourns[element.id]
    const gfx = elementRegistry.getGraphics(element)
    if (!gfx || !elementData?.paths || Object.keys(elementData.paths).length === 0) return

    const strokeNodes = Array.from(gfx.querySelectorAll('rect, path, circle, ellipse, polygon')) as SVGElement[]
    const originalStrokeWidths = new Map<SVGElement, string>()

    strokeNodes.forEach((node) => {
      const originalWidth = node.style.strokeWidth || node.getAttribute('stroke-width') || '1px'
      originalStrokeWidths.set(node, originalWidth)
      node.style.transition = 'stroke-width 120ms ease-out'
    })

    const restoreHoverStrokeWidths = () => {
      strokeNodes.forEach((node) => {
        const originalWidth = originalStrokeWidths.get(node) || '1'
        const numericWidth = Number.parseFloat(originalWidth)
        const baseWidth = Number.isFinite(numericWidth) && numericWidth > 0 ? numericWidth : 1
        node.style.strokeWidth = `${baseWidth}px`
      })
    }

    gfx.style.pointerEvents = 'auto'
    gfx.style.cursor = 'pointer'
    gfx.onclick = null
    gfx.onmouseenter = null
    gfx.onmouseleave = null
    gfx.onmousedown = null
    gfx.onmousemove = null

    gfx.onmouseenter = () => {
      gfx.style.cursor = 'pointer'
      strokeNodes.forEach((node) => {
        const rawWidth = node.style.strokeWidth || node.getAttribute('stroke-width') || '1'
        const numericWidth = Number.parseFloat(rawWidth)
        const baseWidth = Number.isFinite(numericWidth) && numericWidth > 0 ? numericWidth : 1
        node.style.strokeWidth = `${Math.max(2, baseWidth * 1.8)}px`
      })
    }

    gfx.onmouseleave = () => {
      gfx.style.cursor = 'auto'
      restoreHoverStrokeWidths()
    }

    gfx.onclick = (event: MouseEvent) => {
      const isCurrentlyDragging = typeof isDragging === 'function' ? isDragging() : isDragging
      if (isCurrentlyDragging) return

      event.stopPropagation()
      restoreHoverStrokeWidths()

      const sortedPathKeysByAverage = Object.entries(elementData.paths)
        .sort(([, pathA], [, pathB]) => pathB.selected_sojourn - pathA.selected_sojourn)
        .map(([pathKey]) => pathKey)
      const defaultPathKey = sortedPathKeysByAverage[0]
      const elementAverage = Object.values(elementData.paths).reduce((sum, pathData) => {
        const selectedValue = Number.isFinite(pathData.selected_sojourn)
          ? pathData.selected_sojourn
          : pathData.average

        return sum + (Number.isFinite(selectedValue) ? selectedValue : 0)
      }, 0)

      onClickedElement({
        elementId: element.id,
        avg_sojourn: elementAverage,
        paths: elementData.paths,
        checkedPaths: Object.keys(elementData.paths).reduce<Record<string, boolean>>((acc, pathKey) => {
          acc[pathKey] = pathKey === defaultPathKey
          return acc
        }, {})
      })
    }
  })

  const viewport = svg.querySelector('g.viewport') || svg.querySelector('g')
  if (!viewport) return

  const labelsAtPosition = new Map<string, number>()
  Object.entries(inlineLabelAverages).forEach(([flowId, inlineAverage]) => {
    const element = elementRegistry.get(flowId)
    if (!element?.waypoints || element.waypoints.length < 2) return

    const waypoints = element.waypoints
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

    const midX = (longestSegmentStart.x + longestSegmentEnd.x) / 2
    const midY = (longestSegmentStart.y + longestSegmentEnd.y) / 2
    const positionKey = `${Math.round(midX)},${Math.round(midY)}`
    const labelsInPosition = labelsAtPosition.get(positionKey) || 0
    labelsAtPosition.set(positionKey, labelsInPosition + 1)
    const labelY = midY + (labelsInPosition * 18)
    const averageLabel = Number.isFinite(inlineAverage) ? formatSecondsHuman(inlineAverage) : 'N/A'

    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    setBpmnAugmentationAttributes(group, 'flow-label', {
      view: 'performance',
      labelMode: 'direct',
      elementId: flowId
    })

    const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    const bgWidth = averageLabel.length * 7
    const bgHeight = 16
    bgRect.setAttribute('x', (midX - bgWidth / 2).toString())
    bgRect.setAttribute('y', (labelY - bgHeight / 2).toString())
    bgRect.setAttribute('width', bgWidth.toString())
    bgRect.setAttribute('height', bgHeight.toString())
    bgRect.setAttribute('rx', '2')
    bgRect.setAttribute('ry', '2')
    bgRect.setAttribute('fill', 'white')
    bgRect.setAttribute('stroke', 'black')
    bgRect.setAttribute('stroke-width', '1.5')
    bgRect.style.pointerEvents = 'none'

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    text.setAttribute('x', midX.toString())
    text.setAttribute('y', labelY.toString())
    text.setAttribute('text-anchor', 'middle')
    text.setAttribute('dominant-baseline', 'middle')
    text.setAttribute('fill', 'black')
    text.setAttribute('font-size', '12')
    text.setAttribute('font-weight', 'bold')
    text.setAttribute('font-family', 'Arial, sans-serif')
    text.textContent = averageLabel
    text.style.pointerEvents = 'none'

    group.appendChild(bgRect)
    group.appendChild(text)
    group.style.pointerEvents = 'none'
    viewport.appendChild(group)

    const flowTarget = getFlowTarget(flowId, elementRegistry)
    applyTimeConformanceStyle({
      elementRegistry,
      container,
      labelFlowId: flowId,
      targetElementId: flowTarget?.id,
      labelGroup: group,
      conformance: inlineLabelConformance[flowId],
      scope: 'inline'
    })
  })

  return {
    elementSojourns,
    inlineLabelAverages,
    inlineLabelConformance,
    naFallbackFlowIds: new Set<string>()
  }
}

export const applyModelPerformanceFocusOpacity = ({
  viewer,
  container,
  clickedElement
}: {
  viewer: any
  container: HTMLDivElement | null
  clickedElement: ModelPerformanceClickedElement
}) => {
  const elementRegistry = viewer?.get('elementRegistry') as any
  const svg = container?.querySelector('svg')
  if (!elementRegistry) return

  const highlightedElementIds = clickedElement ? new Set<string>() : null
  const getActivityElementIdByKey = (activityKey: string | null) => {
    if (activityKey === null || activityKey.startsWith('<<end>>')) return undefined

    const normalizedActivityKey = activityKey === ''
      ? 'no-label'
      : normalizePerformanceKey(activityKey)
    const activityElements = elementRegistry.filter((element: any) => {
      const elementType = element?.businessObject?.$type || element?.type || ''
      return isActivityType(elementType)
    })
    const activityElement = activityElements.find((element: any) => {
      const rawName = element?.businessObject?.name || ''
      if (!rawName) return false

      return normalizeActivityName(stripBpmnSuffix(rawName)) === normalizedActivityKey
    })

    return activityElement?.id
  }

  if (clickedElement && highlightedElementIds) {
    highlightedElementIds.add(clickedElement.elementId)

    if (clickedElement.paths) {
      Object.entries(clickedElement.paths).forEach(([pathKey, pathData]) => {
        const isPathChecked = clickedElement.checkedPaths?.[pathKey] ?? true
        if (!isPathChecked) return

        pathData.elements.forEach(elementId => {
          highlightedElementIds.add(elementId)
        })
        if (!pathData.conformance && pathData.sourceElementId) {
          highlightedElementIds.add(pathData.sourceElementId)
        }
        if (pathData.targetElementId) {
          highlightedElementIds.add(pathData.targetElementId)
        }
      })
    }

    svg?.querySelectorAll(bpmnAugmentationSelector('deviation-arrow')).forEach((arrowNode) => {
      const arrowId = arrowNode.getAttribute(BPMN_AUGMENTATION_ATTRS.id) || arrowNode.id
      if (!arrowId || !highlightedElementIds.has(arrowId)) return

      const sourceActivityId = getActivityElementIdByKey(arrowNode.getAttribute(BPMN_AUGMENTATION_ATTRS.from))
      const targetActivityId = getActivityElementIdByKey(arrowNode.getAttribute(BPMN_AUGMENTATION_ATTRS.to))
      if (sourceActivityId) highlightedElementIds.add(sourceActivityId)
      if (targetActivityId) highlightedElementIds.add(targetActivityId)
    })

    Array.from(highlightedElementIds).forEach((elementId) => {
      const element = elementRegistry.get(elementId)
      if (!element) return

      const bo = element.businessObject
      if (bo?.$type === 'bpmn:SequenceFlow') {
        const sourceRefId = bo.sourceRef?.id
        const targetRefId = bo.targetRef?.id
        if (sourceRefId) highlightedElementIds.add(sourceRefId)
        if (targetRefId) highlightedElementIds.add(targetRefId)
      }
    })

    const allElements = elementRegistry.getAll?.() || []
    allElements.forEach((element: any) => {
      const bo = element.businessObject
      if (bo?.$type !== 'bpmn:Association') return

      const sourceId = bo.sourceRef?.id
      const targetId = bo.targetRef?.id
      if (!sourceId || !targetId) return

      const sourceElement = elementRegistry.get(sourceId)
      const targetElement = elementRegistry.get(targetId)
      const sourceType = sourceElement?.businessObject?.$type || sourceElement?.type
      const targetType = targetElement?.businessObject?.$type || targetElement?.type

      if (sourceType === 'bpmn:TextAnnotation' && highlightedElementIds.has(targetId)) {
        highlightedElementIds.add(sourceId)
        highlightedElementIds.add(element.id)
      }

      if (targetType === 'bpmn:TextAnnotation' && highlightedElementIds.has(sourceId)) {
        highlightedElementIds.add(targetId)
        highlightedElementIds.add(element.id)
      }
    })
  }

  if (svg) {
    svg.setAttribute('data-has-flow-focus', highlightedElementIds ? 'true' : 'false')
  }

  const shouldManageOpacity = (element: any) => {
    const elementType = element?.businessObject?.$type || element?.type || ''
    if (!elementType) return false

    if (
      elementType === 'bpmn:Lane' ||
      elementType === 'bpmn:Participant' ||
      elementType === 'bpmn:LaneSet'
    ) {
      return false
    }

    return (
      elementType === 'bpmn:SequenceFlow' ||
      elementType.includes('Task') ||
      elementType === 'bpmn:Activity' ||
      elementType === 'bpmn:SubProcess' ||
      elementType.includes('Gateway') ||
      elementType.includes('Event') ||
      elementType === 'bpmn:TextAnnotation' ||
      elementType === 'bpmn:Association'
    )
  }

  const allElements = elementRegistry.getAll?.() || []
  allElements.forEach((element: any) => {
    const elementId = element?.id
    if (!elementId || !shouldManageOpacity(element)) return

    const gfx = elementRegistry.getGraphics(element)
    if (!gfx) return

    const isHighlighted = !highlightedElementIds || highlightedElementIds.has(elementId)
    gfx.style.opacity = isHighlighted ? '1' : '0.5'
    gfx.style.transition = 'opacity 180ms ease-out'
    gfx.setAttribute('data-is-highlighted', isHighlighted ? 'true' : 'false')

    const strokeNodes = Array.from(
      gfx.querySelectorAll('path, polyline, line, rect, circle, ellipse, polygon')
    ) as SVGElement[]

    strokeNodes.forEach((node) => {
      let baseStrokeWidth = node.getAttribute('data-original-stroke-width')

      if (!baseStrokeWidth) {
        const rawStrokeWidth = node.style.strokeWidth || node.getAttribute('stroke-width') || ''
        const numericStrokeWidth = Number.parseFloat(rawStrokeWidth)
        const normalizedWidth = Number.isFinite(numericStrokeWidth) && numericStrokeWidth > 0
          ? numericStrokeWidth
          : 1

        baseStrokeWidth = String(normalizedWidth)
        node.setAttribute('data-original-stroke-width', baseStrokeWidth)
      }

      node.style.strokeWidth = `${Number.parseFloat(baseStrokeWidth)}px`
      node.style.transition = 'stroke-width 180ms ease-out'

      const timeConformanceMarkerEnd = node.getAttribute(TIME_CONFORMANCE_MARKER_ATTR)
      if (timeConformanceMarkerEnd) {
        node.setAttribute('marker-end', timeConformanceMarkerEnd)
        node.style.markerEnd = timeConformanceMarkerEnd
        node.style.setProperty('marker-end', timeConformanceMarkerEnd, 'important')
      }
    })
  })

  svg?.querySelectorAll(bpmnAugmentationSelector('flow-label')).forEach((labelNode) => {
    const flowId = labelNode.getAttribute(BPMN_AUGMENTATION_ATTRS.elementId)
    const isHighlighted = !highlightedElementIds || !!flowId && highlightedElementIds.has(flowId)

    ;(labelNode as SVGElement).style.opacity = isHighlighted ? '1' : '0.5'
    ;(labelNode as SVGElement).style.transition = 'opacity 180ms ease-out'
  })

  svg?.querySelectorAll(bpmnAugmentationSelector('deviation-arrow')).forEach((arrowNode) => {
    const arrowId = arrowNode.getAttribute(BPMN_AUGMENTATION_ATTRS.id) || arrowNode.id
    const isHighlighted = !highlightedElementIds || !!arrowId && highlightedElementIds.has(arrowId)
    const shouldEmphasizeArrow = !!highlightedElementIds && isHighlighted

    ;(arrowNode as SVGElement).style.opacity = isHighlighted ? '1' : '0.5'
    ;(arrowNode as SVGElement).style.transition = 'opacity 180ms ease-out'
    ;(arrowNode as SVGElement).setAttribute('data-is-highlighted', isHighlighted ? 'true' : 'false')

    if (isHighlighted && arrowNode.parentNode) {
      arrowNode.parentNode.appendChild(arrowNode)
    }

    const strokeNodes = Array.from(
      arrowNode.querySelectorAll('path, polyline, line, polygon, rect')
    ) as SVGElement[]

    strokeNodes.forEach((node) => {
      let baseStrokeWidth = node.getAttribute('data-original-stroke-width')

      if (!baseStrokeWidth) {
        const rawStrokeWidth = node.dataset.timeConformanceOriginalStrokeWidthStyle ||
          node.dataset.timeConformanceOriginalStrokeWidth ||
          node.style.strokeWidth ||
          node.getAttribute('stroke-width') ||
          ''
        const numericStrokeWidth = Number.parseFloat(rawStrokeWidth)
        const normalizedWidth = Number.isFinite(numericStrokeWidth) && numericStrokeWidth > 0
          ? numericStrokeWidth
          : 1

        baseStrokeWidth = String(normalizedWidth)
        node.setAttribute('data-original-stroke-width', baseStrokeWidth)
      }

      const baseWidth = Number.parseFloat(baseStrokeWidth)
      node.style.strokeWidth = shouldEmphasizeArrow
        ? `${Math.max(baseWidth * 1.7, 3)}px`
        : `${baseWidth}px`
      node.style.transition = 'stroke-width 180ms ease-out'
    })
  })

  highlightedElementIds?.forEach((elementId) => {
    const element = elementRegistry.get(elementId)
    const elementType = element?.businessObject?.$type || element?.type || ''
    if (!isActivityType(elementType)) return

    const selectedActivityOverlay = svg?.querySelector(
      bpmnAugmentationSelector('time-conformance-background', {
        scope: 'selected',
        elementId
      })
    )
    selectedActivityOverlay?.parentNode?.appendChild(selectedActivityOverlay)
    raiseBpmnElementGraphics(elementRegistry.getGraphics(element))
  })
}

export const drawSelectedModelPerformancePathLabel = ({
  viewer,
  container,
  clickedElement,
  selectedActivityMode = 'overlay',
  paintSelectedSourceActivity = false
}: {
  viewer: any
  container: HTMLDivElement | null
  clickedElement: Exclude<ModelPerformanceClickedElement, null>
  selectedActivityMode?: 'overlay' | 'raise-existing'
  paintSelectedSourceActivity?: boolean
}) => {
  const elementRegistry = viewer?.get('elementRegistry') as any
  const svg = container?.querySelector('svg')
  if (!elementRegistry || !svg || !clickedElement.paths) return

  clearTimeConformanceStyles(container, 'selected')
  svg.querySelectorAll(bpmnAugmentationSelector('flow-label', { labelMode: 'path' })).forEach((node) => node.remove())

  const viewport = svg.querySelector('g.viewport') || svg.querySelector('g')
  if (!viewport) return

  const selectedPathEntry = Object.entries(clickedElement.paths).find(([pathKey]) => {
    return clickedElement.checkedPaths?.[pathKey] ?? true
  }) || [...Object.entries(clickedElement.paths)].sort(([, pathA], [, pathB]) => pathB.selected_sojourn - pathA.selected_sojourn)[0]

  if (!selectedPathEntry) return

  const [pathKey, pathData] = selectedPathEntry
  applyTimeConformanceStyle({
    elementRegistry,
    container,
    pathElementIds: pathData.elements,
    sourceElementId: pathData.sourceElementId,
    targetElementId: pathData.targetElementId,
    conformance: pathData.conformance,
    selectedActivityMode,
    paintSelectedSourceActivity,
    scope: 'selected'
  })

  const flowElementsInPath = pathData.elements.filter((elementId) => {
    const element = elementRegistry.get(elementId)
    return element?.businessObject?.$type === 'bpmn:SequenceFlow'
  })

  const eligibleFlowElementsInPath = flowElementsInPath.filter((flowId) => {
    const { sourceType, targetType } = getFlowEndpoints(flowId, elementRegistry)
    if (isGatewayType(sourceType) && isGatewayType(targetType)) return false
    return isActivityType(targetType) || isEndEventType(targetType) || isActivityType(sourceType)
  })

  const flowHasInlineLabel = (flowId: string) => {
    return !!svg.querySelector(bpmnAugmentationSelector('flow-label', { labelMode: 'direct', elementId: flowId }))
  }

  if (flowElementsInPath.some(flowHasInlineLabel)) {
    return
  }

  const labelFlowId = [...eligibleFlowElementsInPath].reverse().find((flowId) => {
    const { targetType } = getFlowEndpoints(flowId, elementRegistry)
    return isActivityType(targetType)
  }) || eligibleFlowElementsInPath[eligibleFlowElementsInPath.length - 1]

  if (!labelFlowId) {
    return
  }

  const flowElement = elementRegistry.get(labelFlowId)
  if (!flowElement?.waypoints || flowElement.waypoints.length < 2) {
    return
  }

  const waypoints = flowElement.waypoints
  let totalLength = 0
  const segmentLengths: number[] = []

  for (let i = 0; i < waypoints.length - 1; i++) {
    const length = Math.hypot(waypoints[i + 1].x - waypoints[i].x, waypoints[i + 1].y - waypoints[i].y)
    segmentLengths.push(length)
    totalLength += length
  }

  let labelX = (waypoints[0].x + waypoints[waypoints.length - 1].x) / 2
  let labelY = (waypoints[0].y + waypoints[waypoints.length - 1].y) / 2

  if (totalLength > 0) {
    const halfway = totalLength / 2
    let traveled = 0

    for (let i = 0; i < segmentLengths.length; i++) {
      const segLen = segmentLengths[i]
      if (traveled + segLen >= halfway) {
        const ratio = (halfway - traveled) / segLen
        labelX = waypoints[i].x + (waypoints[i + 1].x - waypoints[i].x) * ratio
        labelY = waypoints[i].y + (waypoints[i + 1].y - waypoints[i].y) * ratio
        break
      }
      traveled += segLen
    }
  }

  const selectedValue = Number.isFinite(pathData.selected_sojourn)
    ? pathData.selected_sojourn
    : pathData.average
  const averageLabel = Number.isFinite(selectedValue) ? formatSecondsHuman(selectedValue) : 'N/A'
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  setBpmnAugmentationAttributes(group, 'flow-label', {
    view: 'performance',
    labelMode: 'path',
    elementId: labelFlowId,
    pathKey
  })

  const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  const bgWidth = averageLabel.length * 7
  const bgHeight = 16
  bgRect.setAttribute('x', (labelX - bgWidth / 2).toString())
  bgRect.setAttribute('y', (labelY - bgHeight / 2).toString())
  bgRect.setAttribute('width', bgWidth.toString())
  bgRect.setAttribute('height', bgHeight.toString())
  bgRect.setAttribute('rx', '2')
  bgRect.setAttribute('ry', '2')
  bgRect.setAttribute('fill', 'white')
  bgRect.setAttribute('stroke', 'black')
  bgRect.setAttribute('stroke-width', '1.5')
  bgRect.style.pointerEvents = 'none'

  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
  text.setAttribute('x', labelX.toString())
  text.setAttribute('y', labelY.toString())
  text.setAttribute('text-anchor', 'middle')
  text.setAttribute('dominant-baseline', 'middle')
  text.setAttribute('fill', 'black')
  text.setAttribute('font-size', '12')
  text.setAttribute('font-weight', 'bold')
  text.setAttribute('font-family', 'Arial, sans-serif')
  text.textContent = averageLabel
  text.style.pointerEvents = 'none'

  group.appendChild(bgRect)
  group.appendChild(text)
  group.style.pointerEvents = 'none'
  viewport.appendChild(group)

  applyTimeConformanceStyle({
    elementRegistry,
    container,
    labelFlowId,
    pathElementIds: pathData.elements,
    sourceElementId: pathData.sourceElementId,
    targetElementId: pathData.targetElementId,
    labelGroup: group,
    conformance: pathData.conformance,
    selectedActivityMode,
    paintSelectedSourceActivity,
    scope: 'selected'
  })
}
