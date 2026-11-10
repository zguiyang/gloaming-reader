import { eq, sql } from 'drizzle-orm';

import { user as userTable } from '@gloaming/db';
import { resolveLocale } from '@gloaming/i18n';

import { invokeAi } from '../src/domains/ai/index';
import { normalizeTagName } from '../src/domains/library/tags/normalization';
import {
  buildPersonalTaggingMessages,
  type PersonalTagCandidate,
  personalTagDecisionSchema,
  validatePersonalTagDecision,
} from '../src/domains/library/tags/personal-ai-tagging';
import { db } from '../src/infra/db';
import { AppError } from '../src/shared/errors/app-error';

type Sample = {
  id: string;
  title: string;
  author: string;
  language: 'zh-CN' | 'en-US';
  description: string;
  excerpt: string;
  tocTitles: string[];
  existingTags: PersonalTagCandidate[];
};

const samples: Sample[] = [
  {
    id: '01-same-language-reuse',
    title: 'The River Remembers',
    author: 'Lena Park',
    language: 'en-US',
    description:
      'A field biologist follows a temperate river through seasonal floods, fish migration, wetland recovery, and nearby farming impacts.',
    excerpt:
      'At the first winter thaw, the river carried more than water downstream. Flooded banks left silt among willow roots, and shallow pools warmed before the main channel. Young fish gathered there until the current weakened. By late spring, reeds had returned to the abandoned bend, drawing insects and wading birds. We measured oxygen, sediment, and species counts at each site, then compared restored banks with those constrained by concrete walls.',
    tocTitles: ['A Living Channel', 'Floodplains and Fish', 'Restoring the Banks'],
    existingTags: [
      { id: 'tag-ecology', name: 'Ecology', localizedNames: {}, sourceLocale: 'en-US' },
      { id: 'tag-freshwater', name: 'Freshwater Biology', localizedNames: {}, sourceLocale: 'en-US' },
      { id: 'tag-conservation', name: 'Conservation', localizedNames: {}, sourceLocale: 'en-US' },
      { id: 'tag-field-biology', name: 'Field Biology', localizedNames: {}, sourceLocale: 'en-US' },
    ],
  },
  {
    id: '02-cross-language-english-tag',
    title: '潮汐之间',
    author: '林澄',
    language: 'zh-CN',
    description: '一部虚构小说，讲述海平面上升后沿海社区迁居、重建生活并保存地方记忆的过程。',
    excerpt:
      '海水越过旧防波堤的那一年，镇上的人开始把门牌写在木箱上。有人去了山城，有人留在临时搭起的学校里。阿禾每周回到海边，记录潮线移动到哪一棵树下，也记录谁还没有决定离开。多年以后，新的堤岸保护了港口，却没有让所有人回到原来的家。她把这些口述故事整理成一册，留给后来出生的孩子。',
    tocTitles: ['最后一次涨潮', '临时的家', '新的海岸线'],
    existingTags: [
      {
        id: 'tag-climate-fiction',
        name: 'Climate Fiction',
        localizedNames: { 'zh-CN': '气候小说' },
        sourceLocale: 'en-US',
      },
      { id: 'tag-migration', name: 'Migration', localizedNames: { 'zh-CN': '迁徙' }, sourceLocale: 'en-US' },
    ],
  },
  {
    id: '03-combination-sufficient',
    title: 'Below the Blue Shelf',
    author: 'Omar Bell',
    language: 'en-US',
    description:
      'A nonfiction account of cold-water coral communities, ocean warming, deep-sea surveys, and marine habitat protection.',
    excerpt:
      'The cameras crossed a ridge where sunlight never reaches. Pale coral branches held small crabs and juvenile fish, while temperature loggers showed a gradual rise over the past decade. Our team mapped the habitat, compared images with older surveys, and shared results with a regional conservation group. The evidence cannot tell us how every colony will respond, but it shows why deep-sea ecosystems belong in climate and marine protection plans.',
    tocTitles: ['A World Without Sunlight', 'Surveying the Ridge', 'Protection at Depth'],
    existingTags: [
      { id: 'tag-marine-biology', name: 'Marine Biology', localizedNames: {}, sourceLocale: 'en-US' },
      { id: 'tag-climate-change', name: 'Climate Change', localizedNames: {}, sourceLocale: 'en-US' },
      { id: 'tag-conservation', name: 'Conservation', localizedNames: {}, sourceLocale: 'en-US' },
      { id: 'tag-oceanography', name: 'Oceanography', localizedNames: {}, sourceLocale: 'en-US' },
    ],
  },
  {
    id: '04-durable-new-topic',
    title: 'A Shape That Cannot Untie',
    author: 'Nia Foster',
    language: 'en-US',
    description:
      'An accessible introduction to mathematical knot theory, equivalence, invariants, diagrams, and applications in topology.',
    excerpt:
      'Two loops may look different on paper while describing the same knot. The central question is which transformations preserve that identity. We begin with diagrams and crossings, then use simple invariants to show why some knots cannot be changed into the unknot. Later chapters connect these ideas to three-dimensional spaces and explain how mathematicians use knot theory as a precise language for problems ordinary geometry does not settle.',
    tocTitles: ['Knots and Equivalence', 'Crossings and Invariants', 'A Topological View'],
    existingTags: [
      { id: 'tag-mathematics', name: 'Mathematics', localizedNames: {}, sourceLocale: 'en-US' },
      { id: 'tag-geometry', name: 'Geometry', localizedNames: {}, sourceLocale: 'en-US' },
      { id: 'tag-puzzles', name: 'Puzzles', localizedNames: {}, sourceLocale: 'en-US' },
    ],
  },
  {
    id: '05-no-existing-tags',
    title: 'How We Find Out',
    author: 'Mateo Ruiz',
    language: 'en-US',
    description:
      'A clear introduction to scientific reasoning, observation, hypothesis testing, measurement, and revision of explanations.',
    excerpt:
      'A useful explanation must risk being wrong. We observe a pattern, state what we expect to happen, and choose a measurement that could contradict our idea. Repeating the observation helps separate a real effect from chance or faulty equipment. When results disagree with our prediction, we revise the explanation and describe what changed. This cycle does not guarantee certainty, but gives other people enough detail to check and build on the work.',
    tocTitles: ['Questions and Observations', 'Testing an Explanation', 'Changing Our Minds'],
    existingTags: [],
  },
  {
    id: '06-near-synonym-cross-language',
    title: 'Power After Coal',
    author: 'Ada Mensah',
    language: 'en-US',
    description:
      'A practical overview of replacing fossil-fuel electricity with renewables, grid storage, and community-scale clean power.',
    excerpt:
      'The transition is not a single machine replacing another. Wind and solar production vary by hour, so storage, transmission, demand planning, and local policy all matter. The examples compare communities that retired coal plants and built cleaner electricity systems. Their choices differ, but each case asks how reliable power can be supplied while reducing pollution and sharing the cost of change.',
    tocTitles: ['Leaving Coal', 'Storage and the Grid', 'A Fair Transition'],
    existingTags: [
      {
        id: 'tag-renewables',
        name: '可再生能源',
        localizedNames: { 'en-US': 'Renewable Energy' },
        sourceLocale: 'zh-CN',
      },
      { id: 'tag-clean-power', name: '清洁能源', localizedNames: { 'en-US': 'Clean Power' }, sourceLocale: 'zh-CN' },
      {
        id: 'tag-energy-policy',
        name: '能源政策',
        localizedNames: { 'en-US': 'Energy Policy' },
        sourceLocale: 'zh-CN',
      },
    ],
  },
  {
    id: '07-insufficient-evidence',
    title: 'Field Notes',
    author: 'Unknown',
    language: 'en-US',
    description: 'A collection of notes.',
    excerpt:
      'The page is dated Tuesday. A blue cup was left near the window. The writer copied a phone number, crossed it out, and made a list of errands. The next page contains three weather observations and an unfinished sentence. There are no chapter headings, subject terms, or further context to explain who wrote the notes or why they were collected.',
    tocTitles: [],
    existingTags: [
      { id: 'tag-biology', name: 'Biology', localizedNames: {}, sourceLocale: 'en-US' },
      { id: 'tag-travel', name: 'Travel', localizedNames: {}, sourceLocale: 'en-US' },
      { id: 'tag-memoir', name: 'Memoir', localizedNames: {}, sourceLocale: 'en-US' },
    ],
  },
  {
    id: '08-technical-over-specificity',
    title: 'Reliable Services in Practice',
    author: 'Priya Nair',
    language: 'en-US',
    description:
      'A broad engineering guide to distributed services, architecture, failure handling, observability, and team practices.',
    excerpt:
      'A service is reliable when its users can depend on the behavior that matters to them. This book starts with system boundaries and failure assumptions, then follows requests through storage, networks, deployment, and monitoring. Short case studies show how teams use timeouts, redundancy, clear ownership, and measured service objectives. Individual algorithms appear as examples, but the recurring subject is designing and operating dependable software systems as a whole.',
    tocTitles: ['Service Boundaries', 'Failures and Recovery', 'Observability', 'Operating in Teams'],
    existingTags: [
      { id: 'tag-computer-science', name: 'Computer Science', localizedNames: {}, sourceLocale: 'en-US' },
      { id: 'tag-software-engineering', name: 'Software Engineering', localizedNames: {}, sourceLocale: 'en-US' },
      { id: 'tag-distributed-systems', name: 'Distributed Systems', localizedNames: {}, sourceLocale: 'en-US' },
      { id: 'tag-cloud-computing', name: 'Cloud Computing', localizedNames: {}, sourceLocale: 'en-US' },
    ],
  },
];

function userContext(sample: Sample): string {
  const sourceLocale = resolveLocale(sample.language);
  return JSON.stringify({
    sourceLocale,
    book: {
      title: sample.title,
      author: sample.author,
      language: sample.language,
      description: sample.description,
      excerpt: sample.excerpt,
      tocTitles: sample.tocTitles,
    },
    existingTags: sample.existingTags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      sourceLocale: tag.sourceLocale,
      names: { ...(tag.sourceLocale ? { [tag.sourceLocale]: tag.name } : {}), ...tag.localizedNames },
    })),
  });
}

async function main() {
  if (process.env.PERSONAL_AI_TAGGING_DRY_RUN_APPROVED !== '1') {
    throw new Error('Set PERSONAL_AI_TAGGING_DRY_RUN_APPROVED=1 only after explicit user approval.');
  }
  const userEmail = process.env.PERSONAL_AI_TAGGING_DRY_RUN_USER_EMAIL;
  if (!userEmail) throw new Error('Set PERSONAL_AI_TAGGING_DRY_RUN_USER_EMAIL to the signed-in account email.');
  const database = await db.execute<{ databaseName: string }>(sql`select current_database() as "databaseName"`);
  if (database.rows[0]?.databaseName !== 'gloaming_backend') {
    throw new Error('Dry-run requires the local development database gloaming_backend.');
  }
  const [user] = await db.select({ id: userTable.id }).from(userTable).where(eq(userTable.email, userEmail)).limit(1);
  if (!user) throw new Error('Signed-in account was not found in the development database.');

  const startIndex = Number(process.env.PERSONAL_AI_TAGGING_DRY_RUN_START_INDEX ?? 0);
  if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex >= samples.length) {
    throw new Error('Start index must be an integer from 0 to 7.');
  }
  const pendingSamples = samples.slice(startIndex);
  const textCompatibilityMode = process.env.PERSONAL_AI_TAGGING_TEXT_COMPATIBILITY === '1';
  const results = [];
  for (const sample of pendingSamples) {
    let rawModelText: string | null = null;
    let usage: { inputTokens: number; outputTokens: number; totalTokens: number } | null = null;
    try {
      const sourceLocale = resolveLocale(sample.language);
      const result = await invokeAi({
        purpose: 'assist',
        providerScope: 'user-only',
        userId: user.id,
        source: 'personal-tagging.semantic-acceptance.dry-run',
        timeoutMs: 25_000,
        maxTokens: 1_200,
        maxRetries: 0,
        persistInvocationLog: false,
        ...(textCompatibilityMode ? {} : { outputSchema: personalTagDecisionSchema }),
        messages: buildPersonalTaggingMessages(userContext(sample)),
      });
      rawModelText = String(result.content);
      usage = result.usage;
      const modelOutput = textCompatibilityMode
        ? personalTagDecisionSchema.parse(
            JSON.parse(
              rawModelText
                .trim()
                .replace(/^```(?:json)?\s*/i, '')
                .replace(/\s*```$/, ''),
            ),
          )
        : result.content;
      const validated = validatePersonalTagDecision(modelOutput, sample.existingTags, sourceLocale);
      const row = {
        requestMode: textCompatibilityMode ? 'prompt-only-json' : 'strict-json-schema',
        sampleId: sample.id,
        inputSummary: {
          title: sample.title,
          author: sample.author,
          language: sample.language,
          existingTags: sample.existingTags,
        },
        model: result.model,
        structuredOutput: modelOutput,
        ...(textCompatibilityMode ? { rawModelText } : {}),
        validatedOutput: validated,
        validationChangedOutput: JSON.stringify(validated) !== JSON.stringify(result.content),
        usage: result.usage,
        unexpectedTagIds: result.content.existingTagIds.filter(
          (id) => !sample.existingTags.some((tag) => tag.id === id),
        ),
        duplicateNewNames: result.content.newTags.filter((tag) =>
          sample.existingTags.some((existing) =>
            [existing.name, ...Object.values(existing.localizedNames)].some(
              (name) => normalizeTagName(name) === normalizeTagName(tag.name),
            ),
          ),
        ),
      };
      results.push(row);
      process.stdout.write(`${JSON.stringify(row)}\n`);
    } catch (error) {
      const row = {
        sampleId: sample.id,
        inputSummary: {
          title: sample.title,
          author: sample.author,
          language: sample.language,
          existingTags: sample.existingTags,
        },
        invocationError: error instanceof AppError ? error.code : error instanceof Error ? error.name : 'unknown',
        structuredOutput: null,
        ...(textCompatibilityMode ? { rawModelText } : {}),
        usage,
      };
      results.push(row);
      process.stdout.write(`${JSON.stringify(row)}\n`);
    }
  }
  process.stderr.write(`Completed ${results.length} calls.\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
