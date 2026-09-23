import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { FaTrash } from 'react-icons/fa6';

interface FilesUploadProps {
  icon: React.ReactNode;
  title: string;
  btnText: string;
  onUploadClick: () => void;
  fileName: string | null;
  onRemove: () => void;
  trashTooltip: string;
  isUploading: boolean;
}

export function FilesUpload({
  icon,
  title,
  btnText,
  onUploadClick,
  fileName,
  onRemove,
  trashTooltip,
  isUploading,
}: FilesUploadProps) {
  
  const maxWidthParent = title.includes('Model') ? 153 : 119;
  const maxWidthFileName = maxWidthParent - 26;

  return (
    <div className='flex flex-row gap-x-2 items-end'>
      {icon}
      <div className='flex flex-col justify-center items-start gap-y-1'>
        <span className='text-sm font-medium text-zinc-600'>{title}</span>
        {isUploading ? (
          <div className="inline-flex items-center gap-x-1 w-full" style={{ maxWidth: maxWidthParent }}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="text-sm font-medium inline-block truncate whitespace-nowrap overflow-hidden cursor-pointer"
                  style={{ maxWidth: maxWidthFileName }}
                >
                  {fileName}
                </span>
              </TooltipTrigger>
              <TooltipContent className="z-200">
                <p>{fileName}</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button className='cursor-pointer h-6 w-6 p-0 text-sm bg-[#ffffff] border-1 border-[#808080] shadow-none active:shadow-[inset_0_0px_4px_#979797] transition-shadow' 
                  variant={'outline'} onClick={onRemove}>
                  <FaTrash className="text-red-600 cursor-pointer" />
                </Button>
              </TooltipTrigger>
              <TooltipContent className="z-200">
                <p>{trashTooltip}</p>
              </TooltipContent>
            </Tooltip>
          </div>
        ) : (
          <Button className='cursor-pointer h-6 px-2 text-sm bg-[#ffffff] border-1 border-[#808080] shadow-none active:shadow-[inset_0_0px_4px_#979797] transition-shadow' variant={'outline'}
            onClick={onUploadClick}>
            {btnText}
          </Button>
        )}
      </div>
    </div>
  );
}
