import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface BpmnFrequencyActivityRolesProps {
  activityName: string
  roles: { role: string; frequency: number }[]
  frequency?: number
  onClose: () => void
}

export function BpmnFrequencyActivityRoles({ activityName, roles, frequency, onClose }: BpmnFrequencyActivityRolesProps) {
  const { t } = useTranslation()

  return (
    <div 
      className="fixed inset-0 z-100 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div 
        className="bg-white border border-[#808080] rounded-lg shadow-xl w-[50%] max-w-[800px] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-4">
          <div className="text-lg font-semibold">{activityName}</div>
          <button
            onClick={onClose}
            className="p-1 hover:cursor-pointer hover:bg-zinc-100 rounded transition-colors shrink-0"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="border-b border-[#808080] mb-3"></div>

        <div className='mb-4 px-4 flex flex-col flex-1 min-h-0'>

          {frequency && (
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm font-medium text-zinc-700">{t('activityTooltip.frequency')}</span>
              <span className="text-xs text-red-600 font-medium bg-red-100 px-2 py-0.5 rounded whitespace-nowrap">
                {frequency}
              </span>
            </div>
          )}

          <div className="text-sm font-medium mb-2 text-zinc-700">
            {t('activityTooltip.roles')}
          </div>

          <div className="overflow-y-auto flex-1" style={{ scrollbarWidth: 'thin', scrollbarColor: '#808080 #D8D8D8' }}>
            <div className="space-y-2">
              {roles.map((role, idx) => (
                <div key={idx} className="flex items-start gap-3 justify-between p-2 hover:bg-zinc-50 rounded">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <div className="w-2 h-2 bg-red-500 rounded-full shrink-0 mt-1"></div>
                    <span className="text-sm text-black break-words">{role.role}</span>
                  </div>
                  <span className="text-xs text-red-600 font-medium bg-red-100 px-2 py-0.5 rounded shrink-0 whitespace-nowrap">
                    {role.frequency}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
