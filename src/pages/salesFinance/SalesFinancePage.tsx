// Sales & Finance reporting for a company with data sources on. Its reports are read from the
// company's own spreadsheets and QuickBooks, never typed in by hand: each source that feeds a
// report shows its state and its read-only values, and until one is defined the card says what
// it is waiting on and shows no figure. Below them sit the company's links to its own outside
// tools for this section, when it keeps any.
import { Link } from "react-router-dom";
import ExternalLinksList from "../../components/links/ExternalLinksList.tsx";
import ScaffoldCard from "../../components/scaffold/ScaffoldCard.tsx";
import SourcePanel from "../../components/sync/SourcePanel.tsx";
import PageHeader from "../../components/ui/PageHeader.tsx";
import Tabs from "../../components/ui/Tabs.tsx";
import { useHub } from "../../context/HubContext.tsx";
import { hasModule } from "../../lib/modules.ts";
import { SALES_FINANCE_TABS } from "./salesFinanceTabs.ts";

export default function SalesFinancePage() {
  const { company } = useHub();

  const salesScaffold = (
    <ScaffoldCard
      eyebrow="Sales & Finance"
      title="Sales reporting"
      pending={["The spreadsheet and tab that hold sales reporting", "The fields to show, their types and the reporting period"]}
    />
  );
  const financialScaffold = (
    <ScaffoldCard
      eyebrow="Sales & Finance"
      title="Financial reporting"
      pending={["The spreadsheet, tab or QuickBooks report that holds it", "What each figure means, such as revenue and gross profit", "The reporting period convention"]}
    />
  );

  return (
    <>
      <PageHeader eyebrow={company!.name} title="Sales & Finance" description="Sales and financial reporting read from the company's own sources. Nothing here is typed in by hand." />
      <Tabs items={SALES_FINANCE_TABS} />
      <div className="space-y-6">
        <SourcePanel companyId={company!.id} targetModule="sales_reporting" scaffold={salesScaffold} />
        <SourcePanel companyId={company!.id} targetModule="financial_reporting" scaffold={financialScaffold} />
      </div>
      {hasModule(company!, "external_links") ? <ExternalLinksList companyId={company!.id} navGroup="sales_finance" /> : null}
      <p className="mt-4 text-[12.5px] text-ink-2">
        The manual <Link to="/financials" className="text-accent hover:underline">Financials</Link> and{" "}
        <Link to="/marketing" className="text-accent hover:underline">Marketing</Link> pages sit in this section too.
      </p>
    </>
  );
}
