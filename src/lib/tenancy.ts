// One rule for every page that loads a record by the id in its URL: a record belonging to
// another company is not found, whatever RLS would have allowed.
//
// This matters because of the two people RLS deliberately lets read widely. A Rococo admin can
// read all three companies, and the sidebar company switcher changes the active company without
// navigating, so an open detail page re-renders with a new company and the same id. Without
// this check the previous tenant's cycle, review, or SOP keeps rendering under the new tenant's
// branding, with its actions live. The wall is still RLS; this is the page telling the truth
// about which company it is showing.
export function assertInCompany<T extends { company_id: string }>(record: T, companyId: string, noun: string): T {
  if (record.company_id !== companyId) throw new Error(`That ${noun} is not in this company.`);
  return record;
}
