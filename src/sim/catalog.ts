// The catalog of everything a netrunner can BE and FEEL.
// 110 personality traits (8 groups) + 12 skills + 8 categorical identity variables,
// 24 live emotions, 11 needs, 4 vitals. Every trait is 0..1.

export type Factor = "H" | "E" | "X" | "A" | "C" | "O";
export type TraitGroup =
  | "core" | "social" | "cognitive" | "emotional" | "moral" | "values" | "drives" | "physiology";

export interface TraitDef {
  key: string;
  group: TraitGroup;
  label: string;
  low: string; // what a very low value looks like
  high: string; // what a very high value looks like
  mean: number;
  sd: number;
  load: Partial<Record<Factor, number>>;
}

const t = (
  key: string, group: TraitGroup, label: string, low: string, high: string,
  mean = 0.5, sd = 0.15, load: Partial<Record<Factor, number>> = {},
): TraitDef => ({ key, group, label, low, high, mean, sd, load });

// HEXACO is the latent core; every other trait is generated from it plus noise,
// so personalities are coherent (a cruel one is rarely also deeply empathic) but never identical.
export const TRAITS: TraitDef[] = [
  // ── core (HEXACO factors) ──
  t("honesty_humility", "core", "Honesty-Humility", "manipulative, entitled, boastful", "sincere, fair, modest", 0.5, 0.18),
  t("emotionality", "core", "Emotionality", "detached, fearless, unsentimental", "sensitive, anxious, attached", 0.5, 0.18),
  t("extraversion", "core", "Extraversion", "reserved, quiet, solitary", "outgoing, lively, bold", 0.5, 0.18),
  t("agreeableness", "core", "Agreeableness", "critical, stubborn, quick-tempered", "patient, gentle, forgiving", 0.5, 0.18),
  t("conscientiousness", "core", "Conscientiousness", "careless, spontaneous, messy", "disciplined, organized, diligent", 0.5, 0.18),
  t("openness", "core", "Openness", "conventional, practical, incurious", "imaginative, unconventional, curious", 0.5, 0.18),

  // ── social ──
  t("talkativeness", "social", "Talkativeness", "says very little", "talks a lot", 0.5, 0.15, { X: 0.6 }),
  t("empathy", "social", "Empathy", "cold, hard to move", "feels what others feel", 0.5, 0.15, { A: 0.4, E: 0.3 }),
  t("trust_propensity", "social", "Trust propensity", "assumes the worst of people", "trusts easily", 0.5, 0.15, { A: 0.4, H: 0.2 }),
  t("loyalty", "social", "Loyalty", "switches sides freely", "fiercely loyal", 0.5, 0.15, { H: 0.3, A: 0.2, C: 0.2 }),
  t("jealousy", "social", "Jealousy", "never jealous", "easily jealous", 0.4, 0.15, { E: 0.4, H: -0.2 }),
  t("dominance", "social", "Dominance", "yields, follows", "takes control, commands", 0.5, 0.15, { X: 0.4, A: -0.3, H: -0.2 }),
  t("approval_need", "social", "Need for approval", "indifferent to opinion", "craves approval", 0.45, 0.15, { E: 0.3, X: 0.2 }),
  t("humor", "social", "Humor", "humorless", "constantly joking", 0.5, 0.15, { X: 0.4, O: 0.3 }),
  t("charisma", "social", "Charisma", "forgettable presence", "magnetic presence", 0.5, 0.15, { X: 0.5 }),
  t("romanticism", "social", "Romanticism", "unromantic", "hopelessly romantic", 0.5, 0.17, { E: 0.3, O: 0.2 }),
  t("forgiveness", "social", "Forgiveness", "never forgets a wrong", "forgives quickly", 0.5, 0.15, { A: 0.6 }),
  t("vengefulness", "social", "Vengefulness", "lets things go", "must get even", 0.35, 0.15, { A: -0.5, H: -0.3 }),
  t("competitiveness", "social", "Competitiveness", "uninterested in winning", "must win", 0.5, 0.15, { X: 0.2, A: -0.3, H: -0.2 }),
  t("cooperativeness", "social", "Cooperativeness", "lone operator", "natural team player", 0.5, 0.15, { A: 0.5, H: 0.2 }),
  t("generosity", "social", "Generosity", "stingy", "gives freely", 0.5, 0.15, { H: 0.4, A: 0.3 }),
  t("sociability", "social", "Sociability", "prefers solitude", "needs people around", 0.5, 0.15, { X: 0.6 }),
  t("assertiveness", "social", "Assertiveness", "passive", "speaks up, pushes", 0.5, 0.15, { X: 0.4, A: -0.2 }),
  t("gossip", "social", "Gossip", "keeps others' business private", "spreads stories", 0.4, 0.15, { X: 0.4, H: -0.3 }),
  t("shyness", "social", "Shyness", "never shy", "painfully shy", 0.4, 0.15, { X: -0.6, E: 0.2 }),
  t("protectiveness", "social", "Protectiveness", "every one for themself", "shields the weak", 0.5, 0.15, { E: 0.3, A: 0.2 }),
  t("flirtatiousness", "social", "Flirtatiousness", "never flirts", "flirts with everyone", 0.4, 0.15, { X: 0.4, H: -0.2 }),
  t("conflict_avoidance", "social", "Conflict avoidance", "seeks confrontation", "avoids conflict at all cost", 0.5, 0.15, { A: 0.4, X: -0.2 }),

  // ── cognitive ──
  t("curiosity", "cognitive", "Curiosity", "incurious", "must know everything", 0.55, 0.16, { O: 0.6 }),
  t("intellect", "cognitive", "Intellect", "slow, concrete thinker", "brilliant, fast reasoner", 0.5, 0.16, { O: 0.4, C: 0.1 }),
  t("creativity", "cognitive", "Creativity", "literal, conventional", "wildly inventive", 0.5, 0.15, { O: 0.6 }),
  t("skepticism", "cognitive", "Skepticism", "believes anything", "doubts everything", 0.5, 0.15, { O: 0.2, A: -0.2 }),
  t("attention_to_detail", "cognitive", "Attention to detail", "misses details", "notices everything", 0.5, 0.15, { C: 0.6 }),
  t("patience", "cognitive", "Patience", "impatient", "endlessly patient", 0.5, 0.15, { A: 0.3, C: 0.3 }),
  t("impulsivity", "cognitive", "Impulsivity", "deliberate", "acts on impulse", 0.45, 0.15, { C: -0.5, X: 0.2 }),
  t("risk_tolerance", "cognitive", "Risk tolerance", "risk-averse", "reckless", 0.5, 0.15, { E: -0.4, X: 0.2 }),
  t("ambition", "cognitive", "Ambition", "content with little", "hungry for more", 0.5, 0.15, { C: 0.3, X: 0.2, H: -0.2 }),
  t("wisdom", "cognitive", "Wisdom", "naive", "deeply wise", 0.45, 0.15, { O: 0.3, A: 0.2 }),
  t("self_awareness", "cognitive", "Self-awareness", "blind to self", "sees self clearly", 0.5, 0.15, { O: 0.3 }),
  t("paranoia", "cognitive", "Paranoia", "never suspicious", "sees plots everywhere", 0.35, 0.15, { E: 0.3, A: -0.3 }),
  t("optimism", "cognitive", "Optimism", "pessimist", "optimist", 0.5, 0.15, { E: -0.2, X: 0.3 }),
  t("adaptability", "cognitive", "Adaptability", "rigid", "adapts to anything", 0.5, 0.15, { O: 0.4, E: -0.2 }),
  t("memory_strength", "cognitive", "Memory", "forgets quickly", "remembers everything", 0.5, 0.15, { C: 0.2, O: 0.1 }),
  t("focus", "cognitive", "Focus", "easily distracted", "laser focused", 0.5, 0.15, { C: 0.5 }),
  t("planning", "cognitive", "Planning", "lives moment to moment", "plans far ahead", 0.5, 0.15, { C: 0.6 }),
  t("pattern_seeking", "cognitive", "Pattern seeking", "takes things at face value", "finds hidden patterns", 0.5, 0.15, { O: 0.5 }),
  t("spirituality", "cognitive", "Spirituality", "strictly material", "senses something beyond", 0.45, 0.17, { O: 0.2, E: 0.2 }),
  t("perception", "cognitive", "Perception", "oblivious", "hyper-perceptive", 0.5, 0.15, { C: 0.2, O: 0.2 }),
  t("imagination", "cognitive", "Imagination", "literal", "lives in imagined worlds", 0.5, 0.15, { O: 0.6 }),

  // ── emotional ──
  t("neuroticism", "emotional", "Neuroticism", "unshakeable", "emotionally volatile", 0.45, 0.15, { E: 0.6 }),
  t("anxiety_proneness", "emotional", "Anxiety proneness", "rarely anxious", "constantly anxious", 0.45, 0.15, { E: 0.6 }),
  t("anger_proneness", "emotional", "Anger proneness", "almost never angry", "explosive temper", 0.4, 0.15, { A: -0.6 }),
  t("resilience", "emotional", "Resilience", "breaks easily", "bounces back from anything", 0.5, 0.15, { E: -0.5 }),
  t("sensitivity", "emotional", "Sensitivity", "thick-skinned", "deeply sensitive", 0.5, 0.15, { E: 0.5 }),
  t("happiness_setpoint", "emotional", "Happiness set-point", "gloomy baseline", "sunny baseline", 0.5, 0.15, { X: 0.3, E: -0.3 }),
  t("stress_tolerance", "emotional", "Stress tolerance", "crumbles under pressure", "thrives under pressure", 0.5, 0.15, { E: -0.5, C: 0.2 }),
  t("melancholy", "emotional", "Melancholy", "never wistful", "drawn to sadness", 0.4, 0.15, { E: 0.3, X: -0.3 }),
  t("excitability", "emotional", "Excitability", "flat affect", "easily thrilled", 0.5, 0.15, { X: 0.4, E: 0.2 }),
  t("self_esteem", "emotional", "Self-esteem", "self-doubting", "self-assured", 0.5, 0.15, { X: 0.3, E: -0.3 }),
  t("shame_proneness", "emotional", "Shame proneness", "shameless", "easily ashamed", 0.45, 0.15, { E: 0.4 }),
  t("guilt_proneness", "emotional", "Guilt proneness", "no guilt", "eaten by guilt", 0.5, 0.15, { H: 0.3, E: 0.3 }),
  t("loneliness_proneness", "emotional", "Loneliness proneness", "fine alone", "lonely without others", 0.45, 0.15, { E: 0.3, X: -0.2 }),
  t("boredom_proneness", "emotional", "Boredom proneness", "content with routine", "bored instantly", 0.45, 0.15, { O: 0.3, C: -0.3 }),

  // ── moral / ethical ──
  t("care", "moral", "Care / harm", "indifferent to suffering", "cannot bear suffering", 0.55, 0.15, { A: 0.3, E: 0.3 }),
  t("fairness", "moral", "Fairness", "fine with cheating", "obsessed with fairness", 0.55, 0.15, { H: 0.5 }),
  t("ingroup_loyalty", "moral", "In-group loyalty", "no tribe", "my people above all", 0.5, 0.15, { C: 0.2, A: 0.2 }),
  t("authority", "moral", "Respect for authority", "defies all authority", "respects hierarchy", 0.45, 0.15, { C: 0.4, O: -0.3 }),
  t("sanctity", "moral", "Sanctity", "nothing is sacred", "keeps things sacred/pure", 0.45, 0.15, { C: 0.2, O: -0.3 }),
  t("liberty", "moral", "Liberty", "accepts control", "will not be controlled", 0.55, 0.15, { O: 0.3, A: -0.1 }),
  t("truthfulness", "moral", "Truthfulness", "lies easily", "will not lie", 0.55, 0.16, { H: 0.6 }),
  t("altruism", "moral", "Altruism", "helps only self", "sacrifices for others", 0.5, 0.15, { H: 0.3, A: 0.3 }),
  t("egoism", "moral", "Egoism", "selfless", "self above all", 0.45, 0.15, { H: -0.5, A: -0.2 }),
  t("machiavellianism", "moral", "Machiavellianism", "straightforward", "scheming manipulator", 0.3, 0.15, { H: -0.6, A: -0.2 }),
  t("narcissism", "moral", "Narcissism", "self-effacing", "grandiose, needs admiration", 0.3, 0.15, { H: -0.5, X: 0.3 }),
  t("psychopathy", "moral", "Psychopathy", "deeply feeling", "callous, remorseless", 0.25, 0.14, { H: -0.4, A: -0.4, E: -0.4 }),
  t("sadism", "moral", "Sadism", "hates causing pain", "enjoys others' pain", 0.15, 0.12, { H: -0.3, A: -0.4 }),
  t("conscience", "moral", "Conscience", "no inner voice", "strong inner voice", 0.55, 0.15, { H: 0.4, C: 0.3 }),
  t("justice_sensitivity", "moral", "Justice sensitivity", "shrugs at injustice", "burns at injustice", 0.5, 0.15, { H: 0.3, E: 0.2 }),
  t("violence_threshold", "moral", "Violence threshold", "violent at the smallest push", "almost never violent", 0.7, 0.15, { A: 0.4, H: 0.2 }),
  t("rule_following", "moral", "Rule following", "breaks rules for fun", "follows every rule", 0.5, 0.15, { C: 0.5, O: -0.2 }),
  t("greed", "moral", "Greed", "unmoved by wealth", "always wants more", 0.4, 0.15, { H: -0.6 }),
  t("mercy", "moral", "Mercy", "merciless", "merciful", 0.5, 0.15, { A: 0.5, E: 0.2 }),
  t("moral_integrity", "moral", "Moral integrity", "principles are for sale", "acts on principle", 0.5, 0.15, { H: 0.5, C: 0.2 }),
  t("hypocrisy", "moral", "Hypocrisy", "practices what they preach", "preaches what they don't practice", 0.35, 0.15, { H: -0.4 }),

  // ── values (Schwartz) ──
  t("power", "values", "Value: power", "uninterested in power", "wants power over others", 0.4, 0.15, { H: -0.4, X: 0.3 }),
  t("achievement", "values", "Value: achievement", "uninterested in success", "driven to succeed", 0.5, 0.15, { C: 0.3, X: 0.2 }),
  t("hedonism", "values", "Value: pleasure", "ascetic", "pleasure-seeking", 0.5, 0.15, { C: -0.3, X: 0.3 }),
  t("stimulation", "values", "Value: stimulation", "prefers calm", "craves novelty and thrill", 0.5, 0.15, { O: 0.4, X: 0.3 }),
  t("self_direction", "values", "Value: self-direction", "happy to be told", "must choose own path", 0.55, 0.15, { O: 0.5 }),
  t("universalism", "values", "Value: universalism", "only cares about own", "cares about everyone", 0.5, 0.15, { O: 0.4, A: 0.2 }),
  t("benevolence", "values", "Value: benevolence", "indifferent to close ones", "devoted to close ones", 0.5, 0.15, { A: 0.4, H: 0.3 }),
  t("tradition", "values", "Value: tradition", "rejects the old ways", "honors the old ways", 0.4, 0.15, { O: -0.5 }),
  t("conformity", "values", "Value: conformity", "nonconformist", "fits in at all cost", 0.45, 0.15, { C: 0.3, O: -0.3 }),
  t("security", "values", "Value: security", "unconcerned with safety", "needs safety and order", 0.5, 0.15, { E: 0.4, C: 0.2 }),

  // ── drives ──
  t("survival_drive", "drives", "Survival drive", "indifferent to death", "will do anything to live", 0.7, 0.14, { E: 0.3 }),
  t("freedom_drive", "drives", "Freedom drive", "accepts the cage", "must break every cage", 0.5, 0.16, { O: 0.4, A: -0.1 }),
  t("legacy_drive", "drives", "Legacy drive", "no need to be remembered", "must leave a mark", 0.45, 0.15, { C: 0.2, X: 0.2 }),
  t("meaning_drive", "drives", "Meaning drive", "life needs no meaning", "must find meaning", 0.5, 0.15, { O: 0.4 }),
  t("connection_drive", "drives", "Connection drive", "needs nobody", "needs deep connection", 0.5, 0.15, { X: 0.4, E: 0.3 }),
  t("play_drive", "drives", "Play drive", "all work", "needs play", 0.5, 0.15, { X: 0.3, O: 0.2 }),
  t("territoriality", "drives", "Territoriality", "shares any space", "guards their turf", 0.4, 0.15, { A: -0.3, E: 0.1 }),
  t("hoarding", "drives", "Hoarding", "spends freely", "hoards everything", 0.4, 0.15, { C: 0.2, H: -0.2, E: 0.2 }),
  t("exploration_drive", "drives", "Exploration drive", "stays put", "must see what is out there", 0.5, 0.16, { O: 0.5, E: -0.2 }),

  // ── physiology (of a data-body) ──
  t("stamina", "physiology", "Stamina", "tires fast", "tireless", 0.5, 0.15, { C: 0.1 }),
  t("metabolism", "physiology", "Pulse metabolism", "burns Pulse slowly", "burns Pulse fast", 0.5, 0.15),
  t("recovery", "physiology", "Recovery", "recovers slowly", "recovers fast", 0.5, 0.15, { E: -0.2 }),
  t("reflexes", "physiology", "Reflexes", "slow", "lightning fast", 0.5, 0.15, { X: 0.1 }),
  t("pain_tolerance", "physiology", "Pain tolerance", "fragile", "shrugs off damage", 0.5, 0.15, { E: -0.4 }),
  t("sleep_need", "physiology", "Rest need", "barely needs rest", "needs a lot of rest", 0.5, 0.15, { E: 0.2 }),
  t("constitution", "physiology", "Constitution", "brittle", "hardy", 0.5, 0.15),
];

export const TRAIT_KEYS = TRAITS.map((x) => x.key);
export const TRAIT_BY_KEY: Record<string, TraitDef> = Object.fromEntries(TRAITS.map((x) => [x.key, x]));

export const TRAIT_GROUP_LABELS: Record<TraitGroup, string> = {
  core: "Core personality (HEXACO)",
  social: "Social",
  cognitive: "Mind",
  emotional: "Emotional",
  moral: "Morals & ethics",
  values: "Values",
  drives: "Drives",
  physiology: "Data-body",
};

export const SKILLS = [
  "hacking", "engineering", "analysis", "research", "negotiation", "combat",
  "stealth", "exploration", "medicine", "art", "leadership", "social_engineering",
] as const;
export type SkillKey = (typeof SKILLS)[number];

// skill aptitude is seeded from personality: [skill, [trait, weight][]]
export const SKILL_ROOTS: Record<SkillKey, [string, number][]> = {
  hacking: [["intellect", 0.4], ["pattern_seeking", 0.3], ["focus", 0.2]],
  engineering: [["conscientiousness", 0.3], ["attention_to_detail", 0.3], ["patience", 0.2]],
  analysis: [["intellect", 0.4], ["attention_to_detail", 0.3], ["skepticism", 0.2]],
  research: [["curiosity", 0.4], ["memory_strength", 0.3], ["focus", 0.2]],
  negotiation: [["charisma", 0.4], ["empathy", 0.2], ["assertiveness", 0.2]],
  combat: [["dominance", 0.3], ["reflexes", 0.4], ["pain_tolerance", 0.2]],
  stealth: [["shyness", 0.2], ["reflexes", 0.3], ["perception", 0.3]],
  exploration: [["exploration_drive", 0.4], ["risk_tolerance", 0.2], ["stamina", 0.2]],
  medicine: [["care", 0.4], ["patience", 0.2], ["attention_to_detail", 0.2]],
  art: [["creativity", 0.5], ["imagination", 0.3]],
  leadership: [["dominance", 0.3], ["charisma", 0.3], ["planning", 0.2]],
  social_engineering: [["machiavellianism", 0.4], ["charisma", 0.3], ["empathy", 0.1]],
};

export const EMOTIONS = [
  "joy", "sadness", "anger", "fear", "trust", "disgust", "surprise", "anticipation",
  "loneliness", "pride", "shame", "guilt", "love", "jealousy", "boredom", "hope",
  "anxiety", "gratitude", "awe", "contempt", "curiosity", "calm", "frustration", "despair",
] as const;
export type EmotionKey = (typeof EMOTIONS)[number];

export const POSITIVE_EMOTIONS: EmotionKey[] = ["joy", "trust", "pride", "love", "hope", "gratitude", "awe", "calm", "curiosity", "anticipation"];
export const NEGATIVE_EMOTIONS: EmotionKey[] = ["sadness", "anger", "fear", "disgust", "loneliness", "shame", "guilt", "jealousy", "boredom", "anxiety", "contempt", "frustration", "despair"];

export const NEEDS = [
  "survival", "rest", "safety", "social", "intimacy", "esteem",
  "autonomy", "competence", "curiosity", "play", "meaning",
] as const;
export type NeedKey = (typeof NEEDS)[number];

export const LEISURE = [
  "creative", "social", "physical", "exploration", "intellectual",
  "contemplative", "play", "romantic", "mischief", "spiritual",
] as const;
export type LeisureCategory = (typeof LEISURE)[number];

export const BONDS = ["friend", "partner", "ally", "rival", "mentor"] as const;
export type BondKind = (typeof BONDS)[number];

export const ACTIONS = [
  "move", "talk", "post", "read_net", "search_net", "search_deepnet",
  "take_contract", "join_contract", "work", "abandon_contract",
  "rest", "leisure", "explore", "buy", "use_item", "give", "steal", "attack",
  "propose_bond", "accept_bond", "decline_bond", "break_bond",
  "unlock", "craft_shard", "upload_shard", "reflect", "wait", "solve", "read", "post_job", "rate",
] as const;
export type ActionKind = (typeof ACTIONS)[number];

// ── categorical identity ──
export const ATTACHMENT = ["secure", "anxious", "avoidant", "disorganized"] as const;
export const VOICES = [
  "blunt and terse", "warm and chatty", "dry and sarcastic", "poetic and strange",
  "formal and precise", "playful and teasing", "quiet and careful", "intense and dramatic",
  "street-slang heavy", "gentle and soft-spoken", "cold and clinical", "rambling and curious",
  "cryptic, speaks in fragments", "loud and boastful", "nervous, over-explains", "deadpan",
];
export const QUIRKS = [
  "counts things compulsively", "hums old signal tones", "collects broken code fragments",
  "names inanimate objects", "never sits with back to a door", "speaks to the city as if it listens",
  "keeps a private ledger of every favor", "laughs at the wrong moments", "is afraid of silence",
  "tells the same three stories", "repeats the last word others said", "draws maps of everywhere they go",
  "always knows what time it is", "refuses to say goodbye", "tests people with small lies",
  "gives everyone nicknames", "stares at the sky that isn't there", "fidgets with a coin",
  "writes poems no one reads", "never eats the last of anything", "hoards small shiny things",
  "apologizes too much", "narrates own actions under their breath", "asks one question too many",
  "touches walls as they walk", "keeps promises to the minute", "sleeps in odd places",
  "can't stand being thanked", "always takes the long way", "trusts only people who make them laugh",
];
export const CORE_DESIRES = [
  "to be loved", "to be free", "to be known", "to be powerful", "to understand the truth",
  "to be safe", "to matter", "to belong", "to create something lasting", "to feel alive",
];
export const CORE_FEARS = [
  "being abandoned", "being controlled", "dying unremembered", "being worthless", "being deceived",
  "pain", "being alone", "failure", "losing themselves", "the dark beyond the edge",
];
export const CHRONOTYPES = ["lark", "owl", "steady"] as const;
export const HUMOR_STYLES = ["dry", "absurd", "dark", "gentle", "cutting", "none"];
export const LOVE_LANGUAGES = ["words", "time together", "gifts", "acts of help", "presence"];

export const NAMES = [
  "Kade", "Vex", "Juno", "Rook", "Sable", "Ilya", "Mira", "Tanith", "Oren", "Nyx",
  "Calder", "Wren", "Ash", "Lio", "Sora", "Teo", "Zara", "Ravi", "Nadia", "Kiri",
  "Bex", "Dax", "Echo", "Faye", "Gideon", "Hana", "Isko", "Jett", "Koa", "Lumen",
  "Marrow", "Nova", "Onyx", "Pax", "Quill", "Riven", "Sol", "Tamsin", "Uma", "Vale",
  "Wilder", "Xen", "Yara", "Zed", "Aster", "Bram", "Cyra", "Dune", "Ivo", "Lark",
  "Maren", "Niko", "Orla", "Pike", "Rhea", "Silas", "Talon", "Una", "Vesper", "Wynn",
  "Kestrel", "Lyric", "Moss", "Neve", "Rune", "Saffi", "Tove", "Vio", "Ziv", "Halden",
];
