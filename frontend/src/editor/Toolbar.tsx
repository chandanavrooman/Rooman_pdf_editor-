import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowUpRight,
  ChevronDown,
  ChevronDownSquare,
  Circle,
  CircleDot,
  CheckSquare,
  Eraser,
  Highlighter,
  ImageOff,
  ImagePlus,
  Link2,
  Minus,
  MousePointer2,
  Pencil,
  PenLine,
  Redo2,
  Square,
  Strikethrough,
  Table2,
  TextCursorInput,
  Type,
  Underline,
  Undo2,
  FormInput,
  PenTool,
  Shapes,
} from 'lucide-react'
import type { ToolId } from './EditorContext'

interface Props {
  tool: ToolId
  onTool: (t: ToolId) => void
  onImageFile: (f: File) => void
  onSign: () => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
}

interface Item {
  id: ToolId
  label: string
  icon: ReactNode
  hint: string
}

const I = {
  text: { id: 'text', label: 'Text', icon: <Type />, hint: 'Click existing text to edit it in place, or click on the page to add new text' } as Item,
  table: { id: 'table', label: 'Table', icon: <Table2 />, hint: 'Click or drag to insert a table; edit an existing table by hovering it' } as Item,
  fieldText: { id: 'field-text', label: 'Text field', icon: <TextCursorInput />, hint: 'Add an interactive, fillable text field' } as Item,
  fieldCheckbox: { id: 'field-checkbox', label: 'Checkbox', icon: <CheckSquare />, hint: 'Add an interactive checkbox' } as Item,
  fieldRadio: { id: 'field-radio', label: 'Radio', icon: <CircleDot />, hint: 'Add an interactive radio button (same group name = one choice)' } as Item,
  fieldDropdown: { id: 'field-dropdown', label: 'Dropdown', icon: <ChevronDownSquare />, hint: 'Add an interactive dropdown list' } as Item,
  highlight: { id: 'highlight', label: 'Highlight', icon: <Highlighter />, hint: 'Drag across text to highlight' } as Item,
  underline: { id: 'underline', label: 'Underline', icon: <Underline />, hint: 'Drag across text to underline' } as Item,
  strike: { id: 'strike', label: 'Strike', icon: <Strikethrough />, hint: 'Drag across text to strike through' } as Item,
  draw: { id: 'draw', label: 'Draw', icon: <Pencil />, hint: 'Freehand drawing' } as Item,
  rect: { id: 'rect', label: 'Rectangle', icon: <Square />, hint: 'Draw a rectangle' } as Item,
  ellipse: { id: 'ellipse', label: 'Ellipse', icon: <Circle />, hint: 'Draw an ellipse' } as Item,
  line: { id: 'line', label: 'Line', icon: <Minus />, hint: 'Draw a line (Shift = straight)' } as Item,
  newImage: { id: 'image', label: 'New image', icon: <ImagePlus />, hint: 'Add a PNG, JPG, SVG or WebP image from your computer' } as Item,
  deleteImage: { id: 'delete-image', label: 'Delete existing image', icon: <ImageOff />, hint: 'Click a picture that is already in the PDF to remove it' } as Item,
  arrow: { id: 'arrow', label: 'Arrow', icon: <ArrowUpRight />, hint: 'Draw an arrow' } as Item,
}

/** the tool groups behind a drop-down arrow, as in Sejda */
const MENUS: Record<'text' | 'forms' | 'images' | 'annotate' | 'shapes', { label: string; icon: ReactNode; items: Item[] }> = {
  text: { label: 'Text', icon: <Type />, items: [I.text, I.table] },
  forms: { label: 'Forms', icon: <FormInput />, items: [I.fieldText, I.fieldCheckbox, I.fieldRadio, I.fieldDropdown] },
  images: { label: 'Images', icon: <ImagePlus />, items: [I.newImage, I.deleteImage] },
  annotate: { label: 'Annotate', icon: <PenTool />, items: [I.highlight, I.underline, I.strike, I.draw] },
  shapes: { label: 'Shapes', icon: <Shapes />, items: [I.rect, I.ellipse, I.line, I.arrow] },
}

const btn = 'flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap px-3 text-sm font-medium transition disabled:opacity-40 [&>svg]:h-4 [&>svg]:w-4'
const idle = 'text-ink-700 hover:bg-ink-100 dark:text-ink-200 dark:hover:bg-ink-800'
const on = 'bg-brand-600 text-white dark:bg-brand-400 dark:text-ink-950'

export function ToolButton({ active, label, hint, onClick, children, disabled, testId }: { active?: boolean; label: string; hint?: string; onClick: () => void; children: ReactNode; disabled?: boolean; testId?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active === undefined ? undefined : active}
      aria-label={label}
      title={hint ? `${label} — ${hint}` : label}
      data-testid={testId}
      className={`${btn} ${active ? on : idle}`}
    >
      {children}
      <span>{label}</span>
    </button>
  )
}

/** a group with a drop-down list of tools; `main` (optional) is the tool its own button switches on */
function Menu({ name, main, tool, onTool }: { name: keyof typeof MENUS; main?: Item; tool: ToolId; onTool: (t: ToolId) => void }) {
  const m = MENUS[name]
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const activeIn = m.items.some((i) => i.id === tool)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [open])
  return (
    <div ref={root} className="relative flex" data-testid={`toolgroup-${name}`}>
      {main && (
        <button type="button" className={`${btn} ${tool === main.id ? on : idle}`} aria-pressed={tool === main.id} aria-label={main.label} title={`${main.label} — ${main.hint}`} data-testid={`tool-${main.id}`} onClick={() => { onTool(main.id); setOpen(false) }}>
          {main.icon}
          <span>{main.label}</span>
        </button>
      )}
      <button
        type="button"
        className={`${btn} ${main ? '!px-1.5' : ''} ${activeIn && (!main || tool !== main.id) ? on : idle}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={main ? `More ${m.label.toLowerCase()} tools` : m.label}
        data-testid={`toolmenu-${name}`}
        onClick={() => setOpen((v) => !v)}
      >
        {!main && m.icon}
        {!main && <span>{m.label}</span>}
        <ChevronDown className="!h-3.5 !w-3.5" aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" aria-label={m.label} className="absolute left-0 top-full z-30 mt-1 min-w-44 rounded-xl border border-ink-200 bg-white p-1 shadow-lg dark:border-ink-700 dark:bg-ink-900">
          {m.items.map((it) => (
            <button
              key={it.id}
              type="button"
              role="menuitem"
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium [&>svg]:h-4 [&>svg]:w-4 ${tool === it.id ? on : idle}`}
              aria-pressed={tool === it.id}
              title={it.hint}
              data-testid={`tool-${it.id}`}
              onClick={() => {
                onTool(it.id)
                setOpen(false)
              }}
            >
              {it.icon}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function Toolbar({ tool, onTool, onImageFile, onSign, canUndo, canRedo, onUndo, onRedo }: Props) {
  const file = useRef<HTMLInputElement>(null)
  const sep = <span className="w-px self-stretch bg-ink-200 dark:bg-ink-700" aria-hidden="true" />
  return (
    <div role="toolbar" aria-label="Editing tools" className="flex min-w-0 justify-center overflow-visible border-b border-ink-200 bg-ink-50 px-2 py-2.5 dark:border-ink-800 dark:bg-ink-900" data-testid="editor-toolbar">
      <div className="flex max-w-full flex-wrap items-stretch overflow-visible rounded-lg border border-ink-300 bg-white dark:border-ink-600 dark:bg-ink-900 [&>*:first-child]:rounded-l-lg [&>*:last-child]:rounded-r-lg">
        <ToolButton active={tool === 'select'} label="Select" hint="Select, move and resize; pick pictures of the page" onClick={() => onTool('select')} testId="tool-select">
          <MousePointer2 />
        </ToolButton>
        {sep}
        <Menu name="text" main={I.text} tool={tool} onTool={onTool} />
        {sep}
        <ToolButton active={tool === 'link'} label="Links" hint="Make an area clickable" onClick={() => onTool('link')} testId="tool-link">
          <Link2 />
        </ToolButton>
        {sep}
        <div data-testid="toolbar-form-fields" className="flex">
          <Menu name="forms" tool={tool} onTool={onTool} />
        </div>
        {sep}
        <Menu name="images" tool={tool} onTool={(t) => (t === 'image' ? file.current?.click() : onTool(t))} />
        {sep}
        <ToolButton active={tool === 'signature'} label="Sign" hint="Draw, type or upload a signature" onClick={onSign} testId="tool-signature">
          <PenLine />
        </ToolButton>
        {sep}
        <ToolButton active={tool === 'whiteout'} label="Whiteout" hint="Cover content with a white box" onClick={() => onTool('whiteout')} testId="tool-whiteout">
          <Eraser />
        </ToolButton>
        {sep}
        <Menu name="annotate" tool={tool} onTool={onTool} />
        {sep}
        <Menu name="shapes" tool={tool} onTool={onTool} />
        {sep}
        <ToolButton label="Undo" hint="Ctrl/Cmd+Z" onClick={onUndo} disabled={!canUndo} testId="undo">
          <Undo2 />
        </ToolButton>
        <ToolButton label="Redo" hint="Ctrl/Cmd+Shift+Z" onClick={onRedo} disabled={!canRedo} testId="redo">
          <Redo2 />
        </ToolButton>
      </div>
      <input
        ref={file}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg"
        className="sr-only"
        data-testid="image-input"
        aria-label="Choose an image to add"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onImageFile(f)
          e.target.value = ''
        }}
      />
    </div>
  )
}
