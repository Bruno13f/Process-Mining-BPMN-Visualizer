"use client"

import * as React from "react"
import { Check, ChevronsUpDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

interface MappingComboboxProps {
  value: string
  onChange: (value: string) => void
  items: string[]
  placeholder?: string
  searchPlaceholder?: string
  emptyMessage?: string
}

export function MappingCombobox({
  value,
  onChange,
  items,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  emptyMessage = "No items found.",
}: MappingComboboxProps) {
  const [open, setOpen] = React.useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="text-sm border border-[#808080] shadow-none font-mono bg-white px-3 py-1 rounded-lg h-auto hover:bg-gray-50 justify-between min-w-[150px]"
        >
          <span className="truncate">{value ? value == "No Label" ? <i>{value}</i> : value : placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0 z-200 shadow-none border border-[#808080]">
        <Command>
          <CommandInput placeholder={searchPlaceholder} className="h-9" />
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            <CommandGroup>
              {items.map((item) => (
                <CommandItem
                  key={item}
                  value={item}
                  onSelect={() => {
                    onChange(value === item ? "" : item)
                    setOpen(false)
                  }}
                >
                  {item == "No Label" ? <i>{item}</i> : item}
                  <Check
                    className={cn(
                      "ml-auto h-4 w-4 text-primary",
                      value === item ? "opacity-100" : "opacity-0"
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
