// Sales & Finance reporting for a company with data sources on. Its reports are read from the
// company's own spreadsheets and QuickBooks, never typed in by hand, so until those sources are
// defined each card says what it is waiting on and shows no figure.
import { Link } from "react-router-dom";
import ScaffoldCard from "../../components/scaffold/ScaffoldCard.tsx";
import PageHeader from "../../components/ui/PageHeader.tsx";
import Tabs from "../../components/ui/Tabs.tsx";
import { useHub } from "../../context/HubContext.tsx";
import { SALES_FINANCE_TABS } from "./salesFinanceTabs.ts";

export default function SalesFinancePage() {
  const { company } = useHub();

  const salesReporting = (
    <ScaffoldCard
      eyebrow="Sales & Finance"
      title="Sales reporting"
      pending={["The spreadsheet and tab that hold sales reporting", "The fields to show, their types and the reporting period"]}
    />
  );
  const financialReporting = (
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
      <div className="grid gap-4 lg:grid-cols-2">
        {salesReporting}
        {financialReporting}
      </div>
      <p className="mt-4 text-[12.5px] text-ink-2">
        The manual <Link to="/financials" className="text-accent hover:underline">Financials</Link> and{" "}
        <Link to="/marketing" className="text-accent hover:underline">Marketing</Link> pages sit in this section too.
      </p>
    </>
  );
}
