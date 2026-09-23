import { useEffect, useRef } from 'react'
import NavigatedViewer from 'bpmn-js/lib/NavigatedViewer'

export function useBpmnViewer(containerRef: React.RefObject<HTMLDivElement | null>) {
  const viewerRef = useRef<NavigatedViewer | null>(null)

  useEffect(() => {
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
    }
  }, [containerRef])

  return viewerRef
}
