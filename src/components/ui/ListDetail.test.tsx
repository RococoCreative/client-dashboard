// Pins the list and detail primitive: items are links, the open one is marked, search filters on
// title, and the detail is not rendered until something is selected.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import ListDetail from "./ListDetail.tsx";

const ITEMS = [
  { id: "a", title: "Site lead", meta: "Field" },
  { id: "b", title: "Estimator" },
  { id: "c", title: "Site safety officer", muted: true },
];

function setup(selectedId: string | null) {
  return render(
    <MemoryRouter>
      <ListDetail
        label="Job roles"
        items={ITEMS}
        selectedId={selectedId}
        hrefFor={(id) => `/roles/${id}`}
        backHref="/roles"
        countLabel="3 roles"
        searchLabel="Search roles"
        actions={<button type="button">Add role</button>}
      >
        <p>The open role</p>
      </ListDetail>
    </MemoryRouter>,
  );
}

describe("ListDetail", () => {
  it("renders every item as a link and marks the selected one", () => {
    setup("b");
    for (const item of ITEMS) {
      expect(screen.getByRole("link", { name: new RegExp(item.title) })).toHaveAttribute("href", `/roles/${item.id}`);
    }
    expect(screen.getByRole("link", { name: /Estimator/ })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("link", { name: /Site lead/ })).not.toHaveAttribute("aria-current");
    expect(screen.getByText("3 roles")).toBeInTheDocument();
    expect(screen.getByText("The open role")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Job roles" })).toHaveAttribute("href", "/roles");
  });

  it("filters on title and says when nothing matches", async () => {
    setup(null);
    await userEvent.type(screen.getByRole("searchbox", { name: "Search roles" }), "site");
    expect(screen.getByRole("link", { name: /Site lead/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Site safety officer/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Estimator/ })).not.toBeInTheDocument();
    await userEvent.clear(screen.getByRole("searchbox", { name: "Search roles" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Search roles" }), "zzz");
    expect(screen.getByText("Nothing matches that.")).toBeInTheDocument();
  });

  it("does not render the detail with nothing selected", () => {
    setup(null);
    expect(screen.queryByText("The open role")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Back to Job roles" })).not.toBeInTheDocument();
  });
});
