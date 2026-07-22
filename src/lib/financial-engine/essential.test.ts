import { describe, expect, it } from "vitest";
import { essentialForCategory } from "./essential";

describe("essentialForCategory", () => {
  it("classifies must-pay categories as essential", () => {
    for (const c of ["housing", "utilities", "insurance", "groceries", "health", "debt_payment", "transport"]) {
      expect(essentialForCategory(c), c).toBe(true);
    }
  });

  it("classifies discretionary, savings, income, other, and null as non-essential", () => {
    for (const c of ["dining", "shopping", "discretionary", "savings", "income", "other"]) {
      expect(essentialForCategory(c), c).toBe(false);
    }
    expect(essentialForCategory(null)).toBe(false);
  });

  it("treats unknown category strings as non-essential", () => {
    expect(essentialForCategory("not_a_real_category")).toBe(false);
  });
});
