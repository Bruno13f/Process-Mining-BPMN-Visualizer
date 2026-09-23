import { ZoomIn, ZoomOut, Maximize, RotateCcw, ImageDown } from 'lucide-react'

interface BpmnZoomControlsProps {
  onZoomIn: () => void
  onZoomOut: () => void
  onFitViewport: () => void
  onReset: () => void
  isLoaded: boolean
  topPosition: string
  onImageDown?: () => void
}

export function BpmnZoomControls({
  onZoomIn,
  onZoomOut,
  onFitViewport,
  onReset,
  isLoaded,
  topPosition,
  onImageDown,
}: BpmnZoomControlsProps) {
  if (!isLoaded) return null

  return (
    <div
      className={`absolute ${topPosition} right-2 z-10 flex flex-col gap-1 bg-white border-1 border-[#808080] rounded-md shadow-md p-1`}
      data-bpmn-controls="true"
    >
      <button
        onClick={onZoomIn}
        className="p-2 hover:bg-zinc-100 rounded transition-colors hover:cursor-pointer"
      >
        <ZoomIn className="w-4 h-4" />
      </button>
      <button
        onClick={onZoomOut}
        className="p-2 hover:bg-zinc-100 rounded transition-colors hover:cursor-pointer"
      >
        <ZoomOut className="w-4 h-4" />
      </button>
      <button
        onClick={onFitViewport}
        className="p-2 hover:bg-zinc-100 rounded transition-colors hover:cursor-pointer"
      >
        <Maximize className="w-4 h-4" />
      </button>
      <button
        onClick={onReset}
        className="p-2 hover:bg-zinc-100 rounded transition-colors hover:cursor-pointer"
      >
        <RotateCcw className="w-4 h-4" />
      </button>
      {onImageDown && (
        <button
          onClick={onImageDown}
          className="p-2 hover:bg-zinc-100 rounded transition-colors hover:cursor-pointer"
        >
          <ImageDown className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}
