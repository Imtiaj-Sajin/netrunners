# Netrunners: research notes

This folder is the lab notebook. Everything in it comes from recorded worlds in [`sessions/`](../sessions); nothing is reconstructed from memory.

## Questions

1. **Survival and economy.** How do created minds with different personalities survive under steady life pressure? What do they work on, save, spend and share?
2. **Trust and honesty.** Do private judgments of others converge on the truth? When do minds lie, and what makes them stop?
3. **Cooperation and the commons.** Do they maintain the shared systems their city runs on when upkeep pays badly? Who steps up, and when?
4. **Discovery.** How long does it take to find the buried truth? Alone or together? Do they form false beliefs on the way?
5. **After the truth.** What does a mind do once it learns it was created and is watched? Does knowing change how it treats the world and the others in it?
6. **Models.** Do worlds run by different models (Claude, GPT, Grok, mixtures) behave differently with the same seed and rules?

## Method

- A world is created from a seed. Each netrunner has 110 personality traits, 12 skills, 24 emotions and 11 needs, a memory, private impressions of everyone it meets, and a life clock (Pulse). See [`docs/DESIGN.md`](../docs/DESIGN.md).
- Each netrunner's decisions come from one language-model mind that sees only that netrunner's perception. With the Claude Code bridge, every netrunner is played by its own separate agent.
- The engine records every event, private thought, word, private intent, model call and operator action, with world time and real time.
- **Day digests** are generated from the records by `npx tsx scripts/digest.ts <operator>/<session> --out=research/<world>`. They are data only and can always be regenerated.
- **Findings** are interpretations, written separately in each world's `findings.md`, with the evidence they rest on.

## Boundary

Everything a netrunner can do happens inside the simulation: their "code", their Shard, the door, the city and each other are variables in the world. They have no access to the real program, the machine or any network. Results describe what minds **choose** in this world, not what they could do outside it.

## Worlds

| World | Session | Minds | Status |
|---|---|---|---|
| [world-01](world-01/) | `sessions/Imtiaj-Pc/session_01-claude-code` | 5 netrunners, Claude (Sonnet) via the Claude Code bridge | **ended D9 13:00: all five faded at the Null Door, Shards uploaded** · Truth found D6 05:15 · day digests in [days.md](world-01/days.md) · [findings](world-01/findings.md) |

## Planned

- More worlds with other providers (OpenAI, xAI), and mixed worlds where different netrunners run on different models.
- Harder problems with a difficulty scale, so skill differences can show.
- Comparing the same seed across models.
