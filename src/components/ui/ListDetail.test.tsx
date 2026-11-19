// Pins the list and detail primitive: items are links, the open one is marked, search filters on
// title, the detail is not rendered until something is selected, an empty list leaves its empty
// state to the page, a muted item reads in ink-3 alone, and grouped items sit under their label.
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

  it("shows nothing for an empty list with an empty search, leaving the empty state to the page", () => {
    render(
      <MemoryRouter>
        <ListDetail label="Job roles" items={[]} selectedId={null} hrefFor={(id) => `/roles/${id}`} backHref="/roles" countLabel="0 roles" searchLabel="Search roles" footer={<p>No job roles yet.</p>}>
          <p>The open role</p>
        </ListDetail>
      </MemoryRouter>,
    );
    expect(screen.queryByText("Nothing matches that.")).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.getByText("No job roles yet.")).toBeInTheDocument();
  });

  it("gives a muted item ink-3 without the ink it would otherwise carry", () => {
    setup(null);
    const muted = screen.getByText("Site safety officer");
    expect(muted).toHaveClass("text-ink-3");
    expect(muted).not.toHaveClass("text-ink");
    expect(screen.getByText("Estimator")).toHaveClass("text-ink");
  });

  it("puts grouped items under their group's label, after the ungrouped ones", () => {
    render(
      <MemoryRouter>
        <ListDetail
          label="Job roles"
          items={[
            { id: "a", title: "Site lead" },
            { id: "c", title: "Site safety officer", muted: true, group: "Retired roles (1)" },
          ]}
          selectedId={null}
          hrefFor={(id) => `/roles/${id}`}
          backHref="/roles"
          countLabel="2 roles"
        >
          <p>The open role</p>
        </ListDetail>
      </MemoryRouter>,
    );
    const label = screen.getByText("Retired roles (1)");
    const lead = screen.getByRole("link", { name: /Site lead/ });
    const officer = screen.getByRole("link", { name: /Site safety officer/ });
    expect(lead.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(label.compareDocumentPosition(officer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
