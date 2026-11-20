import { EditorPage } from '@/editor/EditorPage'
import type { ToolPage } from './shared/types'

const FillFormTool: ToolPage = ({ tool }) => <EditorPage tool={tool} mode="fill" />
export default FillFormTool
