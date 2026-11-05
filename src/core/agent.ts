export function supportsAgentLoadArguments(shellType: string, packer: string): boolean {
  return (
    shellType.startsWith("Agent") &&
    ["AgentJar", "AgentJarWithJDKAttacher", "AgentJarWithJREAttacher"].includes(packer)
  );
}

export function agentLoadExamples(agentArgs: string): string[] {
  return [
    `java -jar agent.jar <pid> ${agentArgs}`,
    `jattach <pid> load instrument false agent.jar=${agentArgs}`,
  ];
}
