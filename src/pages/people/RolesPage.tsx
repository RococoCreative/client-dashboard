// People, Roles: the company's job roles as a list, with one role open beside it holding everything
// about that role (RoleDetail). Each role has its own address, /people/roles/:roleId, so a link can
// land on one. On a wide screen the bare address opens the first active role, so the detail is never
// empty; on a phone it is the list alone. This page loads, routes and builds the list; the role's
// sections live in components/people.
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Plus } from "lucide-react";
import Button from "../../components/ui/Button.tsx";
import ListDetail, { type ListDetailItem } from "../../components/ui/ListDetail.tsx";
import Modal from "../../components/ui/Modal.tsx";
import Notice from "../../components/ui/Notice.tsx";
import SkeletonRows from "../../components/ui/SkeletonRows.tsx";
import { inputClass } from "../../components/ui/forms.ts";
import { secondaryClass, sectionTitleClass } from "../../components/ui/type.ts";
import PeopleHeader from "../../components/people/PeopleHeader.tsx";
import RoleDetail from "../../components/people/RoleDetail.tsx";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { createJobRole, listJobRoleGoals, listJobRoles } from "../../services/jobRoles.ts";
import { listDivisions } from "../../services/divisions.ts";
import { listCompanyProfiles } from "../../services/profiles.ts";
import { listRoleMetrics } from "../../services/scorecards.ts";
import { errorMessage } from "../../lib/errors.ts";
import { pluralize } from "../../lib/format.ts";
import type { JobRole } from "../../types/database.ts";

const BASE = "/people/roles";

// The list and detail sit side by side from lg up (ListDetail); only there does the bare address
// open a role. Without matchMedia (a test DOM) the screen counts as wide.
function isWide(): boolean {
  return typeof window.matchMedia !== "function" || window.matchMedia("(min-width: 1024px)").matches;
}

// The one add form for a role, in a dialog so it is never an always-open row.
function AddRoleDialog({ companyId, nextOrder, onAdded, onClose }: { companyId: string; nextOrder: number; onAdded: (role: JobRole) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = name.trim();
    if (!text || busy) return;
    setBusy(true);
    setError("");
    try {
      onAdded(await createJobRole({ company_id: companyId, name: text, sort_order: nextOrder }));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal onClose={() => (busy ? undefined : onClose())} labelledBy="add-role-title">
      <form onSubmit={(e) => void submit(e)} className="p-6">
        <h2 id="add-role-title" className={sectionTitleClass}>Add a job role</h2>
        <p className={`${secondaryClass} mt-1`}>Name it now; its modules, goals and metrics are set on the role once it is added.</p>
        <input type="text" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Add a job role" aria-label="Add a job role" className={`${inputClass} mt-4`} />
        {error ? <Notice tone="error" className="mt-4">{error}</Notice> : null}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" disabled={!name.trim() || busy}>Add role</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function RolesPage() {
  const { company } = useHub();
  const companyId = company!.id;
  const { roleId } = useParams();
  const navigate = useNavigate();
  const state = useAsync(async () => {
    const [roles, goals, people] = await Promise.all([listJobRoles(companyId, true), listJobRoleGoals(companyId), listCompanyProfiles(companyId)]);
    return { roles, goals, people };
  }, [companyId]);
  // The scorecard metrics and the divisions load on their own, so a failure there leaves the
  // roles workable: no metric counts, or no division beside a name.
  const metricState = useAsync(() => listRoleMetrics(companyId, true), [companyId]);
  const divisionState = useAsync(() => listDivisions(companyId), [companyId]);
  const [addingRole, setAddingRole] = useState(false);

  const roles = state.data?.roles ?? [];
  const firstRole = roles.find((r) => r.is_active) ?? roles[0];
  const firstId = state.data && !roleId ? firstRole?.id : undefined;
  useEffect(() => {
    if (firstId && isWide()) navigate(`${BASE}/${firstId}`, { replace: true });
  }, [firstId, navigate]);

  const header = <PeopleHeader tab="roles" />;
  if (state.error && !state.data) {
    return (
      <>
        {header}
        <Notice tone="error">{state.error}</Notice>
      </>
    );
  }
  if (!state.data) {
    return (
      <>
        {header}
        <SkeletonRows rows={6} />
      </>
    );
  }

  const { goals, people } = state.data;
  const metrics = metricState.data;
  const retiredCount = roles.filter((r) => !r.is_active).length;
  const items: ListDetailItem[] = roles.map((role) => {
    const holders = people.filter((p) => p.is_active && p.job_role_id === role.id).length;
    const facts = [pluralize(holders, "person", "people")];
    if (metrics) facts.push(pluralize(metrics.filter((m) => m.job_role_id === role.id && m.is_active).length, "metric"));
    return { id: role.id, title: role.name, meta: facts.join(" · "), muted: !role.is_active, group: role.is_active ? undefined : `Retired roles (${retiredCount})` };
  });
  const role = roleId ? roles.find((r) => r.id === roleId) : undefined;
  const setData = state.setData;

  return (
    <>
      {header}
      <ListDetail
        label="Job roles"
        items={items}
        selectedId={roleId ?? null}
        hrefFor={(id) => `${BASE}/${id}`}
        backHref={BASE}
        countLabel={pluralize(roles.length, "role")}
        searchLabel={roles.length > 0 ? "Search roles" : undefined}
        actions={
          <Button variant="secondary" size="sm" onClick={() => setAddingRole(true)}>
            <Plus size={14} aria-hidden /> Add role
          </Button>
        }
        footer={roles.length === 0 ? <p className={secondaryClass}>No job roles yet. Add one, then put people in it here or from their profiles.</p> : undefined}
      >
        {role ? (
          <RoleDetail
            key={role.id}
            role={role}
            goals={goals.filter((g) => g.job_role_id === role.id)}
            metrics={metrics}
            metricsError={metricState.error}
            people={people}
            divisions={divisionState.data ?? []}
            onRole={(next) => setData((prev) => (prev ? { ...prev, roles: prev.roles.map((r) => (r.id === next.id ? next : r)) } : prev))}
            onGoals={(update) => setData((prev) => (prev ? { ...prev, goals: update(prev.goals) } : prev))}
            onMetrics={(update) => metricState.setData((prev) => (prev ? update(prev) : prev))}
            onPeople={(update) => setData((prev) => (prev ? { ...prev, people: update(prev.people) } : prev))}
            onDeleted={(id) => {
              setData((prev) =>
                prev
                  ? {
                      roles: prev.roles.filter((r) => r.id !== id),
                      goals: prev.goals.filter((g) => g.job_role_id !== id),
                      people: prev.people.map((p) => (p.job_role_id === id ? { ...p, job_role_id: null } : p)),
                    }
                  : prev,
              );
              navigate(BASE, { replace: true });
            }}
          />
        ) : (
          <Notice tone="error">That role is not in this company.</Notice>
        )}
      </ListDetail>
      {addingRole ? (
        <AddRoleDialog
          companyId={companyId}
          nextOrder={roles.length + 1}
          onClose={() => setAddingRole(false)}
          onAdded={(created) => {
            setData((prev) => (prev ? { ...prev, roles: [...prev.roles, created] } : prev));
            setAddingRole(false);
            navigate(`${BASE}/${created.id}`);
          }}
        />
      ) : null}
    </>
  );
}
