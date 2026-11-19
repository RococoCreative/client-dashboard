// What Home says when the company carries the links module but has no links yet: one quiet line at
// the end of the page, in place of an empty card higher up. An admin is told where links are added.
import { Link } from "react-router-dom";
import { secondaryClass } from "../ui/type.ts";

export default function NoLinksLine({ isAdmin }: { isAdmin: boolean }) {
  return (
    <p className={`mt-6 ${secondaryClass}`}>
      {isAdmin ? (
        <>
          No links yet. Add the programs the team works in, such as Monday boards, in{" "}
          <Link to="/resources/links" className="text-link hover:underline">Resources, Links</Link>, and they show here for everyone.
        </>
      ) : (
        "No links yet. Your admins add the programs the team works in, and they show here."
      )}
    </p>
  );
}
