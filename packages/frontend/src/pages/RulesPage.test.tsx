import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { JsonTree } from "./RulesPage";

// The load-bearing, silent-on-failure interaction: clicking a tree leaf must
// build the dot-path rooted at the raw doc (so pins read `prompt.<n>.inputs.<w>`
// and resolve_path on the backend hits the same value). A wrong root or an
// off-by-one in the array branch fails silently (extraction just stays null).
describe("JsonTree path construction", () => {
  it("dict-key leaf yields the rooted dot-path", () => {
    const onPin = vi.fn();
    render(
      <JsonTree
        value={{ prompt: { inputs: { text0: "a knight" } } }}
        path=""
        onPin={onPin}
      />,
    );
    fireEvent.click(screen.getByText('"a knight"'));
    expect(onPin).toHaveBeenCalledWith("prompt.inputs.text0");
  });

  it("array element leaf yields a numeric index segment", () => {
    const onPin = vi.fn();
    render(<JsonTree value={{ positive: ["6", 0] }} path="prompt.3.inputs" onPin={onPin} />);
    fireEvent.click(screen.getByText('"6"'));
    expect(onPin).toHaveBeenCalledWith("prompt.3.inputs.positive.0");
  });
});
