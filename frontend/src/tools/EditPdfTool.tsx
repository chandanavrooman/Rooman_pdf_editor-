import { EditorPage } from '@/editor/EditorPage'
import type { ToolPage } from './shared/types'

const EditPdfTool: ToolPage = ({ tool }) => <EditorPage tool={tool} mode="edit" />
export default EditPdfTool
