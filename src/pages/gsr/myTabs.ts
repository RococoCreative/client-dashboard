// Tab strip shared by the employee's own pages: this month's GSR, the scored reviews, the
// year's goals. Kept out of the page files so each of them exports only its component, which
// Fast Refresh relies on.
export const MY_TABS = [
  { to: "/my/gsr", label: "GSR" },
  { to: "/my/reviews", label: "Reviews" },
  { to: "/my/goals", label: "Goals" },
];
