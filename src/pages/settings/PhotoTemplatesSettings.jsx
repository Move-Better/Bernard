import PhotoTemplates from '@/components/PhotoTemplates'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

export default function PhotoTemplatesSettings() {
  useDocumentTitle('Photo Templates')
  return <PhotoTemplates />
}
