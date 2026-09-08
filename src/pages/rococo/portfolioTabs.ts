// Tab strip shared by the Rococo portfolio pages (Portfolio, Companies, People). Kept out of
// the page files so each of them exports only its component, which Fast Refresh relies on.
export const PORTFOLIO_TABS = [
  { to: "/rococo", label: "Portfolio", end: true },
  { to: "/rococo/companies", label: "Companies" },
  { to: "/rococo/people", label: "People" },
];
