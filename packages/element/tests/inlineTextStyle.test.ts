import {
  rebaseInlineBoldRanges,
  toggleInlineBoldRange,
} from "../src/inlineTextStyle";

describe("inline text bold ranges", () => {
  it("toggles only the selected characters", () => {
    expect(toggleInlineBoldRange([], 2, 5, 8)).toEqual([
      { start: 2, end: 5 },
    ]);
    expect(
      toggleInlineBoldRange([{ start: 2, end: 5 }], 3, 4, 8),
    ).toEqual([
      { start: 2, end: 3 },
      { start: 4, end: 5 },
    ]);
  });

  it("moves ranges when text is inserted before them", () => {
    expect(
      rebaseInlineBoldRanges(
        "hello world",
        "hello new world",
        [{ start: 6, end: 11 }],
      ),
    ).toEqual([{ start: 10, end: 15 }]);
  });

  it("keeps inserted text bold while typing inside a bold range", () => {
    expect(
      rebaseInlineBoldRanges(
        "hello",
        "helXlo",
        [{ start: 1, end: 4 }],
      ),
    ).toEqual([{ start: 1, end: 5 }]);
  });

  it("preserves the remaining bold text after deletion", () => {
    expect(
      rebaseInlineBoldRanges(
        "hello world",
        "hello orld",
        [{ start: 6, end: 11 }],
      ),
    ).toEqual([{ start: 6, end: 10 }]);
  });
});
