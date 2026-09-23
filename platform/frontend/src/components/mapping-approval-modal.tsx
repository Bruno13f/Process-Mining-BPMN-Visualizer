import { Card } from "./ui/card"
import { CheckCircle, AlertCircle, ArrowRight, SquarePen, Trash2 } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { MappingCombobox } from "@/components/mapping-combobox"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { MappingValidationDialog } from "./mapping-validation-dialog"

interface MappingApprovalModalProps {
    mappingsSuggested: string[]
    mappingsNonSuggested: string[]
    bpmn_activities: string[]
    log_activities: string[]
    onContinue: (mappings: Array<{ log: string, model: string }>) => void
}

export function MappingApprovalModal({ 
    mappingsSuggested, 
    mappingsNonSuggested,
    bpmn_activities,
    log_activities,
    onContinue 
}: MappingApprovalModalProps) {
    const { t } = useTranslation()
    const [isProcessing, setIsProcessing] = useState(false)
    
    // Match the backend's explicit placeholder so empty labels are visible to the user.
    const processedBpmnActivities = bpmn_activities.map(activity => activity === "" ? "No Label" : activity)
    const processedLogActivities = log_activities.map(activity => activity === "" ? "No Label" : activity)

    // The backend now sends the penalised hybrid confidence as hc; keep Hybrid as a legacy fallback.
    const extractHybridConfidence = (scoreText: string) => {
        const confidenceMatch = scoreText.match(/\bhc=([\d.]+)/i)
        const legacyHybridMatch = scoreText.match(/\bHybrid=([\d.]+)/i)
        const rawScore = confidenceMatch?.[1] ?? legacyHybridMatch?.[1]

        return rawScore ? Math.round(parseFloat(rawScore) * 100) : 0
    }

    // Candidate margin stays separate from confidence because it only describes near-tie ambiguity.
    const extractCandidateMargin = (scoreText: string) => {
        const marginMatch = scoreText.match(/(?:Δ|Delta)=([\d.]+)/i)
        return marginMatch?.[1] ? parseFloat(marginMatch[1]) : null
    }

    // Ambiguous recommendations remain suggested; the flag only drives the close-alternative warning.
    const isAmbiguousMapping = (scoreText: string) =>
        /\bambiguous=True\b/i.test(scoreText) ||
        /\bambiguity_reason=margin-below-epsilon\b/i.test(scoreText)
    
    const suggestedMappings = mappingsSuggested
        .map((line) => {
            const match = line.match(/^\s*(.+?)\s*→\s*(.+?)\s*\((.+)\)/)
            if (match) {
                return {
                    log: match[1].trim().replace(/^[✅❌]\s*/, ''),
                    model: match[2].trim(),
                    confidence: extractHybridConfidence(match[3]),
                    candidateMargin: extractCandidateMargin(match[3]),
                    ambiguous: isAmbiguousMapping(match[3]),
                    original: line
                }
            }
            return null
        })
        .filter(m => m !== null)

    const nonSuggestedMappings = mappingsNonSuggested
        .map((line) => {
            const match = line.match(/^\s*(.+?)\s*→\s*(.+?)\s*\((.+)\)/)
            if (match) {
                return {
                    log: match[1].trim().replace(/^[✅❌]\s*/, ''),
                    model: match[2].trim(),
                    confidence: extractHybridConfidence(match[3]),
                    candidateMargin: extractCandidateMargin(match[3]),
                    ambiguous: isAmbiguousMapping(match[3]),
                    original: line
                }
            }
            return null
        })
        .filter(m => m !== null)

    const [selectedSuggested, setSelectedSuggested] = useState<Set<number>>(() => 
        new Set(suggestedMappings.map((_, index) => index))
    )
    const [selectedNonSuggested, setSelectedNonSuggested] = useState<Set<number>>(new Set())
    const [selectedManualMappings, setSelectedManualMappings] = useState<Array<{ log: string, model: string, id: number }>>([])
    const [nextManualId, setNextManualId] = useState(0)

    const getInitialTab = (): 'manual' | 'suggested' | 'non-suggested' => {
        if (suggestedMappings.length > 0) return 'suggested'
        if (nonSuggestedMappings.length > 0) return 'non-suggested'
        return 'manual'
    }

    const [activeTab, setActiveTab] = useState<'manual' | 'suggested' | 'non-suggested'>(getInitialTab())
    const [validationDialogOpen, setValidationDialogOpen] = useState(false)
    const [validationErrors, setValidationErrors] = useState<string[]>([])

    const validateMappings = () => {
        const errors: string[] = []
        const logToMappings = new Map<string, Array<{ model: string, source: string }>>()
        const allMappings: Array<{ log: string, model: string, source: string }> = []

        /* Log label -> Model label

            - log label can only be mapped to one model label (one-to-one)
            OR
            - different log labels can be mapped to the same model label (many-to-one)

        */

        const totalMappings = selectedSuggested.size + selectedNonSuggested.size + selectedManualMappings.length
        if (totalMappings === 0) {
            return { errors }
        }

        if (selectedManualMappings.length > 0) {
            selectedManualMappings.forEach((mapping, idx) => {
                if (!mapping.log || !mapping.model) {
                    errors.push(t('mappingValidation.errorEmptyFields', { index: idx + 1 }))
                    return
                }
                allMappings.push({ log: mapping.log, model: mapping.model, source: 'manual' })
            })
        }

        selectedSuggested.forEach(idx => {
            const mapping = suggestedMappings[idx]!
            allMappings.push({ log: mapping.log, model: mapping.model, source: 'suggested' })
        })

        selectedNonSuggested.forEach(idx => {
            const mapping = nonSuggestedMappings[idx]!
            allMappings.push({ log: mapping.log, model: mapping.model, source: 'non-suggested' })
        })

        allMappings.forEach(mapping => {
            if (!logToMappings.has(mapping.log)) {
                logToMappings.set(mapping.log, [])
            }
            logToMappings.get(mapping.log)!.push({ model: mapping.model, source: mapping.source })
        })

        logToMappings.forEach((mappings, logLabel) => {
            if (mappings.length > 1) {
                const uniqueModels = new Set(mappings.map(m => m.model))
                
                if (uniqueModels.size > 1) {
                    const modelsList = Array.from(uniqueModels).map(m => `"${m}"`).join(' and ')
                    errors.push(t('mappingValidation.errorMultipleModels', { logLabel, modelsList }))
                } else {
                    errors.push(t('mappingValidation.errorDuplicateMapping', { logLabel, modelLabel: mappings[0].model, count: mappings.length }))
                }
            }
        })

        return { errors }
    }

    const handleContinue = async () => {
        const { errors } = validateMappings()
        setValidationErrors(errors)
        setValidationDialogOpen(true)
    }

    const handleValidationContinue = () => {
        setValidationDialogOpen(false)
        setIsProcessing(true)
        
        const allSelectedMappings: Array<{ log: string, model: string }> = []
        
        selectedManualMappings.forEach(mapping => {
            if (mapping.log && mapping.model) {
                allSelectedMappings.push({ log: mapping.log, model: mapping.model })
            }
        })
        
        selectedSuggested.forEach(idx => {
            const mapping = suggestedMappings[idx]!
            allSelectedMappings.push({ log: mapping.log, model: mapping.model })
        })
        
        selectedNonSuggested.forEach(idx => {
            const mapping = nonSuggestedMappings[idx]!
            allSelectedMappings.push({ log: mapping.log, model: mapping.model })
        })
        
        onContinue(allSelectedMappings)
    }

    const toggleSuggestedMapping = (index: number) => {
        setSelectedSuggested(prev => {
            const newSet = new Set(prev)
            if (newSet.has(index)) {
                newSet.delete(index)
            } else {
                newSet.add(index)
            }
            return newSet
        })
    }

    const toggleNonSuggestedMapping = (index: number) => {
        setSelectedNonSuggested(prev => {
            const newSet = new Set(prev)
            if (newSet.has(index)) {
                newSet.delete(index)
            } else {
                newSet.add(index)
            }
            return newSet
        })
    }

    const addSelectedManualMapping = () => {
        const newMapping = {
            log: '',
            model: '',
            id: nextManualId
        }
        setSelectedManualMappings(prev => [...prev, newMapping])
        setNextManualId(prev => prev + 1)
    }

    const removeSelectedManualMapping = (id: number) => {
        setSelectedManualMappings(prev => prev.filter(m => m.id !== id))
    }

    const updateSelectedManualMapping = (id: number, field: 'log' | 'model', value: string) => {
        setSelectedManualMappings(prev => prev.map(m => 
            m.id === id ? { ...m, [field]: value } : m
        ))
    }

    return (
        <div className="absolute z-[100] flex-1 w-full h-full flex items-center justify-center border-[#808080]">
            <Card className="h-[85%] w-[60%] pt-6 pb-0 flex flex-col bg-[#D8D8D8] gap-y-0 border-1 border-[#808080]">
                <div className="px-6 pt-4 pb-4 border-b bg-[#D8D8D8] border-b border-[#808080]">
                    <h1 className="text-3xl font-semibold">{t('mapping.title')}</h1>
                    <p className="text-sm text-gray-800 mt-2">
                        {t('mapping.description')}
                    </p>
                </div>

                <div className="border-b border-[#808080] bg-[#f0f0f0] pt-6">
                    <div className="flex px-6">
                        <button
                            onClick={() => setActiveTab('manual')}
                            className={`hover:cursor-pointer px-4 py-3 font-medium border-b-2 transition-colors ${
                                activeTab === 'manual'
                                    ? 'border-slate-600 text-slate-700'
                                    : 'border-transparent text-gray-600 hover:text-gray-900'
                            }`}
                        >
                            <div className="flex items-center gap-2">
                                <SquarePen size={18} />
                                {t('mapping.manualMapping')} ({selectedManualMappings.length})
                            </div>
                        </button>
                        <button
                            onClick={() => setActiveTab('suggested')}
                            className={`hover:cursor-pointer px-4 py-3 font-medium border-b-2 transition-colors ${
                                activeTab === 'suggested'
                                    ? 'border-green-600 text-green-700'
                                    : 'border-transparent text-gray-600 hover:text-gray-900'
                            }`}
                        >
                            <div className="flex items-center gap-2">
                                <CheckCircle size={18} />
                                {t('mapping.suggestedMapping')} ({selectedSuggested.size}/{suggestedMappings.length})
                            </div>
                        </button>
                        <button
                            onClick={() => setActiveTab('non-suggested')}
                            className={`hover:cursor-pointer px-4 py-3 font-medium border-b-2 transition-colors ${
                                activeTab === 'non-suggested'
                                    ? 'border-red-600 text-red-700'
                                    : 'border-transparent text-gray-600 hover:text-gray-900'
                            }`}
                        >
                            <div className="flex items-center gap-2">
                                <AlertCircle size={18} />
                                {t('mapping.nonSuggestedMapping')} ({selectedNonSuggested.size} /{nonSuggestedMappings.length})
                            </div>
                        </button>
                    </div>
                </div>

                <div className="flex-1 flex flex-col min-h-0 bg-background py-6">
                    {activeTab === 'manual' && (
                        <div className="flex-1 flex flex-col px-6 pb-6 min-h-0" >
                            <div className="flex flex-row justify-between mb-4 gap-x-6">
                                <p className="text-sm text-black">
                                    {t('mapping.manualMappingDescription')}
                                </p>
                                <button
                                    className="text-sm hover:cursor-pointer bg-slate-600 hover:bg-slate-700 
                                    disabled:bg-gray-400 text-white rounded-md font-medium 
                                    transition-colors flex items-center h-fit px-2 py-1 whitespace-nowrap"
                                    onClick={addSelectedManualMapping}
                                >
                                    {t('mapping.createManualMapping')}
                                </button>
                            </div>
                            <div className="flex-1 overflow-y-auto min-h-0 border-2 border-dashed border-slate-300 rounded-lg">
                                {selectedManualMappings.length > 0 ? (
                                    <>
                                        <div className="p-4 space-y-2">
                                            {selectedManualMappings.map((mapping) => (
                                                <div 
                                                    key={`manual-${mapping.id}`}
                                                    className=" border bg-slate-600/20 border-slate-600 rounded-lg p-4"
                                                >
                                                    <div className="flex items-center gap-3 justify-between">
                                                        <div className="flex items-center gap-3">
                                                            <MappingCombobox
                                                                value={mapping.log}
                                                                onChange={(value) => updateSelectedManualMapping(mapping.id, 'log', value)}
                                                                items={processedLogActivities}
                                                                placeholder={t('mapping.placeholderLog')}
                                                                searchPlaceholder={t('mapping.searchPlaceholderLog')}
                                                                emptyMessage={t('mapping.noLogActivities')}
                                                            />
                                                            <ArrowRight size={16} className="text-primary" />
                                                            <MappingCombobox
                                                                value={mapping.model}
                                                                onChange={(value) => updateSelectedManualMapping(mapping.id, 'model', value)}
                                                                items={processedBpmnActivities}
                                                                placeholder={t('mapping.placeholderModel')}
                                                                searchPlaceholder={t('mapping.searchPlaceholderModel')}
                                                                emptyMessage={t('mapping.noModelActivities')}
                                                            />
                                                        </div>
                                                        <Tooltip>
                                                            <TooltipTrigger>
                                                                <button
                                                                    onClick={() => removeSelectedManualMapping(mapping.id)}
                                                                    className="hover:cursor-pointer text-red-700 p-2"
                                                                >
                                                                    <Trash2 size={18} />
                                                                </button>
                                                            </TooltipTrigger>
                                                            <TooltipContent className="z-200">
                                                                <p>{t('mapping.removeManualMapping')}</p>
                                                            </TooltipContent>
                                                        </Tooltip>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <div className="sticky bg-white top-0 border-dashed border-b-2 border-primary/20 p-4 z-10">
                                            <div className="flex items-center gap-3">
                                                <span className="text-sm font-mono bg-white px-3 py-1 rounded-lg border border-[#808080]">
                                                    {t('mapping.logLabel')}
                                                </span>
                                                <ArrowRight size={16} className="text-primary" />
                                                <span className="text-sm font-mono bg-white px-3 py-1 rounded-lg border border-[#808080]">
                                                    {t('mapping.modelLabel')}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="flex items-center justify-center h-[80%] p-4">
                                        <span className="text-primary/50 text-base">{t('mapping.noManualMappings')}</span>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    )}

                    {activeTab === 'suggested' && (
                        <div className="flex-1 flex flex-col px-6 pb-6 min-h-0">
                            <p className="text-sm text-black mb-6">
                                {t('mapping.suggestedMappingDescription')}
                            </p>
                            <div className="flex-1 overflow-y-auto min-h-0 border-2 border-dashed border-green-300 rounded-lg">
                                <div className="sticky bg-white top-0 border-dashed border-b-2 border-green-300 p-4 z-10">
                                    <div className="flex items-center gap-3">
                                        <span className="text-sm font-mono bg-white px-3 py-1 rounded-lg border border-[#808080]">
                                        {t('mapping.logLabel')}
                                        </span>
                                        <ArrowRight size={16} className="text-primary" />
                                        <span className="text-sm font-mono bg-white px-3 py-1 rounded-lg border border-[#808080]">
                                            {t('mapping.modelLabel')}
                                        </span>
                                    </div>
                                </div>
                                {suggestedMappings.length > 0 ? 
                                    <>
                                        <div className="p-4 space-y-2">
                                        {suggestedMappings.map((mapping, index) => (
                                            <div 
                                                key={`suggested-${index}`}
                                                onClick={() => toggleSuggestedMapping(index)}
                                                className={`bg-green-50 border border-green-400 rounded-lg p-4 transition-colors cursor-pointer ${selectedSuggested.has(index) ? 'bg-green-100' : 'hover:bg-green-100'}`}
                                            >
                                                <div className="flex items-center gap-3 justify-between">
                                                    <div className="flex items-center gap-3">
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedSuggested.has(index)}
                                                            onChange={(e) => { e.stopPropagation(); toggleSuggestedMapping(index); }}
                                                            className="border border-gray-300 accent-green-500 rounded-lg"
                                                        />
                                                        <span className="text-sm font-mono bg-white px-3 py-1 rounded-lg border border-gray-300">
                                                            {mapping!.log}
                                                        </span>
                                                        <ArrowRight size={16} className="text-primary" />
                                                        <span className="text-sm font-mono bg-white px-3 py-1 rounded-lg border border-gray-300">
                                                            {mapping!.model}
                                                        </span>
                                                    </div>
                                                    <div className="flex flex-col items-end gap-1">
                                                        <div className="flex items-center gap-2 text-green-700">
                                                            <span className="font-medium text-sm text-gray-600">{t('mapping.confidence')}:</span>
                                                            <span className="text-sm font-mono bg-white px-1 py-1 rounded-lg border border-gray-300">
                                                                {mapping!.confidence}%
                                                            </span>
                                                        </div>
                                                        {mapping!.ambiguous && (
                                                            <div className="flex items-center gap-1 text-xs text-gray-500">
                                                                <AlertCircle size={13} />
                                                                <span>
                                                                    {t('mapping.ambiguousRecommendationWarning')}
                                                                    {mapping!.candidateMargin !== null ? ` (${t('mapping.margin')}: ${Math.round(mapping!.candidateMargin * 100)}%)` : ''}
                                                                </span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                        </div>
                                    </> 
                                : 
                                    <div className="flex items-center justify-center h-full p-4">
                                        <span className="text-primary/50 text-base">{t('mapping.noSuggestedMappings')}</span>
                                    </div>}
                            </div>
                        </div>
                    )}

                    {activeTab === 'non-suggested' && (
                        <div className="flex-1 flex flex-col px-6 pb-6 min-h-0" style={{ scrollbarWidth: 'thin', scrollbarColor: '#808080 #D8D8D8' }}>
                            <p className="text-sm text-black mb-6">
                                {t('mapping.nonSuggestedMappingDescription')}
                            </p>
                            <div className="flex-1 overflow-y-auto min-h-0 border-2 border-dashed border-red-200 rounded-lg">
                                { nonSuggestedMappings.length > 0 ? (
                                    <>
                                        <div className="sticky bg-white top-0 border-dashed border-b-2 border-red-200 p-4 z-10">
                                            <div className="flex items-center gap-3">
                                                <span className="text-sm font-mono bg-white px-3 py-1 rounded-lg border border-[#808080]">
                                                    {t('mapping.logLabel')}
                                                </span>
                                                <ArrowRight size={16} className="text-primary" />
                                                <span className="text-sm font-mono bg-white px-3 py-1 rounded-lg border border-[#808080]">
                                                    {t('mapping.modelLabel')}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="p-4 space-y-2">
                                            {nonSuggestedMappings.map((mapping, index) => (
                                                <div 
                                                    key={`non-suggested-${index}`}
                                                    onClick={() => toggleNonSuggestedMapping(index)}
                                                    className={`bg-red-50 border border-red-300 rounded-lg p-4 transition-colors cursor-pointer ${selectedNonSuggested.has(index) ? 'bg-red-100' : 'hover:bg-red-100'}`}
                                                >
                                                    <div className="flex items-center gap-3 justify-between">
                                                        <div className="flex items-center gap-3">
                                                            <input
                                                                type="checkbox"
                                                                checked={selectedNonSuggested.has(index)}
                                                                onChange={(e) => { e.stopPropagation(); toggleNonSuggestedMapping(index); }}
                                                                className="border border-gray-300 accent-red-600 rounded-lg"
                                                            />
                                                            <span className="text-sm font-mono bg-white px-3 py-1 rounded-lg border border-gray-300">
                                                                {mapping!.log}
                                                            </span>
                                                            <ArrowRight size={16} className="text-primary" />
                                                            <span className="text-sm font-mono bg-white px-3 py-1 rounded-lg border border-gray-300">
                                                                {mapping!.model}
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center gap-2 text-primary">
                                                            <span className="font-medium text-sm text-gray-600">{t('mapping.confidence')}:</span>
                                                            <span className="text-sm font-mono bg-white px-1 py-1 rounded-lg border border-gray-300">
                                                                {mapping!.confidence}%
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </>
                                ) : (
                                    <div className="flex items-center justify-center h-full p-4">
                                        <span className="text-primary/50 text-base">{t('mapping.noNonSuggestedMappings')}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                <div className="p-6 border-t rounded-b-lg bg-[#D8D8D8] border-t border-[#808080]">
                    <div className="flex justify-between items-center">
                        <div className="text-sm text-gray-600">
                            {(() => {
                                const count = selectedSuggested.size + selectedNonSuggested.size + selectedManualMappings.length
                                return (
                                    <span className="text-base text-black">
                                        <strong>{count}</strong> {count !== 1 ? t('mapping.mappingsWillBeApplied') : t('mapping.mappingWillBeApplied')}
                                    </span>
                                )
                            })()}
                        </div>
                        <button
                            onClick={handleContinue}
                            disabled={isProcessing}
                            className="hover:cursor-pointer bg-primary hover:bg-primary/90 disabled:bg-gray-400 text-white px-3 py-2 rounded-md font-medium transition-colors flex items-center gap-2"
                        >
                            {isProcessing ? (
                                <>
                                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                    {t('mapping.processingAnalysis')}
                                </>
                            ) : (
                                <>
                                    {t('mapping.continueAnalysis')}
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </Card>

            <MappingValidationDialog
                errors={validationErrors}
                open={validationDialogOpen}
                onOpenChange={setValidationDialogOpen}
                onContinue={handleValidationContinue}
            />
        </div>
    )
}
