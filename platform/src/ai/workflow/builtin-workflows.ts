/**
 * Built-in Workflow Templates
 *
 * 事前定義されたワークフローテンプレート
 * PLAN.md 6.1 に基づく一般的なユースケースのワークフロー
 */

import type { WorkflowDefinition } from "./types";

/**
 * コンテンツモデレーションワークフロー
 *
 * 投稿内容を分析し、問題のあるコンテンツをフラグ付け
 */
export const contentModerationWorkflow: WorkflowDefinition = {
  id: "workflow.content_moderation",
  name: "Content Moderation",
  description: "Analyze content for safety issues and flag problematic posts",
  version: "1.0.0",
  entryPoint: "analyze_content",
  dataPolicy: {
    sendPublicPosts: true,
    sendCommunityPosts: true,
  },
  inputSchema: {
    type: "object",
    properties: {
      content: { type: "string", description: "Content to analyze" },
      contentType: { type: "string", enum: ["post", "comment", "bio"] },
    },
    required: ["content"],
  },
  outputSchema: {
    type: "object",
    properties: {
      safe: { type: "boolean" },
      flags: { type: "array", items: { type: "string" } },
      confidence: { type: "number" },
      suggestedAction: { type: "string" },
    },
  },
  steps: [
    {
      id: "analyze_content",
      type: "ai_action",
      name: "Analyze Content Safety",
      config: {
        type: "ai_action",
        actionId: "ai.summary",
        input: {},
      },
      inputMapping: {
        text: { type: "ref", stepId: "input", path: "content" },
      },
      next: "check_flags",
    },
    {
      id: "check_flags",
      type: "condition",
      name: "Check Safety Flags",
      config: {
        type: "condition",
        expression: "analyze_content.output.flagged == true",
        branches: [
          { condition: "analyze_content.output.flagged == true", nextStep: "require_review" },
          { condition: "true", nextStep: "approve_content" },
        ],
      },
    },
    {
      id: "require_review",
      type: "human_approval",
      name: "Manual Review Required",
      config: {
        type: "human_approval",
        message: "Content flagged for review. Please approve or reject.",
        approvalType: "approve_reject",
        timeout: 86400000, // 24 hours
      },
      next: "final_decision",
    },
    {
      id: "approve_content",
      type: "transform",
      name: "Approve Content",
      config: {
        type: "transform",
        expression: "$.safe",
      },
    },
    {
      id: "final_decision",
      type: "transform",
      name: "Final Decision",
      config: {
        type: "transform",
        expression: "$.approved",
      },
    },
  ],
  metadata: {
    author: "takos-core",
    tags: ["moderation", "safety"],
  },
};

/**
 * 投稿強化ワークフロー
 *
 * 投稿内容を分析し、タグ付けと要約を自動生成
 */
export const postEnhancementWorkflow: WorkflowDefinition = {
  id: "workflow.post_enhancement",
  name: "Post Enhancement",
  description: "Enhance posts with auto-generated tags and summaries",
  version: "1.0.0",
  entryPoint: "generate_summary",
  dataPolicy: {
    sendPublicPosts: true,
  },
  inputSchema: {
    type: "object",
    properties: {
      content: { type: "string", description: "Post content" },
      language: { type: "string", description: "Content language" },
    },
    required: ["content"],
  },
  outputSchema: {
    type: "object",
    properties: {
      summary: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
      enhancedContent: { type: "string" },
    },
  },
  steps: [
    {
      id: "generate_summary",
      type: "ai_action",
      name: "Generate Summary",
      config: {
        type: "ai_action",
        actionId: "ai.summary",
        input: {
          maxSentences: 2,
        },
      },
      inputMapping: {
        text: { type: "ref", stepId: "input", path: "content" },
        language: { type: "ref", stepId: "input", path: "language" },
      },
      next: "suggest_tags",
    },
    {
      id: "suggest_tags",
      type: "ai_action",
      name: "Suggest Hashtags",
      config: {
        type: "ai_action",
        actionId: "ai.tag-suggest",
        input: {
          maxTags: 5,
        },
      },
      inputMapping: {
        text: { type: "ref", stepId: "input", path: "content" },
      },
      next: "combine_results",
    },
    {
      id: "combine_results",
      type: "transform",
      name: "Combine Results",
      config: {
        type: "transform",
        expression: "$.combined",
      },
    },
  ],
  metadata: {
    author: "takos-core",
    tags: ["enhancement", "automation"],
  },
};

/**
 * 翻訳チェーンワークフロー
 *
 * 複数言語への翻訳を順次実行
 */
export const translationChainWorkflow: WorkflowDefinition = {
  id: "workflow.translation_chain",
  name: "Translation Chain",
  description: "Translate content to multiple target languages",
  version: "1.0.0",
  entryPoint: "translate_loop",
  dataPolicy: {
    sendPublicPosts: true,
  },
  inputSchema: {
    type: "object",
    properties: {
      content: { type: "string", description: "Content to translate" },
      targetLanguages: {
        type: "array",
        items: { type: "string" },
        description: "Target language codes",
      },
    },
    required: ["content", "targetLanguages"],
  },
  outputSchema: {
    type: "object",
    properties: {
      translations: {
        type: "object",
        additionalProperties: { type: "string" },
      },
    },
  },
  steps: [
    {
      id: "translate_loop",
      type: "loop",
      name: "Translate to Each Language",
      config: {
        type: "loop",
        maxIterations: 10,
        condition: "iteration < targetLanguages.length",
        body: [
          {
            id: "translate_single",
            type: "ai_action",
            name: "Translate",
            config: {
              type: "ai_action",
              actionId: "ai.translation",
              input: {},
            },
          },
        ],
      },
    },
  ],
  metadata: {
    author: "takos-core",
    tags: ["translation", "i18n"],
  },
};

/**
 * DM安全性チェックワークフロー
 *
 * DMメッセージの安全性を分析
 */
export const dmSafetyCheckWorkflow: WorkflowDefinition = {
  id: "workflow.dm_safety_check",
  name: "DM Safety Check",
  description: "Analyze DM conversations for safety issues",
  version: "1.0.0",
  entryPoint: "analyze_messages",
  dataPolicy: {
    sendDm: true,
  },
  inputSchema: {
    type: "object",
    properties: {
      messages: {
        type: "array",
        items: {
          type: "object",
          properties: {
            from: { type: "string" },
            text: { type: "string" },
          },
        },
        description: "DM messages to analyze",
      },
    },
    required: ["messages"],
  },
  outputSchema: {
    type: "object",
    properties: {
      flagged: { type: "boolean" },
      reasons: { type: "array", items: { type: "string" } },
      recommendation: { type: "string" },
    },
  },
  steps: [
    {
      id: "analyze_messages",
      type: "ai_action",
      name: "Analyze DM Safety",
      config: {
        type: "ai_action",
        actionId: "ai.dm-moderator",
        input: {},
      },
      inputMapping: {
        messages: { type: "ref", stepId: "input", path: "messages" },
      },
      next: "determine_action",
    },
    {
      id: "determine_action",
      type: "condition",
      name: "Determine Action",
      config: {
        type: "condition",
        expression: "analyze_messages.output.flagged == true",
        branches: [
          { condition: "analyze_messages.output.flagged == true", nextStep: "flag_conversation" },
          { condition: "true", nextStep: "mark_safe" },
        ],
      },
    },
    {
      id: "flag_conversation",
      type: "transform",
      name: "Flag Conversation",
      config: {
        type: "transform",
        expression: "$.flagged",
      },
    },
    {
      id: "mark_safe",
      type: "transform",
      name: "Mark as Safe",
      config: {
        type: "transform",
        expression: "$.safe",
      },
    },
  ],
  metadata: {
    author: "takos-core",
    tags: ["dm", "safety", "moderation"],
  },
};

/**
 * コミュニティダイジェストワークフロー
 *
 * コミュニティの投稿を要約してダイジェストを生成
 */
export const communityDigestWorkflow: WorkflowDefinition = {
  id: "workflow.community_digest",
  name: "Community Digest",
  description: "Generate a digest of community posts and activities",
  version: "1.0.0",
  entryPoint: "gather_posts",
  dataPolicy: {
    sendPublicPosts: true,
    sendCommunityPosts: true,
  },
  inputSchema: {
    type: "object",
    properties: {
      communityId: { type: "string", description: "Community ID" },
      since: { type: "string", description: "ISO timestamp for start of period" },
      maxPosts: { type: "number", description: "Maximum posts to include" },
    },
    required: ["communityId"],
  },
  outputSchema: {
    type: "object",
    properties: {
      digest: { type: "string" },
      highlights: { type: "array", items: { type: "string" } },
      topContributors: { type: "array", items: { type: "string" } },
      postCount: { type: "number" },
    },
  },
  steps: [
    {
      id: "gather_posts",
      type: "tool_call",
      name: "Gather Community Posts",
      config: {
        type: "tool_call",
        toolName: "communities.listPosts",
        input: {},
      },
      inputMapping: {
        communityId: { type: "ref", stepId: "input", path: "communityId" },
        since: { type: "ref", stepId: "input", path: "since" },
        limit: { type: "ref", stepId: "input", path: "maxPosts" },
      },
      next: "summarize_posts",
    },
    {
      id: "summarize_posts",
      type: "ai_action",
      name: "Summarize Posts",
      config: {
        type: "ai_action",
        actionId: "ai.summary",
        input: {
          maxSentences: 5,
        },
      },
      next: "extract_highlights",
    },
    {
      id: "extract_highlights",
      type: "ai_action",
      name: "Extract Highlights",
      config: {
        type: "ai_action",
        actionId: "ai.tag-suggest",
        input: {
          maxTags: 10,
        },
      },
      next: "format_digest",
    },
    {
      id: "format_digest",
      type: "transform",
      name: "Format Digest",
      config: {
        type: "transform",
        expression: "$.digest",
      },
    },
  ],
  metadata: {
    author: "takos-core",
    tags: ["community", "digest", "summary"],
  },
};

/**
 * すべての組み込みワークフロー
 */
export const builtinWorkflows: WorkflowDefinition[] = [
  contentModerationWorkflow,
  postEnhancementWorkflow,
  translationChainWorkflow,
  dmSafetyCheckWorkflow,
  communityDigestWorkflow,
];

/**
 * 組み込みワークフローをレジストリに登録
 */
export function registerBuiltinWorkflows(
  registry: import("./types").WorkflowRegistry,
): void {
  for (const workflow of builtinWorkflows) {
    try {
      registry.register(workflow);
    } catch (error) {
      // 既に登録されている場合はスキップ
      if (error instanceof Error && error.message.includes("already registered")) {
        continue;
      }
      console.error(`[workflow] Failed to register builtin workflow ${workflow.id}:`, error);
    }
  }
}
