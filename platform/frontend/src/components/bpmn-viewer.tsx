import { useEffect, useRef, useState } from 'react'
import NavigatedViewer from 'bpmn-js/lib/NavigatedViewer'
import { BpmnZoomControls } from './ui/bpmn-zoom-controls'

interface BpmnViewerProps {
  xml: string
  className?: string
}

export function BpmnViewer({ xml, className = '' }: BpmnViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<NavigatedViewer | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => {
    if (!containerRef.current) return

    const viewer = new NavigatedViewer({
      container: containerRef.current,
      width: '100%',
      height: '100%'
    })

    viewerRef.current = viewer

    const handleWheel = (event: WheelEvent) => {
      // Only allow zoom when Ctrl key is pressed
      if (!event.ctrlKey) {
        return
      }
      
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
  }, [])

  useEffect(() => {
    if (!viewerRef.current || !xml) return

    setIsLoaded(false)
    viewerRef.current.importXML(xml).then(() => {
      const canvas = viewerRef.current!.get('canvas') as any
      canvas.zoom('fit-viewport', 'auto')
      // Use requestAnimationFrame to ensure the fit-viewport is applied before scaling
      requestAnimationFrame(() => {
        const currentZoom = canvas.zoom()
        canvas.zoom(currentZoom * 0.9, 'auto')
        setIsLoaded(true)
      })
    }).catch((error: any) => {
      console.error('Error importing BPMN:', error)
    })
  }, [xml])

  const handleZoomIn = () => {
    if (viewerRef.current) {
      const canvas = viewerRef.current.get('canvas') as any
      canvas.zoom(canvas.zoom() * 1.2)
    }
  }

  const handleZoomOut = () => {
    if (viewerRef.current) {
      const canvas = viewerRef.current.get('canvas') as any
      canvas.zoom(canvas.zoom() * 0.8)
    }
  }

  const handleFitViewport = () => {
    if (viewerRef.current) {
      const canvas = viewerRef.current.get('canvas') as any
      canvas.zoom('fit-viewport', 'auto')
      requestAnimationFrame(() => {
        const currentZoom = canvas.zoom()
        canvas.zoom(currentZoom * 0.9, 'auto')
      })
    }
  }

  const handleReset = () => {
    if (viewerRef.current) {
      const canvas = viewerRef.current.get('canvas') as any
      canvas.zoom('fit-viewport', 'auto')
    }
  }

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    setIsDragging(true)
    e.currentTarget.style.cursor = 'grabbing'
    e.preventDefault()
  }

  const handleMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    setIsDragging(false)
    e.currentTarget.style.cursor = 'grab'
  }

  const handleMouseLeave = (e: React.MouseEvent<HTMLDivElement>) => {
    setIsDragging(false)
    e.currentTarget.style.cursor = 'grab'
  }

  return (
    <div className={`w-full h-full relative ${className}`}>
      <BpmnZoomControls
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onFitViewport={handleFitViewport}
        onReset={handleReset}
        isLoaded={isLoaded}
        topPosition='top-2'
      />
      
      <div 
        ref={containerRef} 
        className="w-full h-full bg-white select-none"
        style={{ 
          minHeight: '70vh', 
          cursor: isDragging ? 'grabbing' : 'grab',
          WebkitUserSelect: 'none',
          MozUserSelect: 'none',
          msUserSelect: 'none',
          userSelect: 'none'
        }}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onDragStart={(e) => e.preventDefault()}
      />
    </div>
  )
}
