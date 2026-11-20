import {
  AlignVerticalDistributeCenter, ArrowUpDown, Combine, Crop, Droplets, FileOutput, FileSpreadsheet, FileText, FormInput, Hash, Image,
  Info, Languages, Layers, LayoutGrid, Lightbulb, Lock, LockOpen, MessageSquare, Minimize2, PanelTop, PenLine, PenTool, Presentation,
  RotateCw, ScanText, Scaling, Sparkles, Split, Stamp, Trash2, Wrench, GitCompare, type LucideIcon,
} from 'lucide-react'

const ICONS: Record<string, LucideIcon> = {
  merge: Combine, split: Split, extract: FileOutput, trash: Trash2, rotate: RotateCw, reorder: ArrowUpDown, crop: Crop, resize: Scaling,
  grid: LayoutGrid, hash: Hash, header: PanelTop, stamp: Stamp, edit: PenLine, form: FormInput, word: FileText, excel: FileSpreadsheet,
  ppt: Presentation, image: Image, text: FileText, compress: Minimize2, wrench: Wrench, layers: Layers, scan: ScanText,
  straighten: AlignVerticalDistributeCenter, lock: Lock, unlock: LockOpen, droplet: Droplets, info: Info, sign: PenTool,
  chat: MessageSquare, sparkles: Sparkles, compare: GitCompare, language: Languages, lightbulb: Lightbulb,
}

export function ToolIcon({ name, className = 'h-5 w-5' }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? FileText
  return <Icon className={className} aria-hidden="true" />
}
