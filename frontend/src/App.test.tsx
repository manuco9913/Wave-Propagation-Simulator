import { render, screen, waitFor } from "@testing-library/react";
import { App } from "./App";

test("fetches both schema endpoints on mount", async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ type: "object" })));
  vi.stubGlobal("fetch", fetchMock);

  render(<App />);

  await waitFor(() => expect(screen.getByTestId("schema-status")).toHaveTextContent("ready"));
  const urls = fetchMock.mock.calls.map((c) => (c as unknown[])[0]);
  expect(urls).toContain("/api/schema/entity");
  expect(urls).toContain("/api/schema/scenario");
});
