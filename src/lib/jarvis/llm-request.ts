export function requestOptionsForIteration(
  iteration: number,
  forcedToolName: string | null,
  explicitToolRequest: boolean
) {
  if (forcedToolName) {
    return {
      thinking: { type: 'disabled' as const },
      ...(iteration === 0
        ? { tool_choice: { type: 'tool' as const, name: forcedToolName } }
        : {}),
    }
  }

  return {
    output_config: {
      effort: iteration === 0 && explicitToolRequest ? ('max' as const) : ('high' as const),
    },
  }
}
