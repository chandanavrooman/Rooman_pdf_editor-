import type { ComponentType } from 'react'
import type { ToolMeta } from '@/lib/tools'

export type ToolPage = ComponentType<{ tool: ToolMeta }>

export const PDF_MIME = 'application/pdf'
