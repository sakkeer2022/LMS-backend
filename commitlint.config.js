// Conventional Commits plus team rules (see src/docs/CONTRIBUTING.md):
// every commit carries a Jira footer such as "Refs: LMS-52", and no AI co-author trailers.
const JIRA_FOOTER = /^Refs: LMS-\d+(, LMS-\d+)*$/m;
const AI_TRAILER = /^Co-Authored-By:.*(claude|anthropic|copilot|gemini|openai|chatgpt)/im;

module.exports = {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        'jira-footer': ({ raw }) => [
          JIRA_FOOTER.test(raw ?? ''),
          'add a Jira footer such as "Refs: LMS-52" (uppercase key)',
        ],
        'no-ai-trailer': ({ raw }) => [
          !AI_TRAILER.test(raw ?? ''),
          'remove the AI Co-Authored-By trailer',
        ],
      },
    },
  ],
  rules: {
    'jira-footer': [2, 'always'],
    'no-ai-trailer': [2, 'always'],
  },
};
