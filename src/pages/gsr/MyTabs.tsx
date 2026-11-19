// The GSR, Reviews, Goals tab row for a person's own pages, shown only to someone whose sidebar
// does not already list those pages (an admin's sidebar holds just My GSR). Whether it shows is
// asked of the sidebar registry itself, so the page and the sidebar cannot disagree.
import Tabs from "../../components/ui/Tabs.tsx";
import { useHub } from "../../context/HubContext.tsx";
import { navFor, sidebarListsMyPages } from "../../lib/navigation.ts";
import { MY_TABS } from "./myTabItems.ts";

export default function MyTabs() {
  const { company, isAdmin, isRococo, isLead, can } = useHub();
  if (company && sidebarListsMyPages(navFor(company, isAdmin, isRococo, isLead, can))) return null;
  return <Tabs items={MY_TABS} />;
}
