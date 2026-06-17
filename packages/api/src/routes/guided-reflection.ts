import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";

import {
  generateGuidedReflectionQuestion,
  type GuidedReflectionQuestionOutput,
} from "../lib/guided-reflection-question.js";
import { requireAuth, type AuthEnv } from "../lib/middleware.js";

const requestSchema = z.object({
  locale: z.enum(["en-US", "ko-KR"]).optional(),
  inspiration: z.object({
    text: z.string().max(12000),
    kind: z.enum(["note", "link", "image", "file", "mixed"]),
    links: z.array(z.string().max(2048)).max(20).optional(),
    attachmentKinds: z.array(z.enum(["link", "image", "file"])).max(20).optional(),
    highlights: z.array(z.string().max(1000)).max(10).optional(),
    resonance: z.string().max(80).nullable().optional(),
    resonanceNote: z.string().max(1000).nullable().optional(),
  }),
  priorAnswers: z
    .array(
      z.object({
        question: z.string().min(1).max(240),
        answer: z.string().min(1).max(4000),
      }),
    )
    .max(5),
});

export interface GuidedReflectionRoutesDependencies {
  generateQuestion?: (input: z.infer<typeof requestSchema>) => Promise<GuidedReflectionQuestionOutput>;
  authMiddleware?: MiddlewareHandler<AuthEnv>;
}

export function createGuidedReflectionRoutes(
  deps: GuidedReflectionRoutesDependencies = {},
): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const generateQuestion = deps.generateQuestion ?? generateGuidedReflectionQuestion;

  routes.use("*", deps.authMiddleware ?? requireAuth);

  routes.post("/question", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: "Invalid guided reflection question request",
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    }

    const result = await generateQuestion(parsed.data);
    return c.json(result, 200);
  });

  return routes;
}

export const guidedReflectionRoutes = createGuidedReflectionRoutes();
