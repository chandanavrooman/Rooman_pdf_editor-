/**
 * TOOL REGISTRY — the single source of truth for every tool in Rooman PDF.
 *
 * To add or ship a tool:
 *  1. add/modify its entry here (status: 'planned' -> 'available'),
 *  2. add its page component to `src/tools/index.ts` (toolComponents[id]).
 * The router, landing directory, related-tool suggestions and search are all generated from this list.
 */
export type ToolCategory = 'organize' | 'edit' | 'from-pdf' | 'to-pdf' | 'optimize' | 'security' | 'sign' | 'ai'

export interface ToolMeta {
  id: string
  name: string
  description: string
  category: ToolCategory
  /** 'browser' = file never leaves the device. 'server' = file is uploaded to the FastAPI backend. */
  runsIn: 'browser' | 'server'
  route: string
  /** 'available' = implemented and working. 'planned' = listed honestly, page shows "not available yet". */
  status: 'available' | 'planned'
  /** lucide icon key, see components/ToolIcon.tsx */
  icon: string
  /** ids of related tools suggested on the result page */
  related: string[]
  keywords: string[]
}

export const CATEGORIES: { id: ToolCategory; label: string; blurb: string }[] = [
  { id: 'organize', label: 'Organize', blurb: 'Merge, split, reorder and tidy pages' },
  { id: 'edit', label: 'Edit', blurb: 'Annotate, fill and change content' },
  { id: 'from-pdf', label: 'Convert from PDF', blurb: 'Turn PDFs into other formats' },
  { id: 'to-pdf', label: 'Convert to PDF', blurb: 'Make PDFs from other files' },
  { id: 'optimize', label: 'Optimize', blurb: 'Shrink, repair, scan and clean' },
  { id: 'security', label: 'Security', blurb: 'Protect, unlock and sanitize' },
  { id: 'sign', label: 'Sign', blurb: 'Add your signature' },
  { id: 'ai', label: 'AI assistant', blurb: 'Chat with and understand documents' },
]

const t = (m: Omit<ToolMeta, 'route' | 'related' | 'keywords' | 'status'> & Partial<Pick<ToolMeta, 'related' | 'keywords' | 'status'>> & { route?: string }): ToolMeta => ({
  related: [],
  keywords: [],
  status: 'planned',
  route: m.route ?? `/${m.id}`,
  ...m,
})

export const TOOLS: ToolMeta[] = [
  // ───────── Organize (browser)
  t({ id: 'merge-pdf', name: 'Merge PDF', description: 'Combine several PDFs into one, in the order you choose.', category: 'organize', runsIn: 'browser', icon: 'merge', status: 'available', related: ['reorder-pages', 'add-page-numbers', 'compress-pdf', 'split-pdf', 'edit-pdf'], keywords: ['combine', 'join', 'append'] }),
  t({ id: 'split-pdf', name: 'Split PDF', description: 'Split by page ranges, every N pages, bookmarks or maximum file size.', category: 'organize', runsIn: 'browser', icon: 'split', status: 'available', related: ['extract-pages', 'merge-pdf', 'compress-pdf', 'edit-pdf'], keywords: ['separate', 'divide', 'chapters', 'bookmarks'] }),
  t({ id: 'alternate-mix', name: 'Alternate & Mix', description: 'Combine two PDFs by taking pages from each in turn (page 1 of A, page 1 of B, page 2 of A ...).', category: 'organize', runsIn: 'browser', icon: 'merge', status: 'available', related: ['merge-pdf', 'reorder-pages', 'compress-pdf'], keywords: ['interleave', 'collate', 'front and back', 'duplex', 'scan'] }),
  t({ id: 'split-half', name: 'Split in half', description: 'Cut every page into two: left and right, or top and bottom.', category: 'organize', runsIn: 'browser', icon: 'split', status: 'available', related: ['split-pdf', 'crop-pdf', 'reorder-pages'], keywords: ['book', 'spread', 'two pages', 'scan', 'cut'] }),
  t({ id: 'flip-pdf', name: 'Flip PDF', description: 'Mirror pages left to right or top to bottom.', category: 'organize', runsIn: 'browser', icon: 'rotate', status: 'available', related: ['rotate-pdf', 'crop-pdf', 'reorder-pages'], keywords: ['mirror', 'reverse'] }),
  t({ id: 'create-bookmarks', name: 'Create bookmarks', description: 'Type a list of titles and pages to add a clickable table of contents (bookmarks) to the PDF.', category: 'organize', runsIn: 'browser', icon: 'hash', status: 'available', related: ['split-pdf', 'add-page-numbers', 'merge-pdf'], keywords: ['outline', 'table of contents', 'toc', 'chapters', 'navigation'] }),
  t({ id: 'rename-pdf', name: 'Rename PDF', description: 'Give PDF files new names from their title, their first line of text, or a pattern.', category: 'organize', runsIn: 'browser', icon: 'edit', status: 'available', related: ['merge-pdf', 'metadata-pdf', 'compress-pdf'], keywords: ['file name', 'batch rename', 'title'] }),
  t({ id: 'workflow', name: 'Workflows', description: 'Chain several steps (rotate, flip, split, delete pages, remove annotations, grayscale) and run them on a PDF in one go.', category: 'organize', runsIn: 'browser', icon: 'layers', status: 'available', related: ['rotate-pdf', 'flip-pdf', 'split-half'], keywords: ['automate', 'batch', 'chain', 'pipeline', 'macro'] }),
  t({ id: 'extract-pages', name: 'Extract pages', description: 'Pull selected pages out into a new PDF.', category: 'organize', runsIn: 'browser', icon: 'extract', status: 'available', related: ['reorder-pages', 'merge-pdf', 'compress-pdf', 'edit-pdf'], keywords: ['select', 'pick', 'keep'] }),
  t({ id: 'delete-pages', name: 'Delete pages', description: 'Remove pages you do not need.', category: 'organize', runsIn: 'browser', icon: 'trash', status: 'available', related: ['reorder-pages', 'compress-pdf', 'add-page-numbers', 'edit-pdf'], keywords: ['remove', 'erase'] }),
  t({ id: 'rotate-pdf', name: 'Rotate PDF', description: 'Rotate all pages or just the ones you pick.', category: 'organize', runsIn: 'browser', icon: 'rotate', status: 'available', related: ['reorder-pages', 'crop-pdf', 'compress-pdf', 'edit-pdf'], keywords: ['turn', 'sideways', 'landscape', 'portrait'] }),
  t({ id: 'reorder-pages', name: 'Reorder pages', description: 'Drag page thumbnails into a new order.', category: 'organize', runsIn: 'browser', icon: 'reorder', status: 'available', related: ['delete-pages', 'add-page-numbers', 'merge-pdf', 'edit-pdf'], keywords: ['organize', 'rearrange', 'sort', 'move'] }),
  t({ id: 'crop-pdf', name: 'Crop PDF', description: 'Trim margins visually or with exact values.', category: 'organize', runsIn: 'browser', icon: 'crop', status: 'available', related: ['resize-pages', 'rotate-pdf', 'compress-pdf', 'edit-pdf'], keywords: ['trim', 'margins'] }),
  t({ id: 'resize-pages', name: 'Resize pages', description: 'Change the paper size (A0 to A6, Letter, Legal, Tabloid or a custom size) for all pages or only the ones you pick.', category: 'organize', runsIn: 'browser', icon: 'resize', status: 'available', related: ['crop-pdf', 'n-up', 'compress-pdf', 'edit-pdf'], keywords: ['page size', 'a4', 'letter', 'scale'] }),
  t({ id: 'page-margins', name: 'Add margins', description: 'Add white margins (the same on all sides or set per side): the page size stays, the content is scaled to fit and centred.', category: 'organize', runsIn: 'browser', icon: 'resize', status: 'available', related: ['crop-pdf', 'resize-pages', 'page-border', 'edit-pdf'], keywords: ['margin', 'padding', 'white space', 'scale to fit'] }),
  t({ id: 'page-border', name: 'Page border', description: 'Draw a border around every page: inset, thickness, color, solid or dashed.', category: 'organize', runsIn: 'browser', icon: 'stamp', status: 'available', related: ['page-margins', 'headers-footers', 'watermark-pdf', 'edit-pdf'], keywords: ['frame', 'outline', 'rectangle', 'box'] }),
  t({ id: 'n-up', name: 'N-up (pages per sheet)', description: 'Print 2, 4, 6 or 9 pages on each sheet.', category: 'organize', runsIn: 'browser', icon: 'grid', status: 'available', related: ['resize-pages', 'add-page-numbers', 'compress-pdf'], keywords: ['booklet', 'handout', 'multiple pages', 'imposition'] }),
  t({ id: 'add-page-numbers', name: 'Add page numbers', description: 'Number pages with the format, position and start you want.', category: 'organize', runsIn: 'browser', icon: 'hash', status: 'available', related: ['headers-footers', 'bates-numbering', 'compress-pdf', 'edit-pdf'], keywords: ['pagination', 'numbering'] }),
  t({ id: 'headers-footers', name: 'Headers & footers', description: 'Add running text with {page}, {pages}, {date} and {filename}.', category: 'organize', runsIn: 'browser', icon: 'header', status: 'available', related: ['add-page-numbers', 'bates-numbering', 'watermark-pdf', 'edit-pdf'], keywords: ['header', 'footer', 'running text'] }),
  t({ id: 'bates-numbering', name: 'Bates numbering', description: 'Stamp unique, sequential identifiers across one or many PDFs.', category: 'organize', runsIn: 'browser', icon: 'stamp', status: 'available', related: ['add-page-numbers', 'merge-pdf'], keywords: ['legal', 'discovery', 'sequential'] }),

  // ───────── Edit
  t({ id: 'edit-pdf', route: '/edit', name: 'Edit PDF', description: 'Add text, whiteout, shapes, highlights, drawings, images, links and form fields.', category: 'edit', runsIn: 'browser', icon: 'edit', status: 'available', related: ['sign-pdf', 'compress-pdf', 'protect-pdf'], keywords: ['annotate', 'text', 'whiteout', 'highlight', 'underline', 'strikethrough', 'draw', 'image', 'link', 'form', 'fill'] }),
  t({ id: 'remove-annotations', name: 'Remove annotations', description: 'Strip comments, highlights, drawings and links from the PDF.', category: 'edit', runsIn: 'browser', icon: 'trash', status: 'available', related: ['flatten-pdf', 'edit-pdf', 'compress-pdf'], keywords: ['comments', 'markup', 'highlights', 'clean', 'sticky notes', 'links'] }),
  t({ id: 'fill-form', name: 'Fill forms', description: 'Fill in form fields and add form elements.', category: 'edit', runsIn: 'browser', icon: 'form', status: 'available', related: ['sign-pdf', 'flatten-pdf'], keywords: ['form', 'fields', 'acroform'] }),

  // ───────── Convert from PDF
  t({ id: 'extract-images', name: 'Extract images', description: 'Save every picture inside a PDF as a PNG file.', category: 'from-pdf', runsIn: 'browser', icon: 'image', status: 'available', related: ['pdf-to-jpg', 'pdf-to-png', 'compress-pdf'], keywords: ['pictures', 'photos', 'save images', 'png'] }),
  t({ id: 'pdf-to-word', name: 'PDF to Word', description: 'Layout-preserving .docx with tables, fonts and colors.', category: 'from-pdf', runsIn: 'server', icon: 'word', status: 'available', related: ['pdf-to-excel', 'ocr-pdf', 'compress-pdf'], keywords: ['docx', 'doc'] }),
  t({ id: 'pdf-to-excel', name: 'PDF to Excel', description: 'Extract tables into an .xlsx workbook.', category: 'from-pdf', runsIn: 'server', icon: 'excel', status: 'available', related: ['pdf-to-word', 'extract-tables'], keywords: ['xlsx', 'spreadsheet', 'tables'] }),
  t({ id: 'pdf-to-powerpoint', name: 'PDF to PowerPoint', description: 'Turn pages into editable slides.', category: 'from-pdf', runsIn: 'server', icon: 'ppt', status: 'available', related: ['pdf-to-word', 'pdf-to-jpg'], keywords: ['pptx', 'slides'] }),
  t({ id: 'pdf-to-jpg', name: 'PDF to JPG', description: 'Export each page as a JPG image.', category: 'from-pdf', runsIn: 'server', icon: 'image', status: 'available', related: ['pdf-to-png', 'jpg-to-pdf'], keywords: ['jpeg', 'image', 'picture'] }),
  t({ id: 'pdf-to-png', name: 'PDF to PNG', description: 'Export each page as a lossless PNG image.', category: 'from-pdf', runsIn: 'server', icon: 'image', status: 'available', related: ['pdf-to-jpg', 'png-to-pdf'], keywords: ['image', 'picture'] }),
  t({ id: 'pdf-to-text', name: 'PDF to text', description: 'Extract the text of a PDF into a .txt file.', category: 'from-pdf', runsIn: 'server', icon: 'text', status: 'available', related: ['ocr-pdf', 'summarize-pdf'], keywords: ['txt', 'extract text'] }),

  // ───────── Convert to PDF
  t({ id: 'word-to-pdf', name: 'Word to PDF', description: 'Convert .docx documents to PDF (LibreOffice on the server).', category: 'to-pdf', runsIn: 'server', icon: 'word', status: 'available', related: ['compress-pdf', 'protect-pdf'], keywords: ['docx', 'doc'] }),
  t({ id: 'excel-to-pdf', name: 'Excel to PDF', description: 'Convert .xlsx workbooks to PDF (LibreOffice on the server).', category: 'to-pdf', runsIn: 'server', icon: 'excel', status: 'available', related: ['compress-pdf', 'protect-pdf'], keywords: ['xlsx', 'spreadsheet'] }),
  t({ id: 'html-to-pdf', name: 'HTML to PDF', description: 'Turn an .html file into a PDF (images and styles inside the file are kept; scripts and web links are not run).', category: 'to-pdf', runsIn: 'server', icon: 'text', status: 'available', related: ['compress-pdf', 'add-page-numbers', 'merge-pdf'], keywords: ['web page', 'html', 'htm', 'webpage', 'print'] }),
  t({ id: 'powerpoint-to-pdf', name: 'PowerPoint to PDF', description: 'Convert .pptx decks to PDF (LibreOffice on the server).', category: 'to-pdf', runsIn: 'server', icon: 'ppt', status: 'available', related: ['compress-pdf', 'n-up'], keywords: ['pptx', 'slides'] }),
  t({ id: 'jpg-to-pdf', name: 'JPG to PDF', description: 'Combine JPG images into a PDF.', category: 'to-pdf', runsIn: 'server', icon: 'image', status: 'available', related: ['merge-pdf', 'ocr-pdf', 'compress-pdf'], keywords: ['jpeg', 'image', 'photo'] }),
  t({ id: 'png-to-pdf', name: 'PNG to PDF', description: 'Combine PNG images into a PDF.', category: 'to-pdf', runsIn: 'server', icon: 'image', status: 'available', related: ['merge-pdf', 'ocr-pdf', 'compress-pdf'], keywords: ['image', 'picture'] }),
  t({ id: 'text-to-pdf', name: 'Text to PDF', description: 'Turn a plain-text file into a PDF.', category: 'to-pdf', runsIn: 'server', icon: 'text', status: 'available', related: ['add-page-numbers', 'compress-pdf'], keywords: ['txt'] }),

  // ───────── Optimize
  t({ id: 'grayscale-pdf', name: 'Grayscale PDF', description: 'Turn a colour PDF into shades of gray, for printing or a smaller file.', category: 'optimize', runsIn: 'browser', icon: 'layers', status: 'available', related: ['compress-pdf', 'ocr-pdf', 'flatten-pdf'], keywords: ['black and white', 'gray', 'grey', 'monochrome', 'print'] }),
  t({ id: 'compress-pdf', name: 'Compress PDF', description: 'Reduce file size with low, medium or high compression.', category: 'optimize', runsIn: 'server', icon: 'compress', status: 'available', related: ['protect-pdf', 'merge-pdf', 'split-pdf'], keywords: ['reduce', 'shrink', 'smaller', 'size', 'ghostscript'] }),
  t({ id: 'repair-pdf', name: 'Repair PDF', description: 'Recover content from a damaged PDF.', category: 'optimize', runsIn: 'server', icon: 'wrench', status: 'available', related: ['compress-pdf', 'ocr-pdf'], keywords: ['fix', 'corrupt', 'broken'] }),
  t({ id: 'flatten-pdf', name: 'Flatten PDF', description: 'Bake form fields and annotations into the page.', category: 'optimize', runsIn: 'server', icon: 'layers', status: 'available', related: ['protect-pdf', 'compress-pdf'], keywords: ['forms', 'annotations'] }),
  t({ id: 'ocr-pdf', name: 'OCR (searchable PDF)', description: 'Add a text layer to scanned PDFs so they can be searched and copied.', category: 'optimize', runsIn: 'server', icon: 'scan', status: 'available', related: ['deskew-pdf', 'pdf-to-word', 'compress-pdf', 'edit-pdf'], keywords: ['scan', 'tesseract', 'searchable', 'text recognition'] }),
  t({ id: 'deskew-pdf', name: 'Deskew PDF', description: 'Straighten crooked scanned pages.', category: 'optimize', runsIn: 'server', icon: 'straighten', status: 'available', related: ['ocr-pdf', 'compress-pdf'], keywords: ['straighten', 'scan', 'tilt'] }),

  // ───────── Security
  t({ id: 'protect-pdf', name: 'Protect PDF', description: 'Encrypt a PDF with a password.', category: 'security', runsIn: 'server', icon: 'lock', status: 'available', related: ['compress-pdf', 'watermark-pdf'], keywords: ['password', 'encrypt'] }),
  t({ id: 'unlock-pdf', name: 'Unlock PDF', description: 'Remove a password you know from a PDF.', category: 'security', runsIn: 'server', icon: 'unlock', status: 'available', related: ['merge-pdf', 'compress-pdf'], keywords: ['decrypt', 'remove password'] }),
  t({ id: 'watermark-pdf', name: 'Watermark PDF', description: 'Stamp text or an image across your pages.', category: 'security', runsIn: 'server', icon: 'droplet', status: 'available', related: ['protect-pdf', 'add-page-numbers'], keywords: ['stamp', 'confidential', 'draft'] }),
  t({ id: 'metadata-pdf', name: 'Edit metadata', description: 'View and edit title, author, subject and keywords.', category: 'security', runsIn: 'server', icon: 'info', status: 'available', related: ['protect-pdf', 'compress-pdf'], keywords: ['properties', 'author', 'title'] }),

  // ───────── Sign
  t({ id: 'sign-pdf', name: 'Sign PDF', description: 'Draw, type or upload a signature, then place and resize it.', category: 'sign', runsIn: 'browser', icon: 'sign', status: 'available', related: ['protect-pdf', 'compress-pdf', 'flatten-pdf'], keywords: ['signature', 'esign', 'initials'] }),

  // ───────── AI
  t({ id: 'ai-assistant', route: '/ai-assistant', name: 'AI PDF Assistant', description: 'One assistant for all your PDFs: tell it in plain words to summarize, translate, explain, write questions, compare documents, extract tables or edit pages.', category: 'ai', runsIn: 'server', icon: 'sparkles', status: 'available', related: ['chat-pdf', 'summarize-pdf', 'generate-questions'], keywords: ['ai', 'assistant', 'chatgpt', 'llm', 'workspace', 'ask'] }),
  t({ id: 'chat-pdf', route: '/ai-chat', name: 'Chat with PDF', description: 'Chat about your PDF with page citations — or tell the assistant to merge, split, compress, rotate and more.', category: 'ai', runsIn: 'server', icon: 'chat', status: 'available', related: ['summarize-pdf', 'explain-pdf'], keywords: ['ask', 'question', 'assistant', 'ai'] }),
  t({ id: 'ask-pdf', name: 'Ask questions', description: 'Ask a question about one or more documents and get an answer with page citations.', category: 'ai', runsIn: 'server', icon: 'chat', status: 'available', related: ['chat-pdf', 'summarize-pdf', 'explain-pdf'], keywords: ['question', 'answer', 'citations', 'ai'] }),
  t({ id: 'summarize-pdf', name: 'Summarize PDF', description: 'Get a concise summary of a long document.', category: 'ai', runsIn: 'server', icon: 'sparkles', status: 'available', related: ['chat-pdf', 'translate-pdf'], keywords: ['tl;dr', 'ai'] }),
  t({ id: 'translate-pdf', name: 'Translate PDF', description: 'Translate a document into another language.', category: 'ai', runsIn: 'server', icon: 'language', status: 'available', related: ['summarize-pdf', 'chat-pdf'], keywords: ['language', 'ai'] }),
  t({ id: 'generate-questions', name: 'Generate questions', description: 'Create multiple-choice, short, long and true-or-false questions from a document, with or without answers.', category: 'ai', runsIn: 'server', icon: 'lightbulb', status: 'available', related: ['summarize-pdf', 'ask-pdf', 'chat-pdf'], keywords: ['quiz', 'exam', 'mcq', 'practice', 'test', 'worksheet', 'ai'] }),
  t({ id: 'explain-pdf', name: 'Explain PDF', description: 'Get plain-language explanations of difficult passages.', category: 'ai', runsIn: 'server', icon: 'lightbulb', status: 'available', related: ['chat-pdf', 'summarize-pdf'], keywords: ['simplify', 'ai'] }),
  t({ id: 'extract-tables', name: 'Extract tables to Excel', description: 'Find the tables in a PDF and download them as .xlsx.', category: 'ai', runsIn: 'server', icon: 'excel', status: 'available', related: ['pdf-to-excel', 'chat-pdf'], keywords: ['table', 'spreadsheet', 'ai'] }),
  t({ id: 'compare-pdf', name: 'Compare documents', description: 'See what changed between two PDFs.', category: 'ai', runsIn: 'server', icon: 'compare', status: 'available', related: ['chat-pdf', 'summarize-pdf'], keywords: ['diff', 'changes', 'ai'] }),
]

export const toolById = (id: string): ToolMeta | undefined => TOOLS.find((x) => x.id === id)

export function searchTools(query: string, list: ToolMeta[] = TOOLS): ToolMeta[] {
  const q = query.trim().toLowerCase()
  if (!q) return list
  const words = q.split(/\s+/)
  return list.filter((tool) => {
    const hay = `${tool.name} ${tool.description} ${tool.keywords.join(' ')} ${tool.category}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}
