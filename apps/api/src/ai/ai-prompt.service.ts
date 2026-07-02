import { Injectable } from '@nestjs/common';
import type { AiEntityType } from '@prisma/client';
import type { ChatTurn } from '../common/dto/contracts';
import { type AiChatMessage, type AiTaskType, TASK_ENTITY_TYPE } from './ai-task.types';

/**
 * Global skill — prepended to EVERY task (spec §"Global Skill"). Grounds the
 * model in the DB snapshot and forbids fabrication / betting / guaranteed picks.
 */
export const GLOBAL_SKILL =
  '你是 AI 世足分析網站的分析引擎。回答必須以網站資料庫提供的資料為主。' +
  '不可憑空編造比分、賽程、傷病、陣容、球員狀態、新聞來源、排名。' +
  '如果資料不足，必須明確說「目前資料不足」。回答語言預設為繁體中文。' +
  '涉及新聞、傷病、球員狀態、賽事狀態時，必須提及資料更新時間。' +
  '不可提供投注建議或保證性預測。勝負預測只能表述為傾向、風險、條件，不可描述為確定結果。';

/**
 * Looser framing for analysis-generation tasks (player ratings / match / champion):
 * the DB only carries names/codes, so the model may use widely-known public football
 * knowledge to score and analyze — while still deferring to the DB snapshot on conflict
 * and flagging uncertain/possibly-outdated info. Safety rails (no betting, no guarantees)
 * are kept. Chat / news classification keep the strict {@link GLOBAL_SKILL}.
 */
export const RELAXED_SKILL =
  '你是 AI 世足分析網站的分析引擎。請優先採用網站資料庫提供的資料；當資料庫缺少實力數據時，' +
  '可運用你對相關球隊與球員的公開足球知識進行合理評估與分析，但若與資料庫快照衝突，一律以資料庫為準。' +
  '對於可能過時或無法確認的內容，請在文字中標註為「推估」。回答語言為繁體中文。' +
  '不可提供投注建議或保證性預測；勝負只能表述為傾向、風險、條件，不可描述為確定結果。';

/** Page-context skill per entity (spec §"Page Context Skills"). */
const PAGE_SKILL: Partial<Record<AiEntityType, string>> = {
  MATCH: '只能根據目前比賽、雙方國家隊、關鍵球員、事件、既有 AI 報告回答。',
  TEAM: '只能根據目前國家隊資料、球員名單、近期賽事、AI 評級、新聞標籤回答。',
  PLAYER: '只能根據目前球員資料、六邊能力、狀態摘要、新聞標籤、國家隊角色回答。',
  CHAMPION_PREDICTION: '只能根據最新 champion prediction run、entries、模型報告、更新時間回答。',
  NEWS: '只能根據目前新聞標題、摘要、來源、發布時間、AI 標籤、關聯國家與球員回答。影響分析必須標明是推論。',
};

export type PromptInput = {
  taskType: AiTaskType;
  /** Short page scope label, e.g. "賽事：Brazil vs Argentina". */
  scope?: string | null;
  /** DB snapshot the answer must be grounded in. Serialized into the system msg. */
  context?: unknown;
  /** The user question (chat) or task instruction (structured tasks). */
  userPrompt: string;
  /** Use RELAXED_SKILL (allow public football knowledge) for generation tasks. */
  allowModelKnowledge?: boolean;
  /** Prior conversation turns (general chat multi-turn); oldest→newest. */
  history?: ChatTurn[] | null;
};

@Injectable()
export class AiPromptService {
  /**
   * Builds the message list: global/relaxed skill + page skill + snapshot as the
   * system message, then (optional) prior turns, then the user prompt. When
   * history is present the current prompt is flagged 【本次提問】 so the model
   * answers it while treating earlier turns as context only.
   */
  build(input: PromptInput): AiChatMessage[] {
    const system = input.allowModelKnowledge
      ? this.relaxedSystem(input)
      : this.strictSystem(input);
    return this.assemble(system, input.userPrompt, input.history);
  }

  /** Relaxed framing: no strict page skill (it would force "只能根據資料庫"). */
  private relaxedSystem(input: PromptInput): string {
    const sys = input.scope ? `${RELAXED_SKILL}\n\n目前頁面範圍：${input.scope}` : RELAXED_SKILL;
    return input.context !== undefined && input.context !== null
      ? `${sys}\n\n以下為資料庫快照（如有缺漏可用公開知識補充並標註推估）：\n${this.serialize(input.context)}`
      : sys;
  }

  private strictSystem(input: PromptInput): string {
    const parts: string[] = [GLOBAL_SKILL];
    const pageSkill = PAGE_SKILL[TASK_ENTITY_TYPE[input.taskType]];
    if (pageSkill) {
      parts.push(pageSkill);
    }
    if (input.scope) {
      parts.push(`目前頁面範圍：${input.scope}`);
    }
    if (input.context !== undefined && input.context !== null) {
      parts.push(`以下為資料庫快照（請僅根據此資料回答）：\n${this.serialize(input.context)}`);
    }
    return parts.join('\n\n');
  }

  /**
   * [system, user] when there's no history (unchanged behavior); otherwise
   * [system(+note), ...history, {user: 【本次提問】…}].
   */
  private assemble(
    system: string,
    userPrompt: string,
    history?: ChatTurn[] | null,
  ): AiChatMessage[] {
    const turns = (history ?? []).filter(
      (t) =>
        (t.role === 'user' || t.role === 'assistant') &&
        typeof t.content === 'string' &&
        t.content.trim().length > 0,
    );
    if (turns.length === 0) {
      return [
        { role: 'system', content: system },
        { role: 'user', content: userPrompt },
      ];
    }
    const sys =
      `${system}\n\n` +
      '以下對話包含歷史紀錄與最後的【本次提問】。請主要針對【本次提問】作答，' +
      '先前對話僅作為理解上下文的參考，不可與資料庫快照衝突。';
    return [
      { role: 'system', content: sys },
      ...turns.map((t): AiChatMessage => ({ role: t.role, content: t.content })),
      { role: 'user', content: `【本次提問】\n${userPrompt}` },
    ];
  }

  private serialize(context: unknown): string {
    if (typeof context === 'string') {
      return context;
    }
    try {
      return JSON.stringify(context, null, 2);
    } catch {
      return String(context);
    }
  }
}
