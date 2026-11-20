// Starting a GSR on demand, in one place, so My GSR and a person's GSR and goals tab start one the
// same way: startGsr starts today's GSR for the person (or hands back the one already started
// today), then the GSR's page opens. When the person already has two open the database starts
// nothing; the page then opens their newest open GSR, never a done one, with router state
// { atLimit: true } so it says which one to close first. That costs one extra read, at the limit
// only. When the person's GSR for today (the company's today) is already done, the start lands on
// it with { doneToday: true }, so the page says a new one can be started tomorrow. While a start
// is in flight busy holds the control still; a failure is a friendly line.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useHub } from "../../../context/HubContext.tsx";
import { currentGsr } from "../../../lib/gsr/onDemand.ts";
import { errorMessage } from "../../../lib/errors.ts";
import { companyToday } from "../../../lib/wins.ts";
import { listPersonGsrs, startGsr } from "../../../services/gsrOnDemand.ts";

export function useStartGsr(): { start: (employeeId: string) => Promise<void>; busy: boolean; error: string } {
  const { company } = useHub();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function start(employeeId: string) {
    if (busy || !company) return;
    setBusy(true);
    setError("");
    try {
      const { gsr, atLimit } = await startGsr(company.id, employeeId);
      const target = atLimit ? (currentGsr(await listPersonGsrs(company.id, employeeId)) ?? gsr) : gsr;
      // One GSR a person a day: a start on a day whose GSR is already done lands on that one, and
      // the page says so once.
      const doneToday = !atLimit && target.status === "complete" && target.started_on === companyToday(company.time_zone);
      navigate(`/gsr/reviews/${target.id}`, { state: { atLimit, doneToday } });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return { start, busy, error };
}
