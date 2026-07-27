import { PageHeader } from '@/components/page-header'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { getSettings } from '@/lib/queries/settings'

import { SettingsForm } from './settings-form'

export default async function SettingsPage() {
  const settings = await getSettings()

  return (
    <>
      <PageHeader
        title="Settings"
        description="How Jarvis behaves when you're not asking."
      />
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Jarvis alerts</CardTitle>
          <CardDescription>
            The proactive side of the Telegram bot — when it messages you first,
            and what it looks at.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SettingsForm initial={settings} />
        </CardContent>
      </Card>
    </>
  )
}
