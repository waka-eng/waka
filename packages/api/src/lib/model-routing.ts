/** Reviewed task routing. Credential presence never overrides an explicit choice. */
import developmentGpt from '../../../../infra/gpt61-development.json';
export type GenerationProvider = 'openai' | 'openrouter' | 'gemini';
export class ModelConfigurationError extends Error {constructor(message:string){super(message);this.name='ModelConfigurationError';}}
export const GPT_TERRA = 'gpt-6.1-terra';
export const GPT_SOL = 'gpt-6.1-sol';
export type NativeGptModel = typeof GPT_TERRA | typeof GPT_SOL;
export const TEXT_TASK_ENV = {
  chat: 'WAKA_MODEL_CHAT', extract: 'WAKA_MODEL_EXTRACT', support: 'WAKA_MODEL_SUPPORT',
  judge: 'WAKA_MODEL_JUDGE', reflect: 'WAKA_MODEL_REFLECT', synthesize: 'WAKA_MODEL_SYNTHESIZE',
  review: 'WAKA_MODEL_TOP_OF_MIND_REVIEW', principles: 'WAKA_MODEL_PRINCIPLES',
  principleJudge: 'WAKA_MODEL_PRINCIPLE_JUDGE', route: 'WAKA_MODEL_ROUTE', image: 'WAKA_MODEL_IMAGE',
} as const;
export type GptTask = keyof typeof TEXT_TASK_ENV;
export function configuredGenerationProvider(): GenerationProvider {
  const selected = process.env.WAKA_GENERATION_PROVIDER?.trim();
  if (!selected) return process.env.OPENROUTER_API_KEY?.trim() ? 'openrouter' : 'gemini';
  if (selected !== 'openai' && selected !== 'openrouter' && selected !== 'gemini') {
    throw new ModelConfigurationError('Unknown generation provider configuration');
  }
  return selected;
}
export function nativeGptTask(task: GptTask) {
  const model = process.env[TEXT_TASK_ENV[task]]?.trim() || developmentGpt[TEXT_TASK_ENV[task]];
  if (model !== GPT_TERRA && model !== GPT_SOL) throw new ModelConfigurationError('Unsupported native GPT task model configuration');
  return { model, effort: task === 'synthesize' ? 'medium' as const : 'low' as const };
}
/** Also used by the retained OR adapter: Sol must never inherit disabled reasoning. */
export function gptCapabilities(model: string, synthesis = false) {
  if (![GPT_TERRA, GPT_SOL, 'openai/'+GPT_TERRA, 'openai/'+GPT_SOL].includes(model)) return null;
  return { effort: synthesis ? 'medium' as const : 'low' as const, strictSchema: true };
}
