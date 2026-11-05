import { describe, expect, it } from "vitest";

import { agentLoadExamples, supportsAgentLoadArguments } from "./agent.js";

describe("Agent load arguments", () => {
  it("requires an attachable Agent shell type and a jar packer", () => {
    expect(supportsAgentLoadArguments("AgentFilterChain", "AgentJar")).toBe(true);
    expect(supportsAgentLoadArguments("AgentContextValve", "AgentJarWithJDKAttacher")).toBe(true);
    expect(supportsAgentLoadArguments("AgentFilterChain", "AgentJarWithJREAttacher")).toBe(true);
    expect(supportsAgentLoadArguments("Listener", "AgentJar")).toBe(false);
    expect(supportsAgentLoadArguments("AgentFilterChain", "FilelessAgent")).toBe(false);
    expect(supportsAgentLoadArguments("AgentFilterChain", "DefaultBase64")).toBe(false);
  });

  it("shows the load argument in both supported invocations", () => {
    expect(agentLoadExamples("restore=true")).toEqual([
      "java -jar agent.jar <pid> restore=true",
      "jattach <pid> load instrument false agent.jar=restore=true",
    ]);
  });
});
