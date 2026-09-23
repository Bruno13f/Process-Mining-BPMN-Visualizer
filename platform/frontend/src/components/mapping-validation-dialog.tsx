import { AlertCircle } from "lucide-react"
import { useTranslation } from "react-i18next"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "./ui/alert-dialog"

interface MappingValidationDialogProps {
    errors: string[]
    open: boolean
    onOpenChange: (open: boolean) => void
    onContinue?: () => void
}

export function MappingValidationDialog({ 
    errors, 
    open, 
    onOpenChange,
    onContinue 
}: MappingValidationDialogProps) {
    const { t } = useTranslation()
    const hasErrors = errors.length > 0

    // Decode common HTML entities that may slip through i18next
    const decodeHtmlEntities = (text: string) => {
        return text
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
    }

    const renderMessageWithColoredActivities = (message: string, color: 'red' | 'yellow') => {
        const colorClass = color === 'red' ? 'text-red-600 font-semibold' : 'text-yellow-600 font-semibold'
        
        // Decode HTML entities first, then split by quotes and wrap quoted text with color
        const decodedMessage = decodeHtmlEntities(message)
        const parts = decodedMessage.split(/(".*?")/)
        return (
            <>
                {parts.map((part, index) => {
                    if (part.startsWith('"') && part.endsWith('"')) {
                        return <span key={index} className={colorClass}>{part}</span>
                    }
                    return <span key={index}>{part}</span>
                })}
            </>
        )
    }

    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent className={`bg-white border-1 border-[#808080] z-[150] rounded-lg ${hasErrors ? '!max-w-none w-[50%] pt-6 px-0 pb-0 h-[50vh] flex flex-col' : ''}`} showOverlay={false}>
                <AlertDialogHeader className={hasErrors ? 'px-6 pt-2 pb-4 border-b border-[#808080]' : ''}>
                    <AlertDialogTitle className={"text-primary " + (hasErrors ? 'text-3xl font-semibold' : 'text-xl font-semibold')}>
                        {hasErrors ? t('mappingValidation.validationFailed') : t('mappingValidation.confirmContinue')}
                    </AlertDialogTitle>
                    <AlertDialogDescription className="text-sm text-gray-600 mt-1">
                        {hasErrors 
                            ? t('mappingValidation.fixErrors')
                            : t('mappingValidation.mappingsWillBeApplied')}
                    </AlertDialogDescription>
                </AlertDialogHeader>

                {hasErrors && (
                    <div className="px-6 pt-2 flex-1 min-h-0">
                        <div className="flex flex-col gap-2 min-h-0 h-full">
                            <div className="flex items-center gap-2 pb-2 border-b border-red-600">
                                <AlertCircle className="w-5 h-5 text-red-600" />
                                <h3 className="font-semibold text-red-600">{t('mappingValidation.errors')} ({errors.length})</h3>
                            </div>
                            <ul className="space-y-2 overflow-y-auto flex-1">
                                {errors.map((error, index) => (
                                    <li key={index} className="flex gap-2 text-sm">
                                        <span className="text-red-600 font-medium shrink-0">•</span>
                                        <span className="text-gray-700">{renderMessageWithColoredActivities(error, 'red')}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                )}

                <AlertDialogFooter className={hasErrors ? 'rounded-b-lg py-4 border-t border-[#808080]' : ''}>
                    <AlertDialogCancel className={`border-1 border-[#808080] hover:cursor-pointer ${hasErrors ? 'mr-4' : ''}`}>
                        {hasErrors ? t('mappingValidation.close') : t('mappingValidation.cancel')}
                    </AlertDialogCancel>
                    {!hasErrors && onContinue && (
                        <AlertDialogAction onClick={onContinue} className="hover:cursor-pointer">
                            {t('mappingValidation.continue')}
                        </AlertDialogAction>
                    )}
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
