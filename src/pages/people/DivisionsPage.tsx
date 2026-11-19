// People, Divisions: the company's divisions, an admin's list to add to, rename and remove.
// The panel keeps its own rule about who may change them.
import DivisionsPanel from "../../components/people/DivisionsPanel.tsx";
import PeopleHeader from "../../components/people/PeopleHeader.tsx";
import { useHub } from "../../context/HubContext.tsx";

export default function DivisionsPage() {
  const { company } = useHub();
  return (
    <>
      <PeopleHeader tab="divisions" />
      <DivisionsPanel companyId={company!.id} />
    </>
  );
}
