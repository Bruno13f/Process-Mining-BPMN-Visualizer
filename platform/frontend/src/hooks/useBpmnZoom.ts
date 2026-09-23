import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type NavigatedViewer from 'bpmn-js/lib/NavigatedViewer'

/**
 * Custom hook to provide zoom control handlers for BPMN viewer
 */
export function useBpmnZoom(viewerRef: React.RefObject<NavigatedViewer | null>) {
  const handleZoomIn = useCallback(() => {
    if (viewerRef.current) {
      const canvas = viewerRef.current.get('canvas') as any
      canvas.zoom(canvas.zoom() * 1.2)
    }
  }, [viewerRef])

  const handleZoomOut = useCallback(() => {
    if (viewerRef.current) {
      const canvas = viewerRef.current.get('canvas') as any
      canvas.zoom(canvas.zoom() * 0.8)
    }
  }, [viewerRef])

  const handleFitViewport = useCallback(() => {
    if (viewerRef.current) {
      const canvas = viewerRef.current.get('canvas') as any
      canvas.zoom('fit-viewport', 'auto')
      requestAnimationFrame(() => {
        const currentZoom = canvas.zoom()
        canvas.zoom(currentZoom * 0.9, 'auto')
      })
    }
  }, [viewerRef])

  const handleReset = useCallback(() => {
    if (viewerRef.current) {
      const canvas = viewerRef.current.get('canvas') as any
      canvas.zoom('fit-viewport', 'auto')
    }
  }, [viewerRef])

  // Download the current BPMN diagram as SVG, using tab/view mode for filename

  const { t } = useTranslation();

  const handleSvgDownload = useCallback(
    async (tabName: string, viewMode: string, containerRef?: React.RefObject<HTMLDivElement | null>) => {
      try {
        // Prefer containerRef for overlays, fallback to viewerRef/canvas
        let svgElem: SVGSVGElement | null = null;
        if (containerRef?.current) {
          svgElem = containerRef.current.querySelector('svg');
        }
        if (!svgElem && viewerRef.current) {
          const canvas = viewerRef.current.get('canvas') as any;
          svgElem = canvas._svg?.getElementsByTagName('svg')[0] || null;
        }
        if (!svgElem) {
          return false;
        }

        // Clone SVG and set width/height explicitly
        const svgClone = svgElem.cloneNode(true) as SVGSVGElement;
        svgClone.setAttribute('width', svgElem.width?.baseVal.value?.toString() || svgElem.getAttribute('width') || '1200');
        svgClone.setAttribute('height', svgElem.height?.baseVal.value?.toString() || svgElem.getAttribute('height') || '800');
        // Force SVG background to white (hex/rgb, not oklch)
        svgClone.style.background = '#fff';
        svgClone.style.backgroundColor = '#fff';

        // Remove oklch backgrounds from all children (defensive)
        const allElems = svgClone.querySelectorAll('*');
        allElems.forEach(el => {
          const style = (el as HTMLElement).style;
          if (style && style.background && style.background.includes('oklch')) {
            style.background = '#fff';
          }
          if (style && style.backgroundColor && style.backgroundColor.includes('oklch')) {
            style.backgroundColor = '#fff';
          }
        });

        const serializer = new XMLSerializer();
        let svgString = serializer.serializeToString(svgClone);
        if (!svgString.includes('http://www.w3.org/2000/svg')) {
          svgString = svgString.replace(
            '<svg',
            '<svg xmlns="http://www.w3.org/2000/svg"'
          );
        }
        if (!svgString.includes('http://www.w3.org/1999/xlink')) {
          svgString = svgString.replace(
            '<svg',
            '<svg xmlns:xlink="http://www.w3.org/1999/xlink"'
          );
        }

        const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        // Translate tabName and viewMode for filename
        const translatedTab = t(`imageDownload.${tabName}`) || tabName;
        const translatedViewMode = t(`imageDownload.${viewMode}`) || viewMode;
        const filename = `${translatedTab}-${translatedViewMode}.svg`;
        link.href = url;
        link.download = filename;
        link.setAttribute('data-bpmn-controls', 'true');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('SVG export error:', err);
        return false;
      }
    },
    [viewerRef]
  );

  return {
    handleZoomIn,
    handleZoomOut,
    handleFitViewport,
    handleReset,
    handleSvgDownload
  }
}
