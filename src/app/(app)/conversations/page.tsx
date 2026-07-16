import { requireSection } from "@/lib/rbac";
import { ListHeader } from "@/components/ui/ListHeader";
import { Tabs } from "@/components/ui/Tabs";
import { getInboxThreads, getThread, getTemplates, getMessagingSettings, getAssignableUsers } from "@/server/messaging-metrics";
import Inbox from "./_components/Inbox";
import TemplatesPanel from "./_components/TemplatesPanel";
import ChannelSettings from "./_components/ChannelSettings";

export const dynamic = "force-dynamic";

export default async function ConversationsPage({ searchParams }: { searchParams: { contact?: string } }) {
  await requireSection("conversations");
  const [threads, templates, settings, users] = await Promise.all([
    getInboxThreads(),
    getTemplates(),
    getMessagingSettings(),
    getAssignableUsers(),
  ]);
  const activeId = searchParams.contact || threads[0]?.leadId || null;
  const activeThread = activeId ? await getThread(activeId) : null;

  return (
    <div className="w-full space-y-4">
      <ListHeader title="Conversations" subtitle="unified inbox — Email, SMS & WhatsApp in one thread" />
      <Tabs
        tabs={[
          { label: "Inbox", content: <Inbox threads={threads} activeThread={activeThread} templates={templates} settings={settings} users={users} /> },
          { label: `Templates (${templates.length})`, content: <TemplatesPanel templates={templates} /> },
          { label: "Settings", content: <ChannelSettings settings={settings} /> },
        ]}
      />
    </div>
  );
}
