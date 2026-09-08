// Tab strip shared by the employee's own GSR pages (Reviews, Goals). Kept out of the page
// files so each of them exports only its component, which Fast Refresh relies on.
export const MY_TABS = [
  { to: "/my", label: "Reviews", end: true },
  { to: "/my/goals", label: "Goals" },
];
