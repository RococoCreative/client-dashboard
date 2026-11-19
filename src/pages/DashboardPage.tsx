// The front door. Admins see the state of every module for their company at a glance
// (components/home/AdminHome.tsx); employees and managers see their own GSR, goals, scores and what
// changed (components/home/EmployeeHome.tsx). Both see the modules their own job role carries, so
// an owner placed in a role gets what the person page says they get, and a retired role carries
// nothing. Everything here is a summary with a link into the module that owns it.
import AdminHome from "../components/home/AdminHome.tsx";
import EmployeeHome from "../components/home/EmployeeHome.tsx";
import { useHub } from "../context/HubContext.tsx";

export default function DashboardPage() {
  const { company, isAdmin } = useHub();
  // A Rococo admin with no company active is on the portfolio; the router never lands here.
  if (!company) return null;
  return isAdmin ? <AdminHome /> : <EmployeeHome />;
}
