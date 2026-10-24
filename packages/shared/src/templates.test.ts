import { describe, expect, it } from "vitest";
import { describeTemplate, matchTemplate, missingSections } from "./templates.js";

const t = (repo: string, required = true) => ({ repo, instructions: "", sections: [{ title: "Tests run", hint: "", required }] });

describe("handoff templates", () => {
  const all = [t("*"), t("github.com/acme/*"), t("github.com/acme/api"), t("github.com/acme/api-*")];

  it("picks exact, then the longest prefix, then *", () => {
    expect(matchTemplate(all, "github.com/acme/api")?.repo).toBe("github.com/acme/api");
    expect(matchTemplate(all, "GitHub.com/Acme/API")?.repo).toBe("github.com/acme/api");
    expect(matchTemplate(all, "github.com/acme/api-gateway")?.repo).toBe("github.com/acme/api-*");
    expect(matchTemplate(all, "github.com/acme/web")?.repo).toBe("github.com/acme/*");
    expect(matchTemplate(all, "gitlab.com/x/y")?.repo).toBe("*");
    expect(matchTemplate([t("github.com/acme/*")], "gitlab.com/x/y")).toBeNull();
  });

  it("finds required sections that are missing or empty, ignoring case", () => {
    expect(missingSections(t("*"), { sections: [] })).toEqual(["Tests run"]);
    expect(missingSections(t("*"), { sections: [{ title: "tests RUN", items: ["  "] }] })).toEqual(["Tests run"]);
    expect(missingSections(t("*"), { sections: [{ title: "tests RUN", items: ["npm test"] }] })).toEqual([]);
    expect(missingSections(t("*", false), { sections: [] })).toEqual([]);
    expect(missingSections(null, { sections: [] })).toEqual([]);
  });

  it("describes a template for agents", () => {
    expect(describeTemplate({ repo: "*", instructions: "Mention flags.", sections: [{ title: "Tests run", hint: "commands and results", required: true }] })).toBe(
      "Handoff template for *:\nMention flags.\nAdd these sections (pass them as `sections`, each with a title and a list of items):\n- Tests run (required): commands and results",
    );
  });
});
