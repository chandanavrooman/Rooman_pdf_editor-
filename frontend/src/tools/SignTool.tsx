import { EditorPage } from '@/editor/EditorPage'
import type { ToolPage } from './shared/types'

const SignTool: ToolPage = ({ tool }) => <EditorPage tool={tool} mode="sign" />
export default SignTool
