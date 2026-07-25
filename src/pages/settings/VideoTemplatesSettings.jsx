import VideoTemplates from '@/components/VideoTemplates'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

export default function VideoTemplatesSettings() {
  useDocumentTitle('Reel Templates')
  return <VideoTemplates />
}
