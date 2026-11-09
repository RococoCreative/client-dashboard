// Controls for a company with data sources on: invoice, payment and balance checks read from
// QuickBooks. Which controls to show and the rules behind them are not agreed yet, so the page
// says what it is waiting on and shows no figure.
import ScaffoldCard from "../../components/scaffold/ScaffoldCard.tsx";
import PageHeader from "../../components/ui/PageHeader.tsx";
import Tabs from "../../components/ui/Tabs.tsx";
import { useHub } from "../../context/HubContext.tsx";
import { SALES_FINANCE_TABS } from "./salesFinanceTabs.ts";

export default function ControlsPage() {
  const { company } = useHub();

  const quickBooksControls = (
    <ScaffoldCard
      eyebrow="Sales & Finance"
      title="QuickBooks controls"
      pending={[
        "Which controls to show: cash in and out, invoices, payments and collections, outstanding balances",
        "The fields for each, and what they mean",
        "Rules such as aging and follow-up, once agreed",
      ]}
    />
  );

  return (
    <>
      <PageHeader eyebrow={company!.name} title="Controls" description="Invoice, payment and balance checks from QuickBooks, read-only." />
      <Tabs items={SALES_FINANCE_TABS} />
      {quickBooksControls}
    </>
  );
}
