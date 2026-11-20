// Render a page the way the app does: inside the hub context and a router at a given path.
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HubContext, type HubValue } from "../context/HubContext.tsx";
import { setActingPerson } from "./actingPerson.ts";

export function renderWithHub(ui: ReactElement, hub: HubValue, { path = "/", pattern = "/" }: { path?: string; pattern?: string } = {}) {
  // The mocks that judge who may act (mocks/gsrOnDemand.ts) act as the person this hub is for.
  setActingPerson(hub.profile);
  return render(
    <HubContext value={hub}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={pattern} element={ui} />
          <Route path="*" element={<div>elsewhere</div>} />
        </Routes>
      </MemoryRouter>
    </HubContext>,
  );
}
