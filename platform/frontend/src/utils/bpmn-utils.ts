/**
 * Utility functions for BPMN activity styling
 */

type BpmnAugmentationAttributes = {
  view?: 'alignments' | 'frequency' | 'performance' | 'time-conformance' | 'deviations'
  labelMode?: 'direct' | 'path'
  elementId?: string
  pathKey?: string
  from?: string
  to?: string
  id?: string
  scope?: string
}

export const BPMN_AUGMENTATION_ATTRS = {
  root: 'data-bpmn-augmentation',
  type: 'data-bpmn-augmentation-type',
  view: 'data-bpmn-view',
  labelMode: 'data-bpmn-label-mode',
  elementId: 'data-bpmn-element-id',
  pathKey: 'data-bpmn-path-key',
  from: 'data-bpmn-from',
  to: 'data-bpmn-to',
  id: 'data-bpmn-id',
  scope: 'data-bpmn-scope'
} as const

// Build selectors for frontend-only overlays so each view can remove its own generated elements.
export const bpmnAugmentationSelector = (
  type?: string,
  attributes: Partial<BpmnAugmentationAttributes> = {}
) => {
  const selectors = [`[${BPMN_AUGMENTATION_ATTRS.root}="true"]`]

  if (type) selectors.push(`[${BPMN_AUGMENTATION_ATTRS.type}="${type}"]`)
  if (attributes.view !== undefined) selectors.push(`[${BPMN_AUGMENTATION_ATTRS.view}="${attributes.view}"]`)
  if (attributes.labelMode !== undefined) selectors.push(`[${BPMN_AUGMENTATION_ATTRS.labelMode}="${attributes.labelMode}"]`)
  if (attributes.elementId !== undefined) selectors.push(`[${BPMN_AUGMENTATION_ATTRS.elementId}="${attributes.elementId}"]`)
  if (attributes.pathKey !== undefined) selectors.push(`[${BPMN_AUGMENTATION_ATTRS.pathKey}="${attributes.pathKey}"]`)
  if (attributes.from !== undefined) selectors.push(`[${BPMN_AUGMENTATION_ATTRS.from}="${attributes.from}"]`)
  if (attributes.to !== undefined) selectors.push(`[${BPMN_AUGMENTATION_ATTRS.to}="${attributes.to}"]`)
  if (attributes.id !== undefined) selectors.push(`[${BPMN_AUGMENTATION_ATTRS.id}="${attributes.id}"]`)
  if (attributes.scope !== undefined) selectors.push(`[${BPMN_AUGMENTATION_ATTRS.scope}="${attributes.scope}"]`)

  return selectors.join('')
}

export function setBpmnAugmentationAttributes(
  node: Element,
  type: string,
  attributes: BpmnAugmentationAttributes = {}
) {
  // Mark generated SVG/BPMN decorations without changing the semantic identity of model elements.
  node.setAttribute(BPMN_AUGMENTATION_ATTRS.root, 'true')
  node.setAttribute(BPMN_AUGMENTATION_ATTRS.type, type)

  if (attributes.view !== undefined) node.setAttribute(BPMN_AUGMENTATION_ATTRS.view, attributes.view)
  if (attributes.labelMode !== undefined) node.setAttribute(BPMN_AUGMENTATION_ATTRS.labelMode, attributes.labelMode)
  if (attributes.elementId !== undefined) node.setAttribute(BPMN_AUGMENTATION_ATTRS.elementId, attributes.elementId)
  if (attributes.pathKey !== undefined) node.setAttribute(BPMN_AUGMENTATION_ATTRS.pathKey, attributes.pathKey)
  if (attributes.from !== undefined) node.setAttribute(BPMN_AUGMENTATION_ATTRS.from, attributes.from)
  if (attributes.to !== undefined) node.setAttribute(BPMN_AUGMENTATION_ATTRS.to, attributes.to)
  if (attributes.id !== undefined) node.setAttribute(BPMN_AUGMENTATION_ATTRS.id, attributes.id)
  if (attributes.scope !== undefined) node.setAttribute(BPMN_AUGMENTATION_ATTRS.scope, attributes.scope)
}

/**
 * Apply background color styling to an activity element
 */
export function applyActivityColorStyles(
  gfx: any,
  backgroundColor: string,
  labelColor: string,
  strokeColor?: string,
) {
  const bbox = gfx.getBBox()
  
  // Insert a generated background behind the original BPMN shape while preserving the label.
  const backgroundRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  backgroundRect.setAttribute('x', String(bbox.x))
  backgroundRect.setAttribute('y', String(bbox.y))
  backgroundRect.setAttribute('width', String(bbox.width))
  backgroundRect.setAttribute('height', String(bbox.height))
  backgroundRect.setAttribute('rx', '10')
  backgroundRect.setAttribute('ry', '10')
  backgroundRect.setAttribute('fill', backgroundColor)
  backgroundRect.setAttribute('stroke', 'none')
  setBpmnAugmentationAttributes(backgroundRect, 'activity-background')
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

  // Keep the original BPMN geometry, but let the generated background carry the heatmap color.
  const shapes = gfx.querySelectorAll(`rect:not(${bpmnAugmentationSelector('activity-background')}), path, circle, ellipse, polygon`)
  shapes.forEach((shape: any) => {
    shape.style.fill = 'rgba(0, 0, 0, 0)'
    shape.setAttribute('fill', 'rgba(0, 0, 0, 0)')

    if (strokeColor) {
      shape.style.stroke = strokeColor
      shape.style.strokeWidth = '2px'
      shape.setAttribute('stroke', strokeColor)
      shape.setAttribute('stroke-width', '2')
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
    text.style.fontWeight = 'bold'
    text.style.fontSize = '12px'
    text.style.fontFamily = 'Arial, sans-serif'
    text.setAttribute('fill', labelColor)
    text.style.pointerEvents = 'none'
  })

  gfx.style.display = 'none'
  gfx.offsetHeight // Trigger reflow
  gfx.style.display = ''
}

/**
 * Get all activity elements from the BPMN viewer
 */
export function getActivityElements(viewer: any) {
  const elementRegistry = viewer.get('elementRegistry') as any
  const allElements = elementRegistry.getAll()
  
  return allElements.filter((element: any) =>
    element.type === 'bpmn:Task' ||
    element.type === 'bpmn:UserTask' ||
    element.type === 'bpmn:ServiceTask' ||
    element.type === 'bpmn:ManualTask' ||
    element.type === 'bpmn:ScriptTask' ||
    element.type === 'bpmn:BusinessRuleTask' ||
    element.type === 'bpmn:SendTask' ||
    element.type === 'bpmn:ReceiveTask'
  )
}

/**
 * Calculate color gradient from green to red based on a value and min/max range
 */
export function getColorGradient(value: number, min: number, max: number): string {
  if (max === min) return '#00ff00' // All green if no range
  
  const normalized = (value - min) / (max - min)
  const clamped = Math.max(0, Math.min(1, normalized))
  
  // Green (0,255,0) to Red (255,0,0)
  const red = Math.round(255 * clamped)
  const green = Math.round(255 * (1 - clamped))
  
  return `rgb(${red}, ${green}, 0)`
}

/**
 * Generate SVG gradient for heatmap legends
 */
export function generateGradientColors(steps: number = 100): string[] {
  return Array.from({ length: steps }, (_, i) => {
    const ratio = i / (steps - 1)
    const red = Math.round(255 * ratio)
    const green = Math.round(255 * (1 - ratio))
    return `rgb(${red}, ${green}, 0)`
  })
}

/**
 * Normalize activity name by removing frequency or time suffix
 * Matches patterns like "(123)" or "(2h 15m 30s)" at the end
 */
export function stripFrequencySuffix(activityName: string): string {
  return activityName.replace(/\s*\([^)]+\)$/, '')
}

/**
 * Normalize activity name for consistency
 */
export function normalizeActivityName(activityName: string): string {
  return activityName
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}
